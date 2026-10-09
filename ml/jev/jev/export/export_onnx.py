#!/usr/bin/env python3
"""LoRA 合并 + ONNX 导出 + int8 动态量化。

为什么要拆成"只出最后一个位置的 logits"
--------------------------------------
我们的打分只需要生成点那一个位置的 logits。若按常规方式导出，
ONNX 输出是 (batch, seq, 151936)，seq=300 时单次就是 180MB，端侧不可用。
包一层 `LastTokenLogits` 后输出变成 (batch, 151936)（约 0.6MB），
端侧用 onnxruntime 直接跑，不需要 torch。

产物
----
    out/merged/            合并 LoRA 后的 HF 模型（可选，用于 transformers 部署）
    out/onnx/model.onnx            fp32
    out/onnx/model.int8.onnx       int8 动态量化（部署用）
    out/onnx/export_report.json    数值一致性校验结果
"""
from __future__ import annotations

import argparse
import json
import shutil
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


def merge_adapter(adapter_dir: Path, base_id: str | None, out_dir: Path, dtype: str = "float32"):
    import torch
    from peft import PeftModel
    from transformers import AutoModelForCausalLM
    cfg = json.loads((adapter_dir / "adapter_config.json").read_text())
    base = base_id or cfg["base_model_name_or_path"]
    m = AutoModelForCausalLM.from_pretrained(base, dtype=torch.float32)
    m = PeftModel.from_pretrained(m, str(adapter_dir))
    m = m.merge_and_unload()
    out_dir.mkdir(parents=True, exist_ok=True)
    m.save_pretrained(out_dir)
    from transformers import AutoTokenizer
    AutoTokenizer.from_pretrained(str(adapter_dir)).save_pretrained(out_dir)
    for extra in ("questions.json", "temperatures.json"):
        src = adapter_dir / extra
        if src.exists():
            shutil.copy(src, out_dir / extra)
    return out_dir


def prepare_for_quant(path: Path) -> None:
    """量化前把 ONNX 图改成 onnxruntime 能接受的形态。**不是可选项。**

    要做两件事：

    1. `graph.value_info` 全删。quantize_dynamic 会先用 strict 模式复算一遍形状，
       而 torch 新版 dynamo 导出器写下的中间张量形状注解与复算结果冲突
       （Qwen3-0.6B 实测报 "dimension 0: (1024) vs (151936)"），量化会直接崩溃。
       value_info 只是注解，删掉不影响推理，ORT 会自行重新推断。

    2. 小于 2GB 时顺带跑 onnxsim 折叠冗余结构；更大的模型不能跑 ——
       protobuf 单条消息上限 2GB，`onnxsim.simplify` 会在序列化时抛
       EncodeError: Failed to serialize proto（这个坑踩过，别再加回来）。

    外部权重文件（model.onnx.data，fp32 约 2.4GB）在保存时按需保留。
    """
    import onnx

    data_file = path.with_name(path.name + ".data")
    total = path.stat().st_size + (data_file.stat().st_size if data_file.exists() else 0)
    use_external = total > 1_400_000_000

    model = onnx.load(str(path))
    if not use_external:
        try:
            import onnxsim
            simplified, ok = onnxsim.simplify(model)
            if ok:
                model = simplified
                print("[prep] onnxsim 折叠完成")
        except Exception as e:  # noqa: BLE001
            print(f"[prep] onnxsim 跳过（{type(e).__name__}: {e}）")
    else:
        print(f"[prep] 模型 {total/1e9:.1f}GB，跳过 onnxsim（protobuf 2GB 限制）")

    n_vi = len(model.graph.value_info)
    del model.graph.value_info[:]
    onnx.save_model(model, str(path), save_as_external_data=use_external,
                    all_tensors_to_one_file=True,
                    location=(path.name + ".data") if use_external else None,
                    size_threshold=1024)
    print(f"[prep] 清掉 {n_vi} 条 value_info（外部权重: {'是' if use_external else '否'}）")


