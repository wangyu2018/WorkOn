#!/usr/bin/env python3
"""WorkOn-Jev · LoRA SFT 训练（Apple Silicon MPS / CPU）

要点
----
* 只对 assistant 的**答案字母**算损失（非答案 token 权重为 0），并按来源加权
  （合成数据的 work_state/action 权重 0.35，见 data/build.py）。
* 长度分桶批采样：真实行 ~150 token、场景行 ~830 token，混在一起会被 padding 拖死。
* 训练完只存 LoRA adapter + tokenizer + 选项表，合并/量化在 export 阶段做。
"""
from __future__ import annotations

import argparse
import json
import math
import os
import random
import sys
import time
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
import torch.nn.functional as F  # noqa: E402
from torch.utils.data import Dataset  # noqa: E402
from transformers import AutoModelForCausalLM, AutoTokenizer  # noqa: E402

from jev.prompt import tokenize_supervised  # noqa: E402


class ConvDataset(Dataset):
    """按需分词（不缓存：36k 条全量 Python int 列表会吃掉好几 GB）。"""

    def __init__(self, path: Path, tok, max_len: int, shuffle: bool = False, seed: int = 0):
        self.rows = [json.loads(l) for l in path.open(encoding="utf-8") if l.strip()]
        if shuffle:
            random.Random(seed).shuffle(self.rows)
        self.tok = tok
        self.max_len = max_len
        self._lengths: list[int] | None = None

    def __len__(self) -> int:
        return len(self.rows)

    def __getitem__(self, i: int):
        r = self.rows[i]
        return tokenize_supervised(self.tok, r["messages"], r["turn_weights"], self.max_len)

    def lengths(self) -> list[int]:
        if self._lengths is None:
            self._lengths = [len(self[i][0]) for i in range(len(self))]
        return self._lengths


def collate(batch, pad_id: int):
    maxlen = max(len(x[0]) for x in batch)
    bs = len(batch)
    input_ids = torch.full((bs, maxlen), pad_id, dtype=torch.long)
    labels = torch.full((bs, maxlen), -100, dtype=torch.long)
    weights = torch.zeros((bs, maxlen), dtype=torch.float)
    attn = torch.zeros((bs, maxlen), dtype=torch.long)
    for i, (ids, lab, w) in enumerate(batch):
        n = len(ids)
        input_ids[i, :n] = torch.tensor(ids, dtype=torch.long)
        labels[i, :n] = torch.tensor(lab, dtype=torch.long)
        weights[i, :n] = torch.tensor(w, dtype=torch.float)
        attn[i, :n] = 1
    # 只保留"答案 token"（每题一个字母）：记下它的**前一个位置**用于取 logits
    pos, tgt, wgt = [], [], []
    for i in range(bs):
        for t in range(1, maxlen):
            if labels[i, t] != -100:
                pos.append((i, t - 1))
                tgt.append(int(labels[i, t]))
                wgt.append(float(weights[i, t]))
    return {
        "input_ids": input_ids, "attention_mask": attn,
        "answer_pos": torch.tensor(pos, dtype=torch.long).reshape(-1, 2),
        "answer_target": torch.tensor(tgt, dtype=torch.long),
        "answer_weight": torch.tensor(wgt, dtype=torch.float),
        "n_tokens": int(attn.sum()),
    }


def answer_loss(base, batch: dict) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
    """只在答案位算 LM head —— 全序列 logits 是 (B,T,151936)，MPS 上必 OOM。"""
    hidden = base.model(input_ids=batch["input_ids"],
                        attention_mask=batch["attention_mask"]).last_hidden_state
    pos = batch["answer_pos"]
    h = hidden[pos[:, 0], pos[:, 1]]
    logits = base.lm_head(h).float()
    loss = F.cross_entropy(logits, batch["answer_target"], reduction="none")
    w = batch["answer_weight"]
    return (loss * w).sum(), w.sum()


