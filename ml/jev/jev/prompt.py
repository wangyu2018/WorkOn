"""对话渲染 —— STATE + 逐题提问 + 单字母作答。

为什么用"多轮、单字母"而不是"一次输出整段 JSON"
-------------------------------------------------
1. 层级题（scene_l2/scene_l3）的候选依赖上一题的答案，天然需要顺序提问；
2. 单字母作答 => 每题只需读**一个位置**的 logits 就能拿到整题分布，
   一次前向拿到校准概率，不需要对每个选项各跑一遍（jev-smol 的做法较慢）；
3. 服务端再把字母还原成 SystemOne 的 choice/noul/score 响应，协议不变。

对话结构（enable_thinking=False，否则 Qwen3 会插  thinking 块破坏前缀对齐）：

    [system]  角色 + "只回一个字母"
    [user]    STATE ... + 问题1 + 选项
    [assistant] B
    [user]    问题2（附上一题结论）+ 选项
    [assistant] A
    ...
"""
from __future__ import annotations

SYSTEM_PROMPT = (
    "你是 WorkOn 的端侧决策模型，只做判断，不聊天。\n"
    "你会先读到一段桌面上下文 STATE，然后被逐个提问。\n"
    "每个问题都给出候选选项，选项以单个大写字母开头。\n"
    "你每次只输出一个字母，大写、不加引号、不加标点、不解释、不重复选项内容。"
)

ANSWER_SUFFIX = "只回一个字母。"


def render_question_block(question: str, instructions: str, options: list[dict],
                          parent_note: str | None = None) -> str:
    """单个提问块（user 轮内容，不含 STATE）。"""
    lines = [f"问题 {question}：{instructions}"]
    if parent_note:
        lines.append(parent_note)
    for i, opt in enumerate(options):
        lines.append(f"{chr(65 + i)}. {opt['text']}")
    lines.append(ANSWER_SUFFIX)
    return "\n".join(lines)


def render_state_turn(state_text: str, question: str, instructions: str,
                      options: list[dict], parent_note: str | None = None) -> str:
    """首轮：STATE + 第一个问题。"""
    return f"STATE\n{state_text}\n\n" + render_question_block(question, instructions, options, parent_note)


def build_messages(state_text: str, plan: list[dict]) -> list[dict]:
    """plan: [{"question","instructions","options","parent_note","answer"}]，按顺序提问。"""
    if not plan:
        raise ValueError("plan 不能为空")
    first = plan[0]
    msgs: list[dict] = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": render_state_turn(
            state_text, first["question"], first["instructions"], first["options"], first.get("parent_note"))},
        {"role": "assistant", "content": first["answer"]},
    ]
    for step in plan[1:]:
        msgs.append({"role": "user", "content": render_question_block(
            step["question"], step["instructions"], step["options"], step.get("parent_note"))})
        msgs.append({"role": "assistant", "content": step["answer"]})
    return msgs


_THINK = "<think>\n\n</think>\n\n"
_ASSIST_HEADER = "<|im_start|>assistant\n"


def _normalize(text: str) -> str:
    """让每个 assistant 头后面都带空的 think 块。

    Qwen3 的 chat template 只给**最后一轮** assistant 加 ` thinking\n\n<｜end▁of▁thinking｜>\n\n`，
    非末轮不加；而 add_generation_prompt=True 又一定会加。
    结果就是"生成点前缀"不是"完整多轮渲染"的前缀，答案位置错位。
    这里统一补齐，使训练与推理的前缀严格一致（Qwen3 非思考模式的约定格式）。
    """
    parts = text.split(_ASSIST_HEADER)
    if len(parts) == 1:
        return text
    out = [parts[0]]
    for p in parts[1:]:
        body = p[len(_THINK):] if p.startswith(_THINK) else p
        out.append(_THINK + body)
    return _ASSIST_HEADER.join(out)


def _tmpl(tok, messages: list[dict], *, add_generation_prompt: bool) -> str:
    raw = tok.apply_chat_template(
        messages, tokenize=False, add_generation_prompt=add_generation_prompt,
        enable_thinking=False,
    )
    return _normalize(raw)


def answer_spans(tok, messages: list[dict]) -> tuple[str, list[tuple[int, int]]]:
    """返回 (完整文本, 每个 assistant 答案的字符区间)。

    依赖：add_generation_prompt=True 渲染出的文本是完整文本的**字符串前缀**
    （enable_thinking=False 时成立）。
    """
    full = _tmpl(tok, messages, add_generation_prompt=False)
    spans: list[tuple[int, int]] = []
    for i, m in enumerate(messages):
        if m["role"] != "assistant":
            continue
        prefix = _tmpl(tok, messages[:i], add_generation_prompt=True)
        if not full.startswith(prefix):
            raise RuntimeError("chat template 前缀对齐失败（enable_thinking 是否被改动？）")
        spans.append((len(prefix), len(prefix) + len(m["content"])))
    return full, spans


def generation_prefix(tok, messages: list[dict]) -> str:
    """最后一个 assistant 答案的生成点前缀。"""
    return _tmpl(tok, messages, add_generation_prompt=True)


def tokenize_supervised(tok, messages: list[dict], turn_weights: list[float] | None = None,
                        max_len: int = 1024):
    """训练用：input_ids + labels（非答案位置 -100）+ 逐 token 权重。

    turn_weights 与 assistant 轮一一对应（见 data/build.py 的权重口径）。
    """
    full, spans = answer_spans(tok, messages)
    if turn_weights is not None and len(turn_weights) != len(spans):
        raise ValueError(f"turn_weights 长度 {len(turn_weights)} != assistant 轮数 {len(spans)}")
    enc = tok(full, return_offsets_mapping=True, add_special_tokens=False)
    ids: list[int] = list(enc["input_ids"])
    offs = list(enc["offset_mapping"])
    labels = [-100] * len(ids)
    weights = [0.0] * len(ids)
    for turn, (a, b) in enumerate(spans):
        w = 1.0 if turn_weights is None else float(turn_weights[turn])
        for i, (s, e) in enumerate(offs):
            if s >= a and e <= b and e > s:
                labels[i] = ids[i]
                weights[i] = w
    return ids[:max_len], labels[:max_len], weights[:max_len]
