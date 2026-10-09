#!/usr/bin/env python3
"""构建 WorkOn-Jev 训练数据：原始 WorkOn 数据 -> SystemOne 风格的对话样本。

数据来源（data/raw/）
---------------------
| 文件 | 条数 | STATE 富度 | 可问的题 | 角色 |
|---|---|---|---|---|
| real_actions.jsonl | 22745 | 瘦（只有类别/行为/时间） | work_state | **真实分布主力** |
| scene_data.jsonl | 9844 | 富（进程/标题哈希/OCR/布局 + 行为） | 全部 5 题 | 唯一同时带场景与状态的桥接集 |
| scene_training_data_enhanced.jsonl | 11810 | 富 | 场景 3 题 | 场景多样性补充 |
| scene_training_data.jsonl | 624 | 富 | 场景 3 题 | 已并入 enhanced，去重后留 |
| action_data.jsonl | 9844 | 瘦（与 scene_data 同源） | action/work_state | **丢弃**：与 scene_data 重复且是泄漏重灾区 |

去泄漏（对应 ml/EXPERIMENTS.md 记录的 v2 问题）
---------------------------------------------
合成数据的 (action_type, field, duration_ms, text_length, has_shortcut) 是按 label 分支生成的，
直接入训等于教模型背生成规则。这里把这 5 列**替换成从真实数据分布重采样的值**
（按 app_category 匹配，匹配不到用全局分布），只保留与标签语义真正相关的场景字段。

权重
----
合成数据的 work_state / action 标签本身由 scene_l3 映射而来，与真实分布存在系统性冲突
（真实数据里 browser→other 占 85%）。因此这两题在合成行上的损失权重下调到 0.35，
场景三题保持 1.0；真实行的 work_state 权重 1.0。
"""
from __future__ import annotations

import argparse
import collections
import hashlib
import json
import random
import sys
from pathlib import Path

def _find_root() -> Path:
    """向上找到含 configs/questions.json 的目录。

    这样同一份脚本在开发仓库（workon-jev/）和交付目录（ml/jev/）里都能定位到项目根，
    不会因为被搬了位置就把路径算错。
    """
    here = Path(__file__).resolve()
    for p in [here.parent, *here.parents]:
        if (p / "configs" / "questions.json").exists():
            return p
    return here.parent.parent.parent


ROOT = _find_root()
sys.path.insert(0, str(ROOT))

from jev.catalog import load_catalog  # noqa: E402
from jev.prompt import build_messages  # noqa: E402
from jev.state import render_state  # noqa: E402

RAW = ROOT / "data" / "raw"
OUT_DIR = ROOT / "data" / "processed"

# 各题在合成行上的损失权重
SYNTH_WEIGHTS = {"scene_l1": 1.0, "scene_l2": 1.0, "scene_l3": 1.0, "action": 0.35, "work_state": 0.35}
REAL_WEIGHTS = {"work_state": 1.0}

# 子集增强：每题被保留的概率（让模型适应"只问其中几题"）
KEEP_PROB = {"scene_l1": 1.0, "scene_l2": 0.90, "scene_l3": 0.85, "action": 0.55, "work_state": 0.80}


def iter_jsonl(path: Path):
    with path.open(encoding="utf-8-sig") as f:
        for i, line in enumerate(f):
            line = line.strip()
            if line:
                yield i, json.loads(line)


# ────────────────────────── 去泄漏：真实行为分布重采样 ──────────────────────────

def build_behavior_pools(real_path: Path) -> tuple[dict, dict]:
    """按 app_category 分桶统计真实数据的 (action_type, field, duration_ms, text_length, has_shortcut) 取值池。"""
    by_cat: dict[str, dict[str, list]] = collections.defaultdict(lambda: collections.defaultdict(list))
    glob: dict[str, list] = collections.defaultdict(list)
    for _, row in iter_jsonl(real_path):
        cat = row.get("app_category", "unknown")
        for k in ("action_type", "field", "duration_ms", "text_length", "has_shortcut"):
            by_cat[cat][k].append(row[k])
            glob[k].append(row[k])
    return by_cat, glob


def deleak_row(row: dict, pools: tuple[dict, dict], rng: random.Random) -> dict:
    """把合成行里"按标签生成"的行为特征替换成真实分布样本。"""
    by_cat, glob = pools
    cat = row.get("app_category", "unknown")
    src = by_cat.get(cat) or glob
    out = dict(row)
    for k in ("action_type", "field", "duration_ms", "text_length", "has_shortcut"):
        pool = src.get(k) or glob[k]
        out[k] = rng.choice(pool)
    return out


# ────────────────────────── 抽样计划 ──────────────────────────

