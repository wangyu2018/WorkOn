/**
 * 交付物排版 token：单一主题函数，HTML/PDF/PNG 共用
 * 字号阶梯 14/16/20/28/40，间距 8pt 网格，A4 打印边距，中文字体栈。
 */
import type { DeliverableTemplate } from '@shared/deliverable/spec'

const FONT_STACK = `"PingFang SC","Noto Sans SC","Hiragino Sans GB","Microsoft YaHei",system-ui,-apple-system,sans-serif`

const DARK = {
  bg: '#0B1220',
  card: '#111A2C',
  fg: '#E2E8F0',
  muted: '#94A3B8',
  line: 'rgba(148,163,184,0.18)',
  accent: '#22D3EE',
  accent2: '#6366F1'
}

const LIGHT = {
  bg: '#FFFFFF',
  card: '#F8FAFC',
  fg: '#0F172A',
  muted: '#64748B',
  line: 'rgba(15,23,42,0.12)',
  accent: '#0891B2',
  accent2: '#4F46E5'
}

export function themeCss(template: DeliverableTemplate, theme: 'dark' | 'light' = 'dark'): string {
  const c = theme === 'light' ? LIGHT : DARK
  const isDeck = template === 'deck'
  return `
:root{--bg:${c.bg};--card:${c.card};--fg:${c.fg};--muted:${c.muted};--line:${c.line};--accent:${c.accent};--accent2:${c.accent2};}
*{box-sizing:border-box;}
html,body{margin:0;padding:0;background:var(--bg);color:var(--fg);font-family:${FONT_STACK};
  -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;}
body{font-size:14px;line-height:1.7;}
.page{max-width:${isDeck ? '1280px' : '820px'};margin:0 auto;padding:${isDeck ? '0' : template === 'brief' ? '48px 44px' : '64px 56px'};}
.slide{width:1280px;height:720px;padding:72px 88px;display:flex;flex-direction:column;justify-content:center;
  background:var(--bg);page-break-after:always;break-after:page;position:relative;overflow:hidden;}
.slide:last-child{page-break-after:auto;break-after:auto;}
.cover{min-height:${isDeck ? '100%' : '360px'};display:flex;flex-direction:column;justify-content:center;gap:12px;}
.cover h1{font-size:40px;line-height:1.2;margin:0;letter-spacing:-0.02em;}
.cover .sub{font-size:16px;color:var(--muted);}
.cover .meta{font-size:12px;color:var(--muted);letter-spacing:0.08em;text-transform:uppercase;}
h1{font-size:40px;} h2{font-size:28px;line-height:1.3;margin:32px 0 12px;} h3{font-size:20px;margin:24px 0 8px;}
p{margin:0 0 12px;}
.block{margin:0 0 16px;break-inside:avoid;}
.muted{color:var(--muted);}
.metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;}
.metric{border:1px solid var(--line);border-radius:12px;padding:14px 16px;background:var(--card);}
.metric .label{font-size:12px;color:var(--muted);}
.metric .value{font-size:28px;font-weight:600;line-height:1.25;margin-top:4px;font-variant-numeric:tabular-nums;}
.metric .unit{font-size:12px;color:var(--muted);margin-left:4px;font-weight:400;}
.metric .delta{font-size:12px;color:var(--accent);margin-top:2px;}
table{width:100%;border-collapse:collapse;font-size:13px;}
th{text-align:left;font-weight:500;color:var(--muted);border-bottom:1px solid var(--line);padding:8px 10px;}
td{border-bottom:1px solid var(--line);padding:8px 10px;font-variant-numeric:tabular-nums;}
th.right,td.right{text-align:right;}
.chart{margin:14px 0;padding:12px;border:1px solid var(--line);border-radius:12px;background:var(--card);}
.chart .cap{font-size:12px;color:var(--muted);margin-bottom:6px;}
.timeline{display:flex;flex-direction:column;gap:10px;}
.timeline .row{display:flex;gap:12px;align-items:flex-start;}
.timeline .time{width:52px;flex:none;font-size:12px;color:var(--muted);font-variant-numeric:tabular-nums;padding-top:2px;}
.timeline .dot{width:8px;height:8px;border-radius:50%;background:var(--accent);margin-top:6px;flex:none;}
.timeline .t{font-size:14px;}
.timeline .d{font-size:12px;color:var(--muted);}
.callout{border-left:3px solid var(--accent);padding:10px 14px;background:var(--card);border-radius:0 10px 10px 0;}
.callout.warn{border-color:#F59E0B;} .callout.success{border-color:#34D399;}
.callout .t{font-size:13px;font-weight:600;margin-bottom:2px;}
.callout .x{font-size:13px;color:var(--muted);}
figure{margin:14px 0;} figure img{max-width:100%;border-radius:10px;} figcaption{font-size:12px;color:var(--muted);margin-top:6px;}
footer{margin-top:36px;padding-top:14px;border-top:1px solid var(--line);font-size:11px;color:var(--muted);
  display:flex;justify-content:space-between;gap:12px;}
.deck .header{position:absolute;left:88px;right:88px;top:36px;display:flex;justify-content:space-between;
  font-size:11px;color:var(--muted);letter-spacing:0.08em;text-transform:uppercase;}
.deck .footer-bar{position:absolute;left:88px;right:88px;bottom:28px;font-size:11px;color:var(--muted);display:flex;
  justify-content:space-between;}
@page{size:A4;margin:16mm 14mm;}
@media print{
  body{background:#fff;}
  .page{padding:0;max-width:none;}
  .slide{break-after:page;}
  .block{break-inside:avoid;}
  .metric,.chart,table,figure{break-inside:avoid;}
}
@media screen{
  body{padding:${isDeck ? '24px 0' : '0'};}
  .page{box-shadow:0 0 0 1px var(--line);}
  .slide{margin:0 auto 24px;box-shadow:0 0 0 1px var(--line);}
}
`
}

export function documentShell(opts: {
  title: string
  template: DeliverableTemplate
  theme: 'dark' | 'light'
  body: string
}): string {
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${opts.title.replace(/[<>&"]/g, '')}</title>
<style>${themeCss(opts.template, opts.theme)}</style>
</head><body><div class="page ${opts.template === 'deck' ? 'deck' : ''}">${opts.body}</div></body></html>`
}
