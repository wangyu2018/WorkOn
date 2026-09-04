import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import ReactDOM from 'react-dom/client'
import TodoWidgetApp from './todoWidget/App'
import './index.css'

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