def sample_ids(n: int, *, seed: int, stride: int, offset: int) -> set[int]:
    """按固定步长切分，避免时间相邻样本跨集泄漏。"""
    return {i for i in range(n) if i % stride == offset}


# render_state 真正会读的键（白名单）。
# 注意：real_actions 的原始行里带 `label`（=金标），如果不白名单化，
# state_row 会把答案一起写进数据文件 —— 现在是靠 render_state 不读它来兜底，
# 属于"正确但危险"，这里直接堵死。
STATE_KEYS = (
    "process_name", "app", "app_name", "app_category", "window_title",
    "ocr_keywords", "ocr_keyword_category", "ocr_word_count", "ocr_avg_score",
    "ui_layout", "action_type", "field", "text_length", "duration_ms",
    "time_since_prev_ms", "has_shortcut", "hour", "day_of_week",
)


def state_view(row: dict) -> dict:
    return {k: row[k] for k in STATE_KEYS if k in row}


def scene_cap_hit(row: dict, cap: int, counter: collections.Counter) -> bool:
    """每个三级场景在 train 里最多保留 cap 条（场景行 token 最多，是训练耗时主因）。"""
    if cap <= 0:
        return False
    key = row.get("scene_l3") or row.get("scene_l2") or row.get("scene_l1") or "?"
    counter[key] += 1
    return counter[key] > cap


def pick_questions(available: list[str], rng: random.Random) -> list[str]:
    """子集增强 + 顺序增强：l1->l2->l3 顺序不可变，action/work_state 随机插入。"""
    kept = [q for q in available if rng.random() < KEEP_PROB.get(q, 1.0)]
    chain = [q for q in ("scene_l1", "scene_l2", "scene_l3") if q in kept]
    free = [q for q in kept if q not in chain]
    if not chain and not free:
        return []
    rng.shuffle(free)
    result = list(chain)
    for q in free:
        result.insert(rng.randrange(len(result) + 1), q)
    return result


def build_plan(cat, row: dict, golds: dict, questions: list[str], rng: random.Random) -> list[dict]:
    """把 (样本, 题目列表) 展开成提问计划，逐题解析候选与金标字母。"""
    plan: list[dict] = []
    chosen: dict[str, str] = {}
    options_by_q: dict[str, list[dict]] = {}

    for q in questions:
        parent_key = None
        parent_note = None
        p = cat.parent_of(q)
        if p:
            parent_key = chosen.get(p)
            if parent_key is None:
                continue  # 父题被丢掉则子题也无从问起
            # 父题的展示文本（scene_l2 的父是 scene_l1，key 即文本）
            parent_spec = cat.questions[p]
            if parent_spec["type"] == "flat":
                parent_text = parent_key
            else:
                parent_text = _text_by_key(parent_spec, parent_key)
            parent_note = f"已知：{_Q_CN[p]} = {parent_text}"
        opts = cat.options(q, parent_key)
        if not opts:
            continue
        gold = golds.get(q)
        letter = cat.letter_of(opts, gold) if gold else None
        if letter is None:
            continue  # 该样本在此题上没有金标（或金标不在候选里）
        options_by_q[q] = opts
        chosen[q] = gold
        plan.append({
            "question": q,
            "instructions": cat.instructions(q),
            "options": opts,
            "parent_note": parent_note,
            "answer": letter,
            "gold_key": gold,
        })
    return plan


_Q_CN = {"scene_l1": "一级场景", "scene_l2": "二级场景", "scene_l3": "具体场景"}


def _text_by_key(spec: dict, key: str) -> str:
    for opts in spec["options_by_parent"].values():
        for o in opts:
            if o["key"] == key:
                return o["text"]
    return key