def length_bucketed_batches(lengths: list[int], batch_size: int, seed: int,
                            token_budget: int = 1400) -> list[list[int]]:
    """按长度分桶 + **token 预算动态组批**。

    同长度桶内，只要"最大行长 × 条数"不超过 token_budget 就继续塞。
    这样 150 token 的真实行一次能塞 8 条，880 token 的场景行只放 1-2 条，
    单批 padding 后的总 token 数有上界 => 显存峰值有上界（16G 机器上这点很关键），
    同时短行不会再被长行的 padding 拖累。
    """
    rng = random.Random(seed)
    order = sorted(range(len(lengths)), key=lambda i: lengths[i])
    batches: list[list[int]] = []
    cur: list[int] = []
    for i in order:
        cand = cur + [i]
        if cur and (max(lengths[j] for j in cand) * len(cand) > token_budget or len(cand) > batch_size):
            batches.append(cur)
            cur = [i]
        else:
            cur = cand
    if cur:
        batches.append(cur)
    if len(batches) > 1 and len(batches[-1]) == 1:
        batches[-2].extend(batches.pop())
    rng.shuffle(batches)
    return batches


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="Qwen/Qwen3-0.6B")
    ap.add_argument("--data-dir", default=str(ROOT / "data" / "processed"))
    ap.add_argument("--out", default=str(ROOT / "out" / "lora"))
    ap.add_argument("--max-len", type=int, default=896)
    ap.add_argument("--batch-size", type=int, default=8, help="单批最大条数（还要受 token 预算限制）")
    ap.add_argument("--token-budget", type=int, default=1400, help="单批 padding 后的 token 上界")
    ap.add_argument("--grad-accum", type=int, default=2)
    ap.add_argument("--lr", type=float, default=2e-4)
    ap.add_argument("--epochs", type=float, default=2.0)
    ap.add_argument("--warmup-ratio", type=float, default=0.03)
    ap.add_argument("--weight-decay", type=float, default=0.01)
    ap.add_argument("--lora-r", type=int, default=16)
    ap.add_argument("--lora-alpha", type=int, default=32)
    ap.add_argument("--lora-dropout", type=float, default=0.05)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--limit", type=int, default=0, help="只用 N 条（冒烟测试；会先打散）")
    ap.add_argument("--attn", default="sdpa", choices=["sdpa", "eager", "flash_attention_2"])
    ap.add_argument("--resume-from", default=None, help="从已有 LoRA adapter 续训（跑第二个 epoch 用）")
    ap.add_argument("--grad-ckpt", type=int, default=0, help="1=开梯度检查点（省显存、慢一些）")
    ap.add_argument("--max-steps", type=int, default=0, help=">0 则只用这么多优化步（冒烟测试）")
    ap.add_argument("--eval-every", type=int, default=400)
    ap.add_argument("--save-every", type=int, default=400, help="每 N 步存一份 adapter 快照（0=不存）")
    ap.add_argument("--empty-cache-every", type=int, default=25,
                    help="每 N 步 torch.mps.empty_cache()。MPS 分配器不会主动把空闲显存还给系统，"
                         "不回收的话 wired 会一路涨到把机器压进 swap（实测 13G wired / 1.6 步每分钟）")
    ap.add_argument("--device", default="auto", choices=["auto", "mps", "cpu"])
    ap.add_argument("--dtype", default="auto", choices=["auto", "bf16", "fp32"])
    args = ap.parse_args()

    random.seed(args.seed)
    torch.manual_seed(args.seed)

    if args.device == "auto":
        device = "mps" if torch.backends.mps.is_available() else "cpu"
    else:
        device = args.device
    if args.dtype == "auto":
        dtype = torch.bfloat16 if device == "mps" else torch.float32
    else:
        dtype = torch.bfloat16 if args.dtype == "bf16" else torch.float32

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    print(f"[cfg] device={device} dtype={dtype} batch={args.batch_size} accum={args.grad_accum} "
          f"lr={args.lr} epochs={args.epochs} max_len={args.max_len}")

    tok = AutoTokenizer.from_pretrained(args.model)
    if tok.pad_token_id is None:
        tok.pad_token = tok.eos_token

    print("[data] 读取并分词 ...")
    t0 = time.time()
    train_ds = ConvDataset(Path(args.data_dir) / "train.jsonl", tok, args.max_len,
                           shuffle=bool(args.limit), seed=args.seed)
    val_ds = ConvDataset(Path(args.data_dir) / "val.jsonl", tok, args.max_len)
    if args.limit:
        train_ds.rows = train_ds.rows[: args.limit]
        val_ds.rows = val_ds.rows[: max(64, min(len(val_ds.rows), args.limit // 8))]
    train_ds._lengths = None; val_ds._lengths = None
    print(f"[data] train={len(train_ds)} val={len(val_ds)}  分词耗时 {time.time()-t0:.0f}s")

    print("[model] 加载底座 ...")
    model = AutoModelForCausalLM.from_pretrained(args.model, dtype=dtype, attn_implementation=args.attn)
    model.config.use_cache = False

    from peft import LoraConfig, get_peft_model
    lora_cfg = LoraConfig(
        r=args.lora_r, lora_alpha=args.lora_alpha, lora_dropout=args.lora_dropout,
        bias="none", task_type="CAUSAL_LM",
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
    )
    if args.resume_from:
        from peft import PeftModel
        model = PeftModel.from_pretrained(model, args.resume_from, is_trainable=True)
        print(f"[model] 从 {args.resume_from} 续训")
    else:
        model = get_peft_model(model, lora_cfg)
    if args.grad_ckpt:
        model.enable_input_require_grads()
        model.gradient_checkpointing_enable()
    model.to(device)
    n_train = sum(p.numel() for p in model.parameters() if p.requires_grad)
    n_all = sum(p.numel() for p in model.parameters())
    print(f"[model] 可训练参数 {n_train/1e6:.2f}M / 总参数 {n_all/1e6:.1f}M ({100*n_train/n_all:.2f}%)")

    lengths = train_ds.lengths()
    batches = length_bucketed_batches(lengths, args.batch_size, args.seed, args.token_budget)
    steps_per_epoch = max(1, len(batches) // args.grad_accum)
    total_steps = int(steps_per_epoch * args.epochs)
    if args.max_steps:
        total_steps = min(total_steps, args.max_steps)
    warmup = max(1, int(total_steps * args.warmup_ratio))
    print(f"[plan] {len(batches)} 批/epoch, {steps_per_epoch} 优化步/epoch, 总计 {total_steps} 步, warmup {warmup}")

    opt = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad],
                            lr=args.lr, weight_decay=args.weight_decay, betas=(0.9, 0.95))

    def lr_at(step: int) -> float:
        if step < warmup:
            return args.lr * (step + 1) / warmup
        prog = (step - warmup) / max(1, total_steps - warmup)
        return 0.5 * args.lr * (1 + math.cos(math.pi * min(1.0, prog)))

    base = model.get_base_model()

    def run_eval(max_batches: int = 40) -> float:
        model.eval()
        tot_loss = 0.0
        tot_w = 0.0
        with torch.no_grad():
            for idxs in length_bucketed_batches(val_ds.lengths(), args.batch_size, 0, args.token_budget)[:max_batches]:
                b = collate([val_ds[i] for i in idxs], tok.pad_token_id)
                b = {k: (v.to(device) if torch.is_tensor(v) else v) for k, v in b.items()}
                s, w = answer_loss(base, b)
                tot_loss += float(s)
                tot_w += float(w)
        model.train()
        return tot_loss / max(tot_w, 1e-6)

    model.train()
    step = 0
    micro = 0
    t_start = time.time()
    tok_seen = 0
    running = 0.0
    running_w = 0.0
    done = False
    log_path = out_dir / "train_log.jsonl"
    log_f = log_path.open("w", encoding="utf-8")

    for epoch in range(math.ceil(args.epochs)):
        if done:
            break
        random.Random(args.seed + epoch).shuffle(batches)
        for batch_idxs in batches:
            if step >= total_steps:
                done = True
                break
            b = collate([train_ds[i] for i in batch_idxs], tok.pad_token_id)
            b = {k: (v.to(device) if torch.is_tensor(v) else v) for k, v in b.items()}
            tok_seen += b["n_tokens"]
            s, w = answer_loss(base, b)
            loss = s / w.clamp(min=1e-6)
            (loss / args.grad_accum).backward()
            running += float(s.detach())
            running_w += float(w)
            micro += 1

            if micro % args.grad_accum == 0:
                torch.nn.utils.clip_grad_norm_([p for p in model.parameters() if p.requires_grad], 1.0)
                lr = lr_at(step)
                for g in opt.param_groups:
                    g["lr"] = lr
                opt.step()
                opt.zero_grad(set_to_none=True)
                step += 1
                if step % 20 == 0 or step == 1:
                    el = time.time() - t_start
                    rec = {"step": step, "total_steps": total_steps, "loss": running / max(running_w, 1e-6),
                           "lr": lr, "tok_per_s": tok_seen / max(el, 1e-6), "elapsed_s": round(el, 1)}
                    print(f"  step {step}/{total_steps} loss={rec['loss']:.4f} lr={lr:.2e} "
                          f"{rec['tok_per_s']:.0f} tok/s  {el/60:.1f}min", flush=True)
                    log_f.write(json.dumps(rec) + "\n"); log_f.flush()
                    running = 0.0; running_w = 0.0
                if args.eval_every and step % args.eval_every == 0:
                    vl = run_eval()
                    print(f"  [eval] step {step} val_loss={vl:.4f}", flush=True)
                    log_f.write(json.dumps({"step": step, "val_loss": vl}) + "\n"); log_f.flush()
                if args.empty_cache_every and step % args.empty_cache_every == 0 and device == "mps":
                    torch.mps.empty_cache()
                if args.save_every and step % args.save_every == 0:
                    snap = out_dir / f"step-{step}"
                    model.save_pretrained(snap)
                    tok.save_pretrained(snap)
                    import shutil as _sh
                    _sh.copy(ROOT / "configs" / "questions.json", snap / "questions.json")
                    print(f"  [ckpt] {snap}", flush=True)

    vl = run_eval(max_batches=80)
    print(f"[done] {step} 步, val_loss={vl:.4f}, 用时 {(time.time()-t_start)/60:.1f} 分钟")

    model.save_pretrained(out_dir)
    tok.save_pretrained(out_dir)
    import shutil
    shutil.copy(ROOT / "configs" / "questions.json", out_dir / "questions.json")
    (out_dir / "train_config.json").write_text(json.dumps({
        **vars(args), "device": device, "dtype": str(dtype), "steps": step, "val_loss": vl,
        "trainable_params": n_train, "total_params": n_all, "tokens_seen": tok_seen,
    }, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    log_f.close()
    print(f"[save] adapter -> {out_dir}")


if __name__ == "__main__":
    main()
