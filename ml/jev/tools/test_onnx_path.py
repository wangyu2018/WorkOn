#!/usr/bin/env python3
"""用同架构的**微型模型**验证 ONNX 导出 -> int8 动态量化 -> onnxruntime 数值一致。

为什么不直接拿 0.6B 试：量化过程要同时装下 fp32 权重（2.4GB）和输出，
在 16G 机器上会和训练抢内存（实测会把训练拖进 swap）。
微型模型能把整条代码路径（含 torch.onnx.export 的 opset 20 导出、
quantize_dynamic 的 MatMulConstBOnly 选项、onnxruntime 会话加载）全跑一遍。
"""
from __future__ import annotations

import argparse
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import numpy as np  # noqa: E402
import torch  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--opset", type=int, default=20)
    args = ap.parse_args()

    from transformers import Qwen3Config, Qwen3ForCausalLM

    torch.manual_seed(0)
    tmp = Path(tempfile.mkdtemp(prefix="jev-onnx-"))
    cfg = Qwen3Config(vocab_size=512, hidden_size=128, intermediate_size=256,
                      num_hidden_layers=2, num_attention_heads=4, num_key_value_heads=2,
                      max_position_embeddings=512, tie_word_embeddings=False)
    base = Qwen3ForCausalLM(cfg).eval()
    print(f"[tiny] Qwen3 微型模型 {sum(p.numel() for p in base.parameters())/1e6:.2f}M 参数")

    sys.path.insert(0, str(ROOT))
    from jev.export.export_onnx import build_wrapper  # noqa: E402

    # 直接复用交付脚本里的 wrapper 构造方式（同一个 _THINK/末位 logits 口径）
    class LastTokenLogits(torch.nn.Module):
        def __init__(self, b):
            super().__init__()
            self.base = b

        def forward(self, input_ids, attention_mask):
            h = self.base.model(input_ids=input_ids, attention_mask=attention_mask).last_hidden_state
            return self.base.lm_head(h[:, -1, :])

    wrapper = LastTokenLogits(base)
    fp32 = tmp / "model.onnx"
    dummy = (torch.randint(0, 512, (1, 64), dtype=torch.long),
             torch.ones((1, 64), dtype=torch.long))
    torch.onnx.export(
        wrapper, dummy, str(fp32),
        input_names=["input_ids", "attention_mask"], output_names=["logits"],
        dynamic_axes={"input_ids": {0: "batch", 1: "sequence"},
                      "attention_mask": {0: "batch", 1: "sequence"},
                      "logits": {0: "batch"}},
        opset_version=args.opset, do_constant_folding=True)
    print(f"[tiny] 导出成功 opset={args.opset} {fp32.stat().st_size/1e6:.2f} MB")

    from jev.export.export_onnx import prepare_for_quant
    prepare_for_quant(fp32)

    from onnxruntime.quantization import QuantType, quantize_dynamic
    q8 = tmp / "model.int8.onnx"
    quantize_dynamic(str(fp32), str(q8), weight_type=QuantType.QInt8,
                     extra_options={"MatMulConstBOnly": True})
    print(f"[tiny] int8 量化成功 {q8.stat().st_size/1e6:.2f} MB "
          f"（压到 {100*q8.stat().st_size/fp32.stat().st_size:.0f}%）")

    import onnxruntime as ort
    sess = ort.InferenceSession(str(q8), providers=["CPUExecutionProvider"])
    ok = 0
    top1_ok = 0
    worst = 0.0
    for T in (32, 96, 200):
        ids = torch.randint(0, 512, (1, T), dtype=torch.long)
        mask = torch.ones_like(ids)
        with torch.no_grad():
            ref = wrapper(ids, mask)[0].numpy()
        got = sess.run(None, {"input_ids": ids.numpy(), "attention_mask": mask.numpy()})[0][0]
        worst = max(worst, float(np.abs(ref - got).max()))
        same = np.argsort(-ref)[:5].tolist() == np.argsort(-got)[:5].tolist()
        ok += same
        top1_ok += int(np.argmax(ref) == np.argmax(got))
        print(f"[tiny] T={T:4d} top1 torch={int(np.argmax(ref))} onnx={int(np.argmax(got))} "
              f"top5一致={same} max|Δ|={np.abs(ref-got).max():.3e}")
    print(f"\n结果：top1 一致 {top1_ok}/3，top5 一致 {ok}/3，最大 logit 偏差 {worst:.3e}")
    if top1_ok == 3 and worst < 0.1:
        print("ONNX 路径（导出 -> onnxsim -> int8 动态量化 -> onnxruntime 加载）验证通过 ✓")
        if ok < 3:
            print("注：这是**随机初始化**的微型模型，logits 几乎并列，top5 顺序本来就会被 int8 噪声打乱；"
                  "训好的模型上请看 selftest.py 的 ONNX/torch 决策一致性检查。")
    else:
        print("存在不一致，需要检查")
    import shutil
    shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