# ────────────────────────── 主流程 ──────────────────────────

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--test-stride", type=int, default=12, help="每 N 条抽 1 条做 test")
    ap.add_argument("--val-stride", type=int, default=29, help="每 N 条抽 1 条做 val")
    ap.add_argument("--enhanced-limit", type=int, default=8000, help="增强场景数据最多用多少条")
    ap.add_argument("--real-frac", type=float, default=0.30,
                    help="真实行为数据按比例**均匀随机**抽样（保持 label 先验不变）")
    ap.add_argument("--scene-cap", type=int, default=12,
                    help="每个三级场景最多保留多少条（场景行 token 最多，是训练耗时主因）")
    ap.add_argument("--include-title", default="hint", choices=["none", "app", "hint", "raw"])
    ap.add_argument("--shuffle-options", type=int, default=1, help="1=每题选项顺序随机（防止位置记忆）")
    ap.add_argument("--out", default=str(OUT_DIR))
    args = ap.parse_args()

    rng = random.Random(args.seed)
    cat = load_catalog()
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    pools = build_behavior_pools(RAW / "real_actions.jsonl")

    cap_counter: collections.Counter = collections.Counter()
    seen_hashes: set[str] = set()
    splits: dict[str, list] = {"train": [], "val": [], "test": []}
    counters = collections.Counter()
    q_counts = collections.Counter()
    gold_counts: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
    dropped = collections.Counter()

    def add(source: str, row: dict, questions: list[str], weights: dict, state_row: dict,
            split: str, tag: str):
        golds = cat.gold_keys(row)
        plan = build_plan(cat, row, golds, questions, rng)
        if not plan:
            dropped["no_plan"] += 1
            return
        if args.shuffle_options:
            for step in plan:
                opts = step["options"][:]
                rng.shuffle(opts)
                step["options"] = opts
                step["answer"] = cat.letter_of(opts, step["gold_key"])
                if step["answer"] is None:
                    dropped["shuffle_lost_gold"] += 1
                    return
        state_text = render_state(state_row, include_title=args.include_title)
        messages = build_messages(state_text, plan)
        key = hashlib.sha1(
            ("|".join(m["content"] for m in messages)).encode("utf-8")
        ).hexdigest()
        if key in seen_hashes:
            dropped["dup"] += 1
            return
        seen_hashes.add(key)
        splits[split].append({
            "id": f"{tag}_{counters[source]:06d}",
            "source": source,
            "questions": [s["question"] for s in plan],
            "turn_weights": [weights.get(s["question"], 1.0) for s in plan],
            "turn_options": [len(s["options"]) for s in plan],
            "turn_gold": [s["answer"] for s in plan],
            "gold_keys": [s["gold_key"] for s in plan],
            "state_row": state_view(state_row),
            "messages": messages,
        })
        counters[source] += 1
        for s in plan:
            q_counts[s["question"]] += 1
            gold_counts[s["question"]][s["gold_key"]] += 1

    # ── 1. 真实行为数据：只问 work_state ──
    real_rows = [r for _, r in iter_jsonl(RAW / "real_actions.jsonl")]
    for i, row in enumerate(real_rows):
        split = "test" if i % args.test_stride == 0 else ("val" if i % args.val_stride == 0 else "train")
        if split == "train" and rng.random() > args.real_frac:
            dropped["real_subsample"] += 1
            continue
        add("real_actions", row, ["work_state"], REAL_WEIGHTS, row, split, "real")

    # ── 2. scene_data：五题全问；行为特征先去泄漏 ──
    scene_rows = [r for _, r in iter_jsonl(RAW / "scene_data.jsonl")]
    for i, row in enumerate(scene_rows):
        split = "test" if i % args.test_stride == 3 else ("val" if i % args.val_stride == 3 else "train")
        if split == "train" and scene_cap_hit(row, args.scene_cap, cap_counter):
            dropped["scene_cap"] += 1
            continue
        deleaked = deleak_row(row, pools, rng)
        add("scene_data", row, ["scene_l1", "scene_l2", "scene_l3", "action", "work_state"],
            SYNTH_WEIGHTS, deleaked, split, "scene")

    # ── 3. enhanced / 基础场景数据：只问场景三题 ──
    enh = [r for _, r in iter_jsonl(RAW / "scene_training_data_enhanced.jsonl")]
    base = [r for _, r in iter_jsonl(RAW / "scene_training_data.jsonl")]
    rng.shuffle(enh)
    extra_cap: collections.Counter = collections.Counter()
    for i, row in enumerate(enh[: args.enhanced_limit] + base):
        split = "test" if i % args.test_stride == 5 else ("val" if i % args.val_stride == 5 else "train")
        if split == "train" and scene_cap_hit(row, args.scene_cap, extra_cap):
            dropped["extra_cap"] += 1
            continue
        add("scene_extra", row, ["scene_l1", "scene_l2", "scene_l3"], SYNTH_WEIGHTS, row, split, "extra")

    # ── 落盘 ──
    for split, rows in splits.items():
        p = out_dir / f"{split}.jsonl"
        with p.open("w", encoding="utf-8") as f:
            for r in rows:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
        print(f"{split:5s} {len(rows):6d} 条 -> {p}")

    stats = {
        "seed": args.seed,
        "include_title": args.include_title,
        "splits": {k: len(v) for k, v in splits.items()},
        "by_source": dict(counters),
        "by_question": dict(q_counts),
        "dropped": dict(dropped),
        "gold_dist": {q: dict(c.most_common()) for q, c in gold_counts.items()},
    }
    (out_dir / "stats.json").write_text(json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8")
    print("\n来源:", dict(counters))
    print("题目:", dict(q_counts))
    print("丢弃:", dict(dropped))
    print("work_state 金标分布:", dict(gold_counts["work_state"].most_common()))
    print("scene_l1 金标分布:", dict(gold_counts["scene_l1"].most_common(8)))


if __name__ == "__main__":
    main()
