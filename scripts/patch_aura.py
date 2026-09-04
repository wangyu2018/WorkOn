# -*- coding: utf-8 -*-
"""Aura 设计 Token 层落地：色板/渐变/阴影/弹性曲线/圆角/微动效"""
import io

p = 'src/renderer/src/index.css'
t = io.open(p, encoding='utf-8', newline='').read()
BS = chr(92)

def rep(old, new, count=1, tag=''):
    global t
    eol = '\r\n' if '\r\n' in t else '\n'
    o = old.replace('\n', eol)
    n = new.replace('\n', eol)
    c = t.count(o)
    assert c == count, f'{tag}: x{c}: {old[:70]}'
    t = t.replace(o, n)
    print(f'OK {tag}')

# ═══ 1) :root 变量 → Aura 色板 ═══
rep(t and p or p,
    """  --bg-deep: #0b101b;
  --bg-surface: #121826;
  --bg-elevated: #1a2233;
  --border-subtle: rgba(255, 255, 255, 0.07);""",
    """  --bg-deep: #0b0e16;
  --bg-surface: #141927;
  --bg-elevated: #1e2539;
  --border-subtle: #232b42;
  /* Aura 设计 Token */
  --surface-2: #181e30;
  --surface-3: #1e2539;
  --line: #232b42;
  --line-strong: #323d5c;
  --text-1: #e9edf9;
  --text-2: #97a1bd;
  --text-3: #5d6884;
  --aura: linear-gradient(135deg, #6366f1, #8b5cf6 55%, #06b6d4);
  --aura-soft: linear-gradient(135deg, rgba(99,102,241,.1), rgba(139,92,246,.06) 55%, rgba(6,182,212,.08));
  --glow-i: 0 6px 24px rgba(99, 102, 241, 0.35);
  --glow-v: 0 6px 24px rgba(139, 92, 246, 0.35);
  --glow-c: 0 6px 24px rgba(6, 182, 212, 0.35);
  --shadow-sm: 0 1px 3px rgba(0,0,0,.12), 0 4px 14px rgba(0,0,0,.06);
  --shadow-md: 0 4px 12px rgba(0,0,0,.18), 0 12px 36px rgba(0,0,0,.12);
  --shadow-lg: 0 12px 28px rgba(0,0,0,.22), 0 28px 72px rgba(0,0,0,.18);
  --ease-spring: cubic-bezier(.34, 1.56, .64, 1);
  --r-sm: 10px;
  --r-md: 14px;
  --r-lg: 18px;
  --r-xl: 22px;""", tag='root-vars')

# ═══ 2) body 背景 → indigo/violet/cyan 辉光 ═══
rep(p,
    """  background:
    radial-gradient(1100px 480px at 78% -12%, rgba(56, 120, 200, 0.1), transparent 62%),
    radial-gradient(880px 420px at 8% 112%, rgba(52, 211, 153, 0.05), transparent 60%),
    linear-gradient(165deg, #0d1322 0%, #0b101b 52%, #090d16 100%);""",
    """  background:
    radial-gradient(1100px 480px at 78% -12%, rgba(99, 102, 241, 0.09), transparent 62%),
    radial-gradient(880px 420px at 8% 112%, rgba(139, 92, 246, 0.05), transparent 60%),
    linear-gradient(165deg, #0d1120 0%, #0b0e16 52%, #090c14 100%);""", tag='body-bg')

