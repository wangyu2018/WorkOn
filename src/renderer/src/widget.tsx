import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import ReactDOM from 'react-dom/client'
import SuggestionWidget from './widget/SuggestionWidget'
import { useSettingsStore } from './stores/settingsStore'
import './index.css'

document.documentElement.dataset.overlay = '1'
void useSettingsStore.getState().load().then(() => {
  const s = useSettingsStore.getState().settings
  document.documentElement.dataset.tone = s.darkTone === 'navy' ? 'navy' : 'void'
  const mode =
    s.appearanceMode === 'auto'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : s.appearanceMode || 'dark'
  document.documentElement.dataset.mode = mode
})
useSettingsStore.subscribe((st) => {
  const s = st.settings
  document.documentElement.dataset.tone = s.darkTone === 'navy' ? 'navy' : 'void'
  const mode =
    s.appearanceMode === 'auto'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : s.appearanceMode || 'dark'
  document.documentElement.dataset.mode = mode
})
window.api?.onAppearanceUpdate?.((p) => {
  const mode =
    p.appearanceMode === 'auto'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : p.appearanceMode || 'dark'
  document.documentElement.dataset.mode = mode
  if (p.darkTone === 'navy' || p.darkTone === 'void') {
    document.documentElement.dataset.tone = p.darkTone
  }
  void useSettingsStore.getState().load()
})

class WidgetErrorBoundary extends Component<{ children: ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null }
  static getDerivedStateFromError(err: Error) { return { err } }
  componentDidCatch(err: Error, info: ErrorInfo) { console.error('[widget] crash', err, info) }
  render() {
    if (this.state.err) {
      return (
        <div style={{ padding: 12, background: '#7F1D1D', color: '#fff', font: '12px/1.4 monospace', whiteSpace: 'pre-wrap' }}>
          {'⚠️ 悬浮窗渲染崩溃（请截图发我）：\n' + String(this.state.err?.stack || this.state.err) + '\n\n常见原因：window.api.setWidgetPenetration 未定义（穿透提示词只改了渲染层，没改 preload/main）。'}
        </div>
      )
    }
    return this.props.children
  }
}

void window.api?.getSettings?.().then((s) => {
  const root = document.documentElement
  root.dataset.theme = s.theme ?? 'cyan'
  const am = s.appearanceMode ?? 'auto'
  const preferLight = am === 'light' || (am === 'auto' && window.matchMedia('(prefers-color-scheme: light)').matches)
  root.dataset.mode = preferLight ? 'light' : 'dark'
}).catch(() => undefined)

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <WidgetErrorBoundary><SuggestionWidget /></WidgetErrorBoundary>
)
