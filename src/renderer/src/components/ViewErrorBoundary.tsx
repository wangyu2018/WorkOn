/**
 * 页面级错误边界：某个视图渲染异常时只坏这一页，并显示可读错误而不是白屏
 */
import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  view: string
  children: ReactNode
}

interface State {
  error: Error | null
}

export class ViewErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[view-error]', this.props.view, error, info.componentStack)
  }

  componentDidUpdate(prev: Props): void {
    if (prev.view !== this.props.view && this.state.error) {
      this.setState({ error: null })
    }
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="glass-card !p-5">
        <div className="text-sm font-medium text-rose-300">页面「{this.props.view}」加载失败</div>
        <div className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-slate-400">
          {this.state.error.message || String(this.state.error)}
        </div>
        <div className="mt-3 flex gap-2">
          <button className="glass-btn px-3 py-1.5 text-xs" onClick={() => this.setState({ error: null })}>
            重试
          </button>
          <button
            className="glass-btn px-3 py-1.5 text-xs"
            onClick={() => {
              try { localStorage.removeItem('workon:view') } catch { /* ignore */ }
              location.reload()
            }}
          >
            重新加载应用
          </button>
        </div>
      </div>
    )
  }
}
