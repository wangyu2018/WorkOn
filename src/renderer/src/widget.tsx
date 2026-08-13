import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import ReactDOM from 'react-dom/client'
import SuggestionWidget from './widget/SuggestionWidget'
import './index.css'

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

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <WidgetErrorBoundary><SuggestionWidget /></WidgetErrorBoundary>
)
