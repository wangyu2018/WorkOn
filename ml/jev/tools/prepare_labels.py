#!/usr/bin/env python3
"""从 WorkOn 原始数据推导并固化选项表 -> configs/questions.json

设计要点
--------
1. 选项 = **闭集词表**，运行时只输出字母（A/B/C…），服务端把字母映射回标签。
   - 单 token 打分 => 一次前向即可拿到整题分布，且天然是概率。
   - 上限 26 个选项（单字母）。WorkOn 最大题是 scene_l1 的 21 个，安全。
2. 层级题（scene_l2/scene_l3）按父节点给候选，避免 168 类全量打分。
   - L2 名称跨 L1 会重名（"AI问答" 同属「AI工具」和「浏览器」），
     因此内部 key 一律用路径 id：`l1//l2` / `l1//l2//l3`，展示文本仍用原名。
3. work_state 只收训练数据里真实出现过的状态（11 个）。
"""
from __future__ import annotations

import collections
import json
import sys
from pathlib import Path

def _find_root() -> Path:
    here = Path(__file__).resolve()
    for p in [here.parent, *here.parents]:
        if (p / "configs" / "questions.json").exists():
            return p
    return here.parent.parent


ROOT = _find_root()
RAW = ROOT / "data" / "raw"
OUT = ROOT / "configs" / "questions.json"

# WorkState 英文 key -> 展示文本（与 src/shared/stateMeta.ts 的 WORK_STATES 对齐）
WORK_STATE_TEXT = {
    "focus": "专注 focus",
    "coding": "编程 coding",
    "aidev": "AI开发 aidev",
    "aiqa": "AI问答 aiqa",
    "writing": "写文档 writing",
    "meeting": "会议 meeting",
    "slack": "摸鱼 slack",
    "relax": "放松 relax",
    "idle": "空闲 idle",
    "other": "其他 other",
    "remote": "远程协作 remote",
    # 以下状态由规则层（离开/午休/休息）处理，不进模型选项
    "break": "休息 break",
    "lunch": "午休 lunch",
    "away": "离开 away",
}

ACTION_TEXT = {
    "code": "写代码 code",
    "write": "写文档 write",
    "data_entry": "录入数据 data_entry",
    "search": "搜索 search",
    "browse": "浏览 browse",
    "view": "观看 view",
    "communicate": "沟通 communicate",
    "meet": "开会 meet",
    "manage_file": "管理文件 manage_file",
    "manage_task": "管理任务 manage_task",
    "configure": "配置 configure",
    "debug": "调试 debug",
    "design": "设计 design",
    "review": "审阅 review",
    "translate": "翻译 translate",
    "other": "其他 other",
}

L1_INSTRUCTIONS = "当前桌面处于哪个一级场景？"
L2_INSTRUCTIONS = "结合一级场景，当前处于哪个二级场景？"
L3_INSTRUCTIONS = "结合二/三级场景，当前具体在做哪一件事？"
ACTION_INSTRUCTIONS = "用户此刻的操作动作属于哪一类？"
WORK_STATE_INSTRUCTIONS = "用户此刻的工作状态最接近哪一个？"


def _iter_jsonl(path: Path):
    with path.open(encoding="utf-8-sig") as f:
        for line in f:
            line = line.strip()
            if line:
                yield json.loads(line)


