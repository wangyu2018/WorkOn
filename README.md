# WorkOn

本地优先的桌面工作记录 + 3D 虚拟桌宠（Three.js + VRM）

## 功能

- **时间追踪** — 自动检测前台窗口，记录工作状态（专注/编码/会议/摸鱼等）
- **3D 桌宠「姵儿」** — VRM 角色，支持拖拽/点击/右键对话
- **AI 对话** — 流式 SSE，多模型路由（fast/standard/complex 三档）
- **OCR 屏幕识别** — 深度模式截屏分析，双引擎（RapidOCR + Tesseract.js）
- **报表 & 计划** — 日/周工作分析、目标计划追踪
- **天气 & 昼夜** — 雨/雪/花瓣/落叶粒子 + 4 时段自动光照过渡

## 启动

```bash
npm install
npm run dev
```

## 技术栈

| 层 | 技术 |
|---|------|
| 框架 | Electron + electron-vite |
| 渲染 | React + TypeScript + Tailwind CSS |
| 3D | Three.js + @pixiv/three-vrm |
| AI | OpenAI 兼容 API + 多模型路由 |
| OCR | RapidOCR-json / Tesseract.js |
| 存储 | JSONL 本地文件 |
