/**
 * 全局会话：中间板块的主体，铺满整个中间区域
 * - 页面（今天/计划等）以浮层形式盖在其上，关闭后回到完整会话
 * - 内含完整对话面板（消息 + 输入框）
 */
import { ComposerDialog } from './ComposerDialog'

export function SessionFloat(): JSX.Element {
  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden"
      style={{
        background: 'var(--bg-deep)',
        border: '1px solid var(--line-strong)',
        borderRadius: 'var(--r-lg)',
        boxShadow: 'var(--shadow-md)'
      }}
    >
      <ComposerDialog
        open
        onOpen={() => window.dispatchEvent(new CustomEvent('workon:focus-composer'))}
        onClose={() => undefined}
        variant="float"
      />
    </div>
  )
}
