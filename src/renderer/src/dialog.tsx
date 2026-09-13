import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import ReactDOM from 'react-dom/client'
import DialogApp from './dialog/App'
import { useSettingsStore } from './stores/settingsStore'
import './index.css'

document.documentElement.dataset.overlay = '1'
void useSettingsStore.getState().load().then(() => {
  const tone = useSettingsStore.getState().settings.darkTone
  document.documentElement.dataset.tone = tone === 'navy' ? 'navy' : 'void'
})
useSettingsStore.subscribe((s) => {
  document.documentElement.dataset.tone = s.settings.darkTone === 'navy' ? 'navy' : 'void'
})

class DialogErrorBoundary extends Component<{ children: ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null }
  static getDerivedStateFromError(err: Error) { return { err } }
  componentDidCatch(err: Error) { console.error('[dialog] crash', err) }
  render() {
    if (this.state.err) {
      return <div style={{ padding: 12, color: '#f87171', font: '12px monospace' }}>⚠️ 对话框崩溃：{String(this.state.err?.message || this.state.err)}</div>
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
  <DialogErrorBoundary><DialogApp /></DialogErrorBoundary>
)
