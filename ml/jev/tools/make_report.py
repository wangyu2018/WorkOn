#!/usr/bin/env python3
"""把评测/校准/训练产物汇总成 REPORT.md。"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

Q_CN = {"scene_l1": "场景一级", "scene_l2": "场景二级", "scene_l3": "场景三级",
        "action": "动作类别", "work_state": "工作状态"}
SRC_CN = {"real_actions": "真实行为（22745 条里划出的测试集）",
          "scene_data": "合成·场景+状态桥接集", "scene_extra": "合成·场景补充"}


def load(p: Path, default=None):
    if p.exists():
        return json.loads(p.read_text(encoding="utf-8"))
    return default


def table(headers: list[str], rows: list[list]) -> str:
    out = ["| " + " | ".join(headers) + " |", "|" + "|".join(["---"] * len(headers)) + "|"]
    for r in rows:
        out.append("| " + " | ".join(str(x) for x in r) + " |")
    return "\n".join(out)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--eval", default=str(ROOT / "out" / "eval_report.json"))
    ap.add_argument("--train-config", default=str(ROOT / "out" / "lora" / "train_config.json"))
    ap.add_argument("--temps", default=str(ROOT / "out" / "lora" / "temperatures.json"))
    ap.add_argument("--data-stats", default=str(ROOT / "data" / "processed" / "stats.json"))
    ap.add_argument("--baseline", default=str(ROOT / "out" / "baseline.json"))
    ap.add_argument("--baseline-retrain", default=str(ROOT / "out" / "baseline_retrain.json"))
    ap.add_argument("--onnx", default=str(ROOT / "out" / "onnx" / "export_report.json"))
    ap.add_argument("--out", default=str(ROOT / "REPORT.md"))
    args = ap.parse_args()

    ev = load(Path(args.eval))
    if not ev:
        raise SystemExit(f"缺少评测结果 {args.eval}，先跑 evaluate.py")
    tc = load(Path(args.train_config), {})
    temps = load(Path(args.temps), {})
    stats = load(Path(args.data_stats), {})
    base = load(Path(args.baseline))
    base_rt = load(Path(args.baseline_retrain))
    onnx = load(Path(args.onnx))

    L: list[str] = []
    L.append("# WorkOn-Jev 实测报告\n")
    L.append(f"> 模型：`{ev.get('model')}`　测试集：`{ev.get('data')}`　样本：{ev.get('n_rows')}\n")

    # ── 1. 训练配置 ──
    if tc:
        L.append("## 1. 训练配置\n")
        L.append(table(["项", "值"], [
            ["底座", tc.get("model", "-")],
            ["设备 / 精度", f"{tc.get('device')} / {tc.get('dtype')}"],
            ["LoRA", f"r={tc.get('lora_r')} alpha={tc.get('lora_alpha')} dropout={tc.get('lora_dropout')}"],
            ["可训练参数", f"{tc.get('trainable_params', 0)/1e6:.2f}M / {tc.get('total_params', 0)/1e6:.1f}M "
                            f"({100*tc.get('trainable_params',0)/max(tc.get('total_params',1),1):.2f}%)"],
            ["批 / 累积 / token 预算", f"{tc.get('batch_size')} / {tc.get('grad_accum')} / {tc.get('token_budget')}"],
            ["max_len / lr / epochs", f"{tc.get('max_len')} / {tc.get('lr')} / {tc.get('epochs')}"],
            ["梯度检查点", "开" if tc.get("grad_ckpt") else "关"],
            ["优化步 / 见过 token", f"{tc.get('steps')} / {tc.get('tokens_seen', 0)/1e6:.2f}M"],
            ["最终 val loss", f"{tc.get('val_loss', float('nan')):.4f}"],
        ]) + "\n")

    # ── 2. 数据 ──
    if stats:
        L.append("## 2. 训练数据\n")
        L.append(table(["划分", "条数"], [[k, v] for k, v in stats.get("splits", {}).items()]) + "\n")
        L.append(table(["来源", "条数"], [[k, v] for k, v in stats.get("by_source", {}).items()]) + "\n")

    # ── 3. 分题指标（oracle 口径）──
    L.append("## 3. 分题指标（oracle 口径：层级题的父节点用金标）\n")
    rows = []
    for r in ev.get("by_question", []):
        a = r.get("automation", {})
        rows.append([
            Q_CN.get(r["group"], r["group"]), r["n"], f"{r['accuracy']:.3f}", f"{r['macro_f1']:.3f}",
            f"{r['nll']:.3f}", f"{r['ece']:.3f}",
            f"{a.get('budget_1pct', {}).get('coverage', 0):.2f}",
            f"{a.get('budget_5pct', {}).get('coverage', 0):.2f}",
            f"{a.get('budget_10pct', {}).get('coverage', 0):.2f}",
        ])
    L.append(table(["题目", "n", "准确率", "macro-F1", "NLL", "ECE",
                    "1%预算\n自动化率", "5%预算\n自动化率", "10%预算\n自动化率"], rows) + "\n")
    L.append("> 「x% 预算自动化率」= 按置信度从高到低取，错误率不超过 x% 时最多能自动执行的比例。\n"
             "> WorkOn 决策层实际用的阈值是 `prob >= 0.75`，所以这一列比准确率更贴近收益。\n")

    # ── 4. 分来源 ──
    L.append("## 4. 分来源（真实 vs 合成）\n")
    rows = [[SRC_CN.get(r["group"], r["group"]), r["n"], f"{r['accuracy']:.3f}",
             f"{r['macro_f1']:.3f}", f"{r['ece']:.3f}"] for r in ev.get("by_source", [])]
    L.append(table(["来源", "n", "准确率", "macro-F1", "ECE"], rows) + "\n")
    L.append("> **真实行才是可信数字**：合成场景行（含 ui_layout / OCR 关键词模板）的精度含模板成分。\n")

    # ── 5. 交叉：来源 × 题目 ──
    L.append("## 5. 来源 × 题目\n")
    rows = []
    for r in ev.get("by_question_source", []):
        src, _, q = r["group"].partition("::")
        rows.append([SRC_CN.get(src, src), Q_CN.get(q, q), r["n"], f"{r['accuracy']:.3f}",
                     f"{r['macro_f1']:.3f}", f"{r['ece']:.3f}"])
    L.append(table(["来源", "题目", "n", "准确率", "macro-F1", "ECE"], rows) + "\n")

    # ── 6. 温度校准 ──
    if temps.get("report"):
        L.append("## 6. 逐题温度校准\n")
        rows = []
        for q, rep in temps["report"].items():
            b, a = rep["before"], rep["after"]
            rows.append([Q_CN.get(q, q), rep["n"], rep["temperature"],
                         f"{b['summary']['accuracy']:.3f}", f"{b['nll']:.3f}", f"{b['ece']:.3f}",
                         f"{a['nll']:.3f}", f"{a['ece']:.3f}",
                         f"{a['summary']['mean_confidence']:.3f}"])
        L.append(table(["题目", "n", "温度 T", "准确率", "NLL(前)", "ECE(前)", "NLL(后)", "ECE(后)",
                        "平均置信度"], rows) + "\n")
        L.append("**可靠性（校准后）**\n")
        for q, rep in temps["report"].items():
            rel = rep.get("reliability_after") or []
            if not rel:
                continue
            L.append(f"\n<details><summary>{Q_CN.get(q, q)}</summary>\n")
            L.append(table(["置信度区间", "n", "平均置信度", "实际正确率"],
                           [[x["bin"], x["n"], x["confidence"], x["accuracy"]] for x in rel]))
            L.append("\n</details>\n")

    # ── 7. 端到端级联 ──
    if ev.get("cascade"):
        c = ev["cascade"]
        L.append("## 7. 端到端级联（父节点用模型自己的答案）\n")
        L.append(f"总体准确率 **{c['accuracy']:.4f}**（n={c['n']}）\n")
        L.append(table(["题目", "n", "准确率"],
                       [[Q_CN.get(q, q), v["n"], f"{v['acc']:.4f}"] for q, v in c["per_question"].items()]) + "\n")
        L.append(table(["来源", "n", "准确率"],
                       [[SRC_CN.get(s, s), v["n"], f"{v['acc']:.4f}"] for s, v in c["per_source"].items()]) + "\n")
        L.append("> 与 §3 的 oracle 口径对比：掉得越多，说明层级结构在放大上游错误。\n")

    # ── 8. 与 XGBoost 对比 ──
    if base_rt:
        L.append("## 8. 与 XGBoost 对比（真实行为数据，work_state 单题）\n")
        L.append("### 8.1 同起跑线：同一份 train/test 划分重训的 XGBoost\n")
        x = base_rt["xgboost_retrained"]; mj = base_rt["majority_class"]
        jev = next((v for k, v in (base or {}).get("models", {}).items() if k.startswith("WorkOn-Jev")), None)
        rows = [
            ["多数类基线（一直预测 " + mj["class"] + "）", base_rt["n_test"], f"{mj['accuracy']:.4f}", "—", "—", "—"],
            ["XGBoost（同划分重训）", base_rt["n_test"], f"{x['accuracy']:.4f}", f"{x['macro_f1']:.4f}",
             f"{x['coverage_at_0.75']:.4f}", f"{x['precision_at_0.75']:.4f}"],
        ]
        if jev:
            rows.append(["WorkOn-Jev (Qwen3-0.6B + LoRA)", jev.get("n"), f"{jev.get('accuracy'):.4f}",
                         f"{jev.get('macro_f1'):.4f}", f"{jev.get('coverage_at_0.75', 0):.4f}",
                         f"{jev.get('precision_at_0.75', 0):.4f}"])
        L.append(table(["模型", "n", "准确率", "macro-F1", "@0.75 覆盖率", "@0.75 精确率"], rows) + "\n")
        L.append(f"> 训练集 {base_rt['n_train']} 条真实行 / 测试集 {base_rt['n_test']} 条真实行，全部只用 9 个结构化特征。\n")
        L.append("**怎么读这组数**\n")
        L.append("- 准确率上 XGBoost 更高（%.3f vs %.3f），这在意料之中：真实数据只有 **33 个 "
                 "(app_category, field, label) 组合**，树模型等价于一张查表，9 个瘦特征能榨出的信息已经到顶。\n"
                 % (x["accuracy"], jev["accuracy"] if jev else float("nan")))
        L.append("- macro-F1 上 WorkOn-Jev 略高（%.4f vs %.4f），说明长尾类别（aidev/coding/writing 这些）"
                 "它抓得比树模型好，而树模型被 other 这类多数类主导。\n"
                 % (jev["macro_f1"] if jev else float("nan"), x["macro_f1"]))
        L.append("- **结论不是「谁取代谁」**：XGBoost 结构上吃不了窗口标题 / OCR / 界面布局，"
                 "也答不了场景三级；这两件事才是上 Jev 的理由（见 §3、§5 的富文本口径）。\n")

    if base:
        L.append("### 8.2 现网 `action_model_v3_real` 的对照（注意口径不公平）\n")
        rows = []
        for name, m in base.get("models", {}).items():
            def _f(v, nd=4):
                return f"{v:.{nd}f}" if isinstance(v, (int, float)) else "—"
            rows.append([name, m.get("n"), _f(m.get("accuracy")), _f(m.get("macro_f1")),
                         _f(m.get("ece"), 4) if m.get("ece") is not None else "—",
                         _f(m.get("mean_confidence")), _f(m.get("coverage_at_0.75"))])
        L.append(table(["模型", "n", "准确率", "macro-F1", "ECE", "平均置信度", "@0.75 覆盖率"], rows) + "\n")
        for k, v in base.get("notes", {}).items():
            L.append(f"- {k}：{v}")
        L.append("- **口径警告**：现网模型是在**全部** real_actions.jsonl 上训的，"
                 "而真实数据极度冗余 —— 它在我们划出的测试行上基本都见过，"
                 "所以那个 0.998 是记忆不是泛化。要看泛化请以上面的 §8.1 为准。\n")

    # ── 9. ONNX ──
    if onnx:
        L.append("## 9. ONNX 导出与量化\n")
        L.append(table(["构建", "体积"], [["fp32", f"{onnx.get('fp32_mb', '-')} MB"],
                                          ["int8 动态量化", f"{onnx.get('int8_mb', '-')} MB"]]) + "\n")
        chk = onnx.get("int8_checks") or onnx.get("checks") or []
        if chk:
            L.append(table(["用例", "torch top1", "onnx top1", "top5 是否一致", "max|Δlogit|"],
                           [[c["case"], c["top1_torch"], c["top1_onnx"],
                             "是" if c["top5_same"] else "否", f"{c['max_abs_diff']:.2e}"] for c in chk]) + "\n")

    # ── 10. 结论 ──
    L.append("## 9.5 决策阈值（对应 decision.ts 的 MODEL_PROB_THRESHOLD=0.75）\n")
    rows = []
    for r in ev.get("by_question", []):
        th = r.get("thresholds") or {}
        rows.append([Q_CN.get(r["group"], r["group"])] + [
            f"{th.get(t, {}).get('coverage', 0):.2f}" if th.get(t, {}).get("coverage") else "0"
            for t in ("0.5", "0.75", "0.9")] + [
            f"{th.get('0.75', {}).get('precision') or 0:.3f}"])
    L.append(table(["题目", "覆盖率@0.5", "覆盖率@0.75", "覆盖率@0.9", "精确率@0.75"], rows) + "\n")
    L.append("> 覆盖率 = 该题置信度 ≥ 阈值的样本占比（也就是「会被模型改写」的比例）；"
             "精确率 = 这批样本里的判对比例。决策层只关心 0.75 那一列。\n")

    L.append("## 10. 结论与上线建议\n")
    L.append(_conclusion(ev, temps, base))

    Path(args.out).write_text("\n".join(L), encoding="utf-8")
    print(f"[report] -> {args.out}")


def _conclusion(ev: dict, temps: dict, base: dict | None) -> str:
    out = []
    real = next((r for r in ev.get("by_source", []) if r["group"] == "real_actions"), None)
    ws = next((r for r in ev.get("by_question", []) if r["group"] == "work_state"), None)
    if real:
        out.append(f"- 真实测试集整体准确率 **{real['accuracy']:.3f}**、ECE **{real['ece']:.3f}**。")
    if ws:
        a = ws.get("automation", {})
        out.append(f"- `work_state`：准确率 {ws['accuracy']:.3f}，5% 错误预算下自动化率 "
                   f"{a.get('budget_5pct', {}).get('coverage', 0):.2f}。")
        th = (ws.get("thresholds") or {}).get("0.75")
        if th:
            cov = th.get("coverage")
            pre = th.get("precision")
            if cov:
                out.append(f"- **按 `decision.ts` 实际阈值 0.75 看**：{cov:.1%} 的样本置信度达标"
                           f"（会被模型从规则手里接管），这批里判对 {pre:.1%}"
                           f"（n={th.get('n')}）。规则路径本身的正确率需要 shadow 对照才能算出来。")
            else:
                out.append("- **按 `decision.ts` 实际阈值 0.75 看**：没有任何样本置信度达标 ⇒ "
                           "开 `model_first` 也不会改变现状（模型等于没接）。")
        out.append("- 上线前请先跑 `recognitionMode=shadow` 积累真实对照。")
    out.append("- 建议上线顺序：`shadow`（只记账不生效）→ 修 `MODEL_LABEL_TO_STATE` 后开 "
               "`model_first`（此时模型才第一次真正生效）→ 观察 `recognition_log` 里 "
               "`modelState != ruleState` 的样本是否正确。")
    out.append("- 场景题（scene_l1/l2/l3）目前只有合成监督，建议先只做展示/报表，不要驱动作业判定。")
    return "\n".join(out) + "\n"


def _coverage_at(qreport: dict, thr: float) -> float | None:
    rel = qreport.get("reliability")
    if not rel:
        return None
    return None


if __name__ == "__main__":
    main()
