"""引擎公共编排：ask / decide 只依赖 score_turn，与后端（torch / onnxruntime）解耦。"""
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

from jev.catalog import load_catalog  # noqa: E402
from jev.prompt import SYSTEM_PROMPT, render_question_block, render_state_turn  # noqa: E402
from jev.state import render_state  # noqa: E402

DEFAULT_TEMPERATURES = {"scene_l1": 1.0, "scene_l2": 1.0, "scene_l3": 1.0,
                        "action": 1.0, "work_state": 1.0}
DEFAULT_QUESTIONS = ["scene_l1", "scene_l2", "scene_l3", "action", "work_state"]
_Q_CN = {"scene_l1": "一级场景", "scene_l2": "二级场景", "scene_l3": "具体场景"}


class BaseEngine:
    def __init__(self, catalog=None, temperatures: dict | None = None):
        self.catalog = catalog or load_catalog()
        self.temperatures = {**DEFAULT_TEMPERATURES, **(temperatures or {})}
        self.letters = self.catalog.letters

    # 子类实现
    def score_turn(self, messages: list[dict], n_options: int, temperature: float = 1.0) -> list[float]:
        raise NotImplementedError

    # ────────────────────── 通用 SystemOne 提问 ──────────────────────

    def ask(self, state_text: str, specs: list[dict]) -> dict[str, dict]:
        """任意 state 文本 + 任意问题（每题 ≤26 选项）。"""
        messages: list[dict] = [{"role": "system", "content": SYSTEM_PROMPT}]
        answers: dict[str, dict] = {}
        first = True
        for spec in specs:
            block = render_question_block(spec["name"], spec.get("instructions") or "", spec["options"])
            content = f"STATE\n{state_text}\n\n{block}" if first else block
            first = False
            messages.append({"role": "user", "content": content})
            probs = self.score_turn(messages, len(spec["options"]),
                                    self.temperatures.get(spec["name"], 1.0))
            best = max(range(len(probs)), key=lambda i: probs[i])
            messages.append({"role": "assistant", "content": self.letters[best]})
            answers[spec["name"]] = {
                "letter": self.letters[best],
                "key": spec["options"][best]["key"],
                "text": spec["options"][best]["text"],
                "confidence": probs[best],
                "options": [{"key": o["key"], "text": o["text"], "prob": p}
                            for o, p in zip(spec["options"], probs)],
            }
        return answers

    # ────────────────────── WorkOn 内置题（含层级） ──────────────────────

    def _parent_note(self, parent_q: str, parent_key: str) -> str:
        spec = self.catalog.questions[parent_q]
        ptext = parent_key
        if spec["type"] != "flat":
            for opts in spec["options_by_parent"].values():
                for o in opts:
                    if o["key"] == parent_key:
                        ptext = o["text"]
                        break
        return f"已知：{_Q_CN.get(parent_q, parent_q)} = {ptext}"

    def decide(self, state_row: dict, questions: list[str] | None = None, *,
               include_title: str = "hint") -> dict:
        questions = list(questions or DEFAULT_QUESTIONS)
        state_text = render_state(state_row, include_title=include_title)
        messages: list[dict] = [{"role": "system", "content": SYSTEM_PROMPT}]
        answers: dict[str, dict] = {}
        chosen: dict[str, str] = {}
        first = True
        for q in questions:
            parent_note = None
            if (p := self.catalog.parent_of(q)):
                pkey = chosen.get(p)
                if pkey is None:
                    continue
                parent_note = self._parent_note(p, pkey)
            options = self.catalog.options(q, chosen.get(p) if p else None)
            if not options:
                continue
            if first:
                content = render_state_turn(state_text, q, self.catalog.instructions(q), options, parent_note)
                first = False
            else:
                content = render_question_block(q, self.catalog.instructions(q), options, parent_note)
            messages.append({"role": "user", "content": content})
            probs = self.score_turn(messages, len(options), self.temperatures.get(q, 1.0))
            best = max(range(len(probs)), key=lambda i: probs[i])
            messages.append({"role": "assistant", "content": self.letters[best]})
            chosen[q] = options[best]["key"]
            answers[q] = {
                "question": q,
                "letter": self.letters[best],
                "key": options[best]["key"],
                "text": options[best]["text"],
                "confidence": probs[best],
                "options": [{"key": o["key"], "text": o["text"], "prob": p}
                            for o, p in zip(options, probs)],
            }
        return {"state": state_text, "answers": answers}
