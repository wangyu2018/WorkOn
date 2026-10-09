"""SystemOne 协议层：请求/响应模型 + 到引擎提问计划的转换。

对外协议对齐 jev-style / jev-smol 的 /v1/systemone：
  {"state": "...", "questions": {...}} -> {"answers": {...}, "usage": {...}, "latency_ms": ...}
三种题型：noul(是/否) / choice(2..26 选项) / score(2..10 有序档位)。
差别只在打分方式：我们用**单字母 logits + 逐题温度**，而不是逐选项 teacher forcing。

扩展（WorkOn 专用，不破坏原协议）：
  * `state` 可以直接给 WorkOn 的上下文 dict（进程/标题/OCR/布局/行为…），
    服务端用同一套 render_state 渲染，训练与线上分布一致；
  * `questions` 可以给内置题名列表 ["scene_l1","scene_l2","scene_l3","action","work_state"]，
    此时按 WorkOn 的层级选项表逐题提问。
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

NOUL_TEXT = {"true": "是", "false": "否"}


class Question(BaseModel):
    type: Literal["choice", "noul", "score"] = "choice"
    instructions: str = ""
    criteria: dict[str, str] | list[str] | None = None


class SystemOneRequest(BaseModel):
    state: str | dict[str, Any]
    questions: dict[str, Question] | list[str]
    model: str | None = None
    temperature: float | None = None
    include_title: str = "hint"


class Answer(BaseModel):
    type: str
    choice: str | None = None
    noul: float | None = None
    score: float | None = None
    legend: dict[str, str] | None = None
    confidence: float | None = None
    probabilities: dict[str, float] | None = None


class SystemOneResponse(BaseModel):
    model: str
    answers: dict[str, Answer]
    usage: dict[str, int] = Field(default_factory=dict)
    latency_ms: float = 0.0
    backend: str = ""


def question_to_spec(name: str, q: Question) -> dict:
    """把 SystemOne 的 question 定义转成引擎的选项表。"""
    if q.type == "choice":
        if not isinstance(q.criteria, dict) or len(q.criteria) < 2:
            raise ValueError(f"问题 {name}: choice 需要 criteria 字典且至少 2 个选项")
        if len(q.criteria) > 26:
            raise ValueError(f"问题 {name}: {len(q.criteria)} 个选项超出单字母上限 26")
        options = [{"key": k, "text": (f"{k}（{v}）" if v else str(k))} for k, v in q.criteria.items()]
    elif q.type == "noul":
        crit = q.criteria if isinstance(q.criteria, dict) else {}
        options = [
            {"key": "true", "text": crit.get("true") or NOUL_TEXT["true"]},
            {"key": "false", "text": crit.get("false") or NOUL_TEXT["false"]},
        ]
    elif q.type == "score":
        if not isinstance(q.criteria, list) or not (2 <= len(q.criteria) <= 26):
            raise ValueError(f"问题 {name}: score 需要 2..26 个有序档位")
        options = [{"key": str(i), "text": str(v)} for i, v in enumerate(q.criteria)]
    else:
        raise ValueError(f"问题 {name}: 未知题型 {q.type}")
    return {"name": name, "type": q.type, "instructions": q.instructions, "options": options}


def spec_to_answer(spec: dict, res: dict, temperature_applied: bool = True) -> Answer:
    """引擎结果 -> SystemOne 答案。"""
    probs = {o["key"]: round(o["prob"], 4) for o in res["options"]}
    t = spec["type"]
    if t == "noul":
        return Answer(type="noul", noul=round(probs.get("true", 0.0), 4),
                      confidence=round(res["confidence"], 4), probabilities=probs)
    if t == "score":
        n = len(spec["options"])
        exp = sum(i * res["options"][i]["prob"] for i in range(n))
        return Answer(type="score", score=round(exp, 4),
                      legend={str(i): o["text"] for i, o in enumerate(spec["options"])},
                      confidence=round(res["confidence"], 4), probabilities=probs)
    return Answer(type="choice", choice=res["key"], confidence=round(res["confidence"], 4),
                  probabilities=probs)
