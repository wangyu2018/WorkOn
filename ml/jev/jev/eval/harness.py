"""评测/校准共用的 teacher-forcing 打分器。

给定一批样本（messages 里已含金标答案），**一次前向**即可取到每题答案位置
在候选字母上的 logits —— 与训练时的 answer_loss 同一套位置口径，因此：
  * 校准（拟合逐题温度）和评测（准确率/ECE）都不需要跑自回归解码，快且无偏；
  * 注意这是 "oracle parent" 口径：层级题的父节点用金标，衡量的是单题能力；
    端到端级联口径见 evaluate.py 的 --cascade。
"""
from __future__ import annotations

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

import torch  # noqa: E402

from jev.prompt import tokenize_supervised  # noqa: E402


def collate_rows(tok, rows: list[dict], max_len: int):
    feats = [tokenize_supervised(tok, r["messages"], r["turn_weights"], max_len) for r in rows]
    maxlen = max(len(f[0]) for f in feats)
    bs = len(feats)
    input_ids = torch.zeros((bs, maxlen), dtype=torch.long)
    attn = torch.zeros((bs, maxlen), dtype=torch.long)
    slots: list[tuple[int, int, str, int, int]] = []  # (row, t-1, question, n_options, gold_idx)
    for i, (ids, labels, _w) in enumerate(feats):
        n = len(ids)
        input_ids[i, :n] = torch.tensor(ids, dtype=torch.long)
        attn[i, :n] = 1
        k = 0
        for t in range(1, len(labels)):
            if labels[t] != -100:
                q = rows[i]["questions"][k]
                n_opt = rows[i]["turn_options"][k]
                gold = rows[i]["turn_gold"][k]
                slots.append((i, t - 1, q, n_opt, ord(gold) - 65))
                k += 1
    return input_ids, attn, slots


@torch.no_grad()
def score_rows(engine, rows: list[dict], *, batch_size: int = 8, max_len: int = 896) -> list[dict]:
    """返回每条已打分记录：{id, source, question, logits(选项上), gold, n_options}。"""
    base = engine.model.get_base_model() if hasattr(engine.model, "get_base_model") else engine.model
    letter_ids = torch.tensor(engine.letter_ids, dtype=torch.long, device=engine.device)
    out: list[dict] = []
    for s in range(0, len(rows), batch_size):
        chunk = rows[s:s + batch_size]
        input_ids, attn, slots = collate_rows(engine.tok, chunk, max_len)
        if not slots:
            continue
        input_ids = input_ids.to(engine.device)
        attn = attn.to(engine.device)
        hidden = base.model(input_ids=input_ids, attention_mask=attn).last_hidden_state
        bi = torch.tensor([x[0] for x in slots], dtype=torch.long, device=engine.device)
        ti = torch.tensor([x[1] for x in slots], dtype=torch.long, device=engine.device)
        logits = base.lm_head(hidden[bi, ti]).float()
        letter_logits = logits[:, letter_ids]  # (N, 26)
        for j, (i, _t, q, n_opt, gold) in enumerate(slots):
            out.append({
                "id": chunk[i]["id"], "source": chunk[i]["source"], "question": q,
                "logits": letter_logits[j, :n_opt].tolist(),
                "gold": gold, "n_options": n_opt,
            })
    return out
