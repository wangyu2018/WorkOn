import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import ReactDOM from 'react-dom/client'
import TodoWidgetApp from './todoWidget/App'
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

class TodoWidgetErrorBoundary extends Component<{ children: ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null }
  static getDerivedStateFromError(err: Error) { return { err } }
  componentDidCatch(err: Error) { console.error('[todoWidget] crash', err) }
  render() {
    if (this.state.err) {
      return <div style={{ padding: 12, color: '#f87171', font: '12px monospace' }}>⚠️ 小组件崩溃：{String(this.state.err?.message || this.state.err)}</div>
    }
    return this.props.children
  }
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <TodoWidgetErrorBoundary><TodoWidgetApp /></TodoWidgetErrorBoundary>
)