def build_wrapper(merged_dir: Path):
    import torch
    from transformers import AutoModelForCausalLM

    class LastTokenLogits(torch.nn.Module):
        def __init__(self, base):
            super().__init__()
            self.base = base

        def forward(self, input_ids, attention_mask):
            h = self.base.model(input_ids=input_ids, attention_mask=attention_mask).last_hidden_state
            return self.base.lm_head(h[:, -1, :])

    base = AutoModelForCausalLM.from_pretrained(
        str(merged_dir), dtype=torch.float32, attn_implementation="eager")
    # 解绑 lm_head 与 embed_tokens。Qwen3-0.6B 的 tie_word_embeddings=True，
    # 二者共用同一份权重；导出后同一个 initializer 既要当 Gather 的嵌入表（151936×1024），
    # 又要在 lm_head 的 Gemm 里当权重（1024×151936），strict shape inference 会判定
    # "dimension 0: 1024 vs 151936" 冲突，量化必崩。克隆一份即可（仅导出期多占 ~600MB）。
    if getattr(base.config, "tie_word_embeddings", False):
        base.lm_head.weight = torch.nn.Parameter(base.model.embed_tokens.weight.detach().clone())
        base.config.tie_word_embeddings = False
        print("[export] 已解绑 lm_head / embed_tokens")
    base.eval()
    return LastTokenLogits(base), base


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=str(ROOT / "out" / "lora"), help="LoRA adapter 或已合并模型目录")
    ap.add_argument("--base", default=None)
    ap.add_argument("--out", default=str(ROOT / "out" / "onnx"))
    ap.add_argument("--merged", default=str(ROOT / "out" / "merged"))
    ap.add_argument("--opset", type=int, default=17)
    ap.add_argument("--skip-quant", action="store_true")
    ap.add_argument("--keep-fp32", action="store_true", help="保留 fp32 的 model.onnx（默认量化后删掉）")
    ap.add_argument("--skip-simplify", action="store_true",
                    help="跳过量化前处理（会因 strict shape inference 失败，仅调试用）")
    ap.add_argument("--threads", type=int, default=0, help="量化后校验用线程数（0=默认）")
    args = ap.parse_args()

    import torch
    model_dir = Path(args.model)
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    if (model_dir / "adapter_config.json").exists():
        print(f"[export] 合并 LoRA {model_dir} -> {args.merged}")
        merged = merge_adapter(model_dir, args.base, Path(args.merged))
    else:
        merged = model_dir
        print(f"[export] 已是完整模型：{merged}")

    wrapper, base = build_wrapper(merged)
    dummy_ids = torch.randint(0, 1000, (1, 128), dtype=torch.long)
    dummy_mask = torch.ones_like(dummy_ids)

    fp32_path = out_dir / "model.onnx"
    print(f"[export] torch.onnx.export -> {fp32_path}")
    t0 = time.time()
    torch.onnx.export(
        wrapper, (dummy_ids, dummy_mask), str(fp32_path),
        input_names=["input_ids", "attention_mask"], output_names=["logits"],
        dynamic_axes={"input_ids": {0: "batch", 1: "sequence"},
                      "attention_mask": {0: "batch", 1: "sequence"},
                      "logits": {0: "batch"}},
        opset_version=args.opset, do_constant_folding=True,
    )
    print(f"[export] 导出完成 {time.time()-t0:.0f}s, "
          f"{fp32_path.stat().st_size/1e6:.0f} MB")

    prepare_for_quant(fp32_path)

    # 至少把 tokenizer / 选项表 / 温度放进 onnx 目录，端侧一个目录就够
    for extra in ("tokenizer.json", "tokenizer_config.json", "vocab.json", "merges.txt",
                  "questions.json", "temperatures.json"):
        src = Path(merged) / extra
        if src.exists():
            shutil.copy(src, out_dir / extra)

    # ── 数值一致性校验 ──
    import numpy as np
    import onnxruntime as ort

    def make_sess(path: Path):
        so = ort.SessionOptions()
        if args.threads:
            so.intra_op_num_threads = args.threads
        return ort.InferenceSession(str(path), so, providers=["CPUExecutionProvider"])

    torch.manual_seed(0)
    cases = []
    for T in (64, 200, 417):
        ids = torch.randint(0, 151000, (1, T), dtype=torch.long)
        ids[0, 0] = 1
        mask = torch.ones_like(ids)
        cases.append((ids, mask))

    with torch.no_grad():
        torch_logits = [wrapper(i, m)[0].numpy() for i, m in cases]
    sess = make_sess(fp32_path)
    onnx_logits = [sess.run(None, {"input_ids": i.numpy(), "attention_mask": m.numpy()})[0][0]
                   for i, m in cases]

    def compare(name: str, ref, got) -> dict:
        # 只比"答案字母"所在的前 26 个坐标 + 全量 top1 一致性
        top1 = int(np.argmax(got))
        letters_ref = np.argsort(-ref)[:5].tolist()
        letters_got = np.argsort(-got)[:5].tolist()
        return {
            "case": name, "top1_torch": int(np.argmax(ref)), "top1_onnx": top1,
            "top5_same": letters_ref == letters_got,
            "max_abs_diff": float(np.abs(ref - got).max()),
            "mean_abs_diff": float(np.abs(ref - got).mean()),
        }

    report = {"model": str(model_dir), "merged": str(merged), "opset": args.opset,
              "fp32_mb": round(fp32_path.stat().st_size / 1e6, 1), "checks": []}
    for (i, m), ref, got in zip(cases, torch_logits, onnx_logits):
        r = compare(f"T={i.shape[1]}", ref, got)
        report["checks"].append(r)
        print(f"  T={i.shape[1]}: top1 torch={r['top1_torch']} onnx={r['top1_onnx']} "
              f"top5一致={r['top5_same']} max|Δ|={r['max_abs_diff']:.3e}")

    if not args.skip_quant:
        from onnxruntime.quantization import QuantType, quantize_dynamic
        q_path = out_dir / "model.int8.onnx"
        print(f"[quant] 动态 int8 量化 -> {q_path}")
        t0 = time.time()
        quantize_dynamic(str(fp32_path), str(q_path), weight_type=QuantType.QInt8,
                         extra_options={"MatMulConstBOnly": True})
        print(f"[quant] 完成 {time.time()-t0:.0f}s, {q_path.stat().st_size/1e6:.0f} MB")
        qsess = make_sess(q_path)
        q_logits = [qsess.run(None, {"input_ids": i.numpy(), "attention_mask": m.numpy()})[0][0]
                    for i, m in cases]
        report["int8_mb"] = round(q_path.stat().st_size / 1e6, 1)
        report["int8_checks"] = []
        for (i, m), ref, got in zip(cases, torch_logits, q_logits):
            r = compare(f"T={i.shape[1]}", ref, got)
            report["int8_checks"].append(r)
            print(f"  int8 T={i.shape[1]}: top1 {r['top1_onnx']}（torch {r['top1_torch']}）"
                  f" top5一致={r['top5_same']} max|Δ|={r['max_abs_diff']:.3e}")

    (out_dir / "export_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2),
                                                encoding="utf-8")
    print(f"[export] 报告 -> {out_dir / 'export_report.json'}")

    if not args.keep_fp32 and (out_dir / "model.int8.onnx").exists():
        for junk in ("model.onnx", "model.onnx.data"):
            f = out_dir / junk
            if f.exists():
                f.unlink()
                print(f"[clean] 删除 fp32 中间产物 {junk}（--keep-fp32 可保留）")


if __name__ == "__main__":
    main()
