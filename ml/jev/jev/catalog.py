"""选项表 / 层级题解析。

对外只暴露三件事：
  Catalog.options(question, parent_key) -> [{"key","text"}]   # 该题在当前父节点下的候选
  Catalog.gold_keys(row)               -> {question: key}     # 从原始数据取金标
  Catalog.letters(n)                   -> "ABCD..."
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_PATH = ROOT / "configs" / "questions.json"

# scene_l3 -> action_label 的兜底映射（仅当原始数据缺 action_label 时使用）
_L3_ACTION_HINT = [
    (re.compile(r"对话|聊天|聊天|群聊|私信|会议|视频会议|通话"), "communicate"),
    (re.compile(r"搜索"), "search"),
    (re.compile(r"浏览|阅读|观看|播放|视频|朋友圈|空间|资讯|新闻|电商|购物|淘宝|京东|拼多多"), "browse"),
    (re.compile(r"编辑|写作|文档|笔记|表格|演示|知识库|Markdown"), "write"),
    (re.compile(r"开发|调试|终端|命令行|数据库|接口|版本|容器|远程|SSH|抓包|代理"), "code"),
    (re.compile(r"截图|录屏|录制|剪辑|合成|建模|绘图|设计|修图|音频"), "design"),
    (re.compile(r"管理|同步|压缩|传输|资源管理器"), "manage_file"),
    (re.compile(r"设置|控制面板|注册表|设备管理|任务管理器|监控|磁盘|安全|密码"), "configure"),
]


class Catalog:
    def __init__(self, path: Path | str | None = None):
        self.path = Path(path or DEFAULT_PATH)
        cfg = json.loads(self.path.read_text(encoding="utf-8"))
        self.cfg = cfg
        self.letters = cfg["letters"]
        self.order: list[str] = cfg["order"]
        self.questions: dict = cfg["questions"]
        self.stats: dict = cfg.get("stats", {})

    # ── 选项 ──
    def options(self, question: str, parent_key: str | None = None) -> list[dict]:
        spec = self.questions[question]
        if spec["type"] == "flat":
            return list(spec["options"])
        if parent_key is None:
            raise ValueError(f"{question} 是层级题，必须给出 parent_key")
        return list(spec["options_by_parent"].get(parent_key, []))

    def letter_of(self, options: list[dict], key: str) -> str | None:
        for i, o in enumerate(options):
            if o["key"] == key:
                return self.letters[i]
        return None

    def key_of(self, options: list[dict], letter: str) -> str | None:
        i = self.letters.find(letter)
        if i < 0 or i >= len(options):
            return None
        return options[i]["key"]

    def text_of(self, options: list[dict], letter: str) -> str | None:
        i = self.letters.find(letter)
        if i < 0 or i >= len(options):
            return None
        return options[i]["text"]

    # ── 金标 ──
    def gold_keys(self, row: dict) -> dict[str, str]:
        """从一条原始样本抽出各题金标 key（层级 key 用路径 id）。"""
        out: dict[str, str] = {}
        l1, l2, l3 = row.get("scene_l1"), row.get("scene_l2"), row.get("scene_l3")
        if l1:
            out["scene_l1"] = l1
        if l1 and l2:
            out["scene_l2"] = f"{l1}//{l2}"
        if l1 and l2 and l3:
            out["scene_l3"] = f"{l1}//{l2}//{l3}"
        act = row.get("action_label") or row.get("action")
        if not act and l3:
            act = self.infer_action(l3)
        if act:
            out["action"] = act
        ws = row.get("work_state") or row.get("label") or row.get("state")
        if ws:
            out["work_state"] = ws
        return out

    @staticmethod
    def infer_action(l3: str) -> str:
        for pat, act in _L3_ACTION_HINT:
            if pat.search(l3):
                return act
        return "other"

    def parent_of(self, question: str) -> str | None:
        return self.questions[question].get("parent")

    def instructions(self, question: str) -> str:
        return self.questions[question]["instructions"]

    def known_keys(self, question: str) -> set[str]:
        spec = self.questions[question]
        if spec["type"] == "flat":
            return {o["key"] for o in spec["options"]}
        keys: set[str] = set()
        for opts in spec["options_by_parent"].values():
            keys |= {o["key"] for o in opts}
        return keys


_CACHE: dict[str, Catalog] = {}


def load_catalog(path: Path | str | None = None) -> Catalog:
    key = str(path or DEFAULT_PATH)
    if key not in _CACHE:
        _CACHE[key] = Catalog(path)
    return _CACHE[key]
