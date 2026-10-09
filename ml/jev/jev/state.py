"""STATE 文本渲染 —— WorkOn 桌面上下文 → 一段本地决策模型可读的状态描述。

隐私口径
--------
* 默认 `include_title="hint"`：窗口标题只保留"应用段 + 首段（掩码后、截断）"，
  邮箱/URL/路径/长数字串一律替换为占位符。模型完全本地运行，标题不出设备。
* `include_title="app"`：只保留标题末段（通常是应用名），最保守。
* `include_title="none"`：完全不传标题。
* `include_title="raw"`：原样（仅训练/评测对照用，不建议日常运行）。

同一套渲染函数在**训练数据构建**与**在线推理**两侧共用，保证分布一致。
"""
from __future__ import annotations

import re

WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"]
UNKNOWN = "未知"

_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+")
_URL = re.compile(r"(?:https?://|www\.)\S+", re.I)
_WINPATH = re.compile(r"[A-Za-z]:\\[^\s|]*")
_NIXPATH = re.compile(r"(?:^|\s)(?:/[\w.\-]+){2,}/?")
_LONGNUM = re.compile(r"\d{5,}")
_WS = re.compile(r"\s+")
# 控制符/角色标记清洗：窗口标题、OCR 文本一律来自外部，不能让它们伪造对话结构
_CTRL = re.compile(r"<\|[^|>]{0,32}\|>|<think>|</think>|<\|im_start\|>|<\|im_end\|>")
_TITLE_SEPS = [" - ", " — ", " – ", " | ", " · ", " —— "]


def mask_text(text: str, max_len: int = 24) -> str:
    """去掉可识别个人信息的片段，并截断。"""
    s = str(text or "")
    s = _EMAIL.sub("<mail>", s)
    s = _URL.sub("<url>", s)
    s = _WINPATH.sub("<path>", s)
    s = _NIXPATH.sub(" <path>", s)
    s = _LONGNUM.sub("#", s)
    s = _CTRL.sub(" ", s)
    s = _WS.sub(" ", s).strip()
    return s[:max_len]


def title_parts(title: str) -> tuple[str, str]:
    """把标题切成 (首段=内容/页面, 末段=应用)。无分隔符时末段为空。"""
    t = str(title or "").strip()
    if not t:
        return "", ""
    for sep in _TITLE_SEPS:
        if sep in t:
            head, tail = t.rsplit(sep, 1)
            return head.strip(), tail.strip()
    return t, ""


def title_hint(title: str, mode: str = "hint") -> str:
    if not title or mode == "none":
        return ""
    if mode == "raw":
        return mask_text(title, 40)
    head, tail = title_parts(title)
    if mode == "app":
        return mask_text(tail or head, 20)
    # hint：应用段 + 内容首段
    parts = [mask_text(p, 16) for p in (tail, head) if p]
    return " / ".join(parts) or mask_text(title, 20)


def _fmt_bool(v) -> str:
    if v is None:
        return UNKNOWN
    return "有" if v else "无"


def _fmt_dur(ms) -> str:
    try:
        ms = float(ms)
    except (TypeError, ValueError):
        return UNKNOWN
    if ms < 1000:
        return f"{ms:.0f}ms"
    return f"{ms / 1000:.1f}s"


def _fmt_time(hour, dow) -> str:
    try:
        h = int(hour) % 24
    except (TypeError, ValueError):
        return UNKNOWN
    day = WEEKDAYS[int(dow) % 7] if dow is not None else ""
    return f"{day} {h:02d}:00".strip()


def _ocr_text(row: dict) -> str | None:
    kw = row.get("ocr_keywords")
    if isinstance(kw, list) and kw:
        return "、".join(str(k) for k in kw[:8])
    cat, cnt = row.get("ocr_keyword_category"), row.get("ocr_word_count")
    if cat or cnt is not None:
        seg = str(cat or UNKNOWN)
        if cnt is not None:
            seg += f"，{cnt} 个词"
        score = row.get("ocr_avg_score")
        if score is not None:
            try:
                seg += f"，均分 {float(score):.2f}"
            except (TypeError, ValueError):
                pass
        return seg
    return None


def render_state(row: dict, *, include_title: str = "hint") -> str:
    """把一条样本/一次采样渲染成 STATE 段（字段缺失写"未知"，列顺序固定）。"""
    lines: list[str] = []

    proc = row.get("process_name") or row.get("app") or row.get("app_name")
    lines.append(f"进程: {proc or UNKNOWN}")

    cat = row.get("app_category")
    lines.append(f"应用类别: {cat or UNKNOWN}")

    if include_title != "none":
        th = title_hint(row.get("window_title") or "", include_title)
        lines.append(f"窗口标题: {th or UNKNOWN}")

    ocr = _ocr_text(row)
    lines.append(f"OCR: {ocr or UNKNOWN}")

    layout = row.get("ui_layout")
    lines.append(f"界面布局: {mask_text(layout, 90) if layout else UNKNOWN}")

    btype = row.get("action_type")
    field = row.get("field")
    tlen = row.get("text_length")
    dur = row.get("duration_ms")
    gap = row.get("time_since_prev_ms")
    sc = row.get("has_shortcut")
    bits = [
        f"动作={btype or UNKNOWN}",
        f"焦点域={field or UNKNOWN}",
        f"文本长度={tlen if tlen is not None else UNKNOWN}",
        f"停留={_fmt_dur(dur)}",
    ]
    if gap is not None:
        bits.append(f"距上次={_fmt_dur(gap)}")
    bits.append(f"快捷键={_fmt_bool(sc)}")
    lines.append("行为: " + " ".join(bits))

    lines.append(f"时间: {_fmt_time(row.get('hour'), row.get('day_of_week'))}")
    return "\n".join(lines)