def main() -> None:
    # ── 场景层级：scene_data.jsonl（含 action/work_state）+ 增强场景数据 ──
    hierarchy: dict[str, dict[str, list[str]]] = collections.defaultdict(lambda: collections.defaultdict(list))
    l1_count: collections.Counter = collections.Counter()
    l2_seen: dict[str, set] = collections.defaultdict(set)
    l3_seen: dict[str, set] = collections.defaultdict(set)

    for fn in ("scene_data.jsonl", "scene_training_data_enhanced.jsonl", "scene_training_data.jsonl"):
        p = RAW / fn
        if not p.exists():
            continue
        for row in _iter_jsonl(p):
            l1, l2, l3 = row.get("scene_l1"), row.get("scene_l2"), row.get("scene_l3")
            if not (l1 and l2 and l3):
                continue
            l1_count[l1] += 1
            if l3 not in hierarchy[l1][l2]:
                hierarchy[l1][l2].append(l3)
            l2_seen[l1].add(l2)
            l3_seen[f"{l1}//{l2}"].add(l3)

    # ── work_state / action：全量统计 ──
    ws_count: collections.Counter = collections.Counter()
    act_count: collections.Counter = collections.Counter()
    for fn in ("scene_data.jsonl", "action_data.jsonl"):
        for row in _iter_jsonl(RAW / fn):
            if row.get("work_state"):
                ws_count[row["work_state"]] += 1
            if row.get("action_label"):
                act_count[row["action_label"]] += 1
    for row in _iter_jsonl(RAW / "real_actions.jsonl"):
        ws_count[row["label"]] += 1

    # ── 组装 ──
    l1_options = [
        {"key": l1, "text": l1}
        for l1, _ in sorted(l1_count.items(), key=lambda kv: (-kv[1], kv[0]))
    ]
    if len(l1_options) > 26:
        raise SystemExit(f"scene_l1 选项数 {len(l1_options)} > 26，单字母方案放不下")

    l2_by_parent = {
        l1: [{"key": f"{l1}//{l2}", "text": l2} for l2 in sorted(hierarchy[l1])]
        for l1 in hierarchy
    }
    l3_by_parent = {
        f"{l1}//{l2}": [{"key": f"{l1}//{l2}//{l3}", "text": l3} for l3 in sorted(l3s)]
        for l1, l2s in hierarchy.items()
        for l2, l3s in l2s.items()
    }
    for parent, opts in list(l2_by_parent.items()) + list(l3_by_parent.items()):
        if len(opts) > 26:
            raise SystemExit(f"层级选项 {parent} 有 {len(opts)} 项 > 26")

    # work_state：只保留训练数据出现过的；按出现频次排序
    ws_options = [
        {"key": k, "text": WORK_STATE_TEXT.get(k, k)}
        for k, _ in sorted(ws_count.items(), key=lambda kv: (-kv[1], kv[0]))
    ]
    act_options = [
        {"key": k, "text": ACTION_TEXT.get(k, k)}
        for k, _ in sorted(act_count.items(), key=lambda kv: (-kv[1], kv[0]))
    ]

    config = {
        "version": 1,
        "letters": "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
        "questions": {
            "scene_l1": {"type": "flat", "instructions": L1_INSTRUCTIONS, "options": l1_options},
            "scene_l2": {"type": "child", "parent": "scene_l1", "instructions": L2_INSTRUCTIONS,
                         "options_by_parent": l2_by_parent},
            "scene_l3": {"type": "child", "parent": "scene_l2", "instructions": L3_INSTRUCTIONS,
                         "options_by_parent": l3_by_parent},
            "action": {"type": "flat", "instructions": ACTION_INSTRUCTIONS, "options": act_options},
            "work_state": {"type": "flat", "instructions": WORK_STATE_INSTRUCTIONS, "options": ws_options},
        },
        "order": ["scene_l1", "scene_l2", "scene_l3", "action", "work_state"],
        "stats": {
            "scene_l1": len(l1_options),
            "scene_l2": sum(len(v) for v in l2_by_parent.values()),
            "scene_l3": sum(len(v) for v in l3_by_parent.values()),
            "action": len(act_options),
            "work_state": len(ws_options),
        },
    }
    OUT.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {OUT}")
    print(json.dumps(config["stats"], ensure_ascii=False))
    print("work_state 分布:", dict(ws_count.most_common()))
    print("action 分布:", dict(act_count.most_common()))


if __name__ == "__main__":
    sys.exit(main())