# ═══ 3) glass-card → 实色 surface + 双层阴影 ═══
rep(p,
    """  .glass-card {
    @apply rounded-2xl border p-4;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.035), rgba(255, 255, 255, 0) 22%),
      rgba(18, 24, 38, 0.66);
    border-color: var(--border-subtle);
    backdrop-filter: blur(14px) saturate(1.15);
    -webkit-backdrop-filter: blur(14px) saturate(1.15);
    box-shadow:
      0 10px 30px rgba(0, 0, 0, 0.32),
      0 1px 4px rgba(0, 0, 0, 0.2),
      inset 0 1px 0 rgba(255, 255, 255, 0.045);
    transition:
      border-color var(--t-hover),
      transform var(--t-hover),
      box-shadow var(--t-hover);
    transform-style: preserve-3d;
  }
  .glass-card.hoverable:hover {
    border-color: rgba(255, 255, 255, 0.14);
    transform: translateY(-2px);
    box-shadow:
      0 16px 40px rgba(0, 0, 0, 0.4),
      0 1px 6px rgba(0, 0, 0, 0.24),
      inset 0 1px 0 rgba(255, 255, 255, 0.06);
  }""",
    """  .glass-card {
    @apply border p-4;
    border-radius: var(--r-lg);
    background: var(--bg-surface);
    border-color: var(--line);
    box-shadow: var(--shadow-sm);
    transition:
      border-color var(--t-hover),
      transform var(--t-hover),
      box-shadow var(--t-hover);
    transform-style: preserve-3d;
  }
  .glass-card.hoverable:hover {
    border-color: var(--line-strong);
    transform: translateY(-2px);
    box-shadow: var(--shadow-md);
  }""", tag='glass-card')

# ═══ 4) glass-btn.primary → Aura 渐变 ═══
rep(p,
    """  .glass-btn.primary {
    background: linear-gradient(180deg, var(--accent-soft), var(--accent-softer));
    border-color: var(--border-active);
    color: var(--accent);
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.18);
  }
  .glass-btn.primary:hover {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--accent);
  }""",
    """  .glass-btn.primary {
    background: linear-gradient(135deg, #6366f1, #8b5cf6 55%, #06b6d4);
    border: none;
    color: #ffffff;
    font-weight: 500;
    box-shadow: 0 4px 14px rgba(99, 102, 241, 0.35);
  }
  .glass-btn.primary:hover {
    filter: brightness(1.12);
    box-shadow: 0 6px 20px rgba(99, 102, 241, 0.45);
  }""", tag='btn-primary')

# ═══ 5) 弹性曲线 token + 微动效 ═══
rep(p,
    """  /* 3 级动效：hover 150ms / 面板 250ms / 页面 400ms */
  --t-hover: 150ms ease-out;
  --t-panel: 250ms ease-out;
  --t-page: 400ms ease-out;""",
    """  /* 3 级动效：hover 150ms / 面板 250ms / 页面 400ms */
  --t-hover: 150ms cubic-bezier(.34, 1.56, .64, 1);
  --t-panel: 250ms cubic-bezier(.23, 1, .32, 1);
  --t-page: 400ms cubic-bezier(.23, 1, .32, 1);""", tag='ease')

# ═══ 6) 尾部追加微动效工具类 ═══
micro = """
/* ── Aura 微动效工具类（尊重 reduced-motion 与 anim=off） ── */
@keyframes pulse-glow {
  0%, 100% { box-shadow: 0 0 8px rgba(139, 92, 246, 0.2); }
  50% { box-shadow: 0 0 20px rgba(139, 92, 246, 0.45); }
}
@keyframes sweep {
  from { background-position: -200% 0; }
  to { background-position: 200% 0; }
}
@keyframes shimmer {
  from { background-position: 200% 0; }
  to { background-position: -200% 0; }
}
.pulse-glow { animation: pulse-glow 2.5s ease-in-out infinite; }
.text-shimmer {
  background: linear-gradient(90deg, var(--text-2) 25%, var(--text-1) 50%, var(--text-2) 75%);
  background-size: 200% 100%;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  animation: shimmer 3s linear infinite;
}

@media (prefers-reduced-motion: reduce) {
  .pulse-glow, .text-shimmer { animation: none !important; }
}
[data-anim='off'] .pulse-glow, [data-anim='off'] .text-shimmer { animation: none !important; }
"""
# 插入到 @keyframes welcome-pop 块之后
marker = "\n\n.view-enter {"
idx = t.find(marker)
assert idx > 0, 'view-enter anchor not found'
t = t[:idx] + micro + t[idx:]

save(p, t)
print('\nAura Token 层落地完成')
