/**
 * 页面错误采集（MAIN world，document_start）
 * 只在本机页面内存里记录，不联网上传。
 */
(() => {
  if (window.__workonErrors) return
  const errors = []
  window.__workonErrors = errors
  const push = (item) => {
    if (errors.length < 50) errors.push({ ts: Date.now(), ...item })
  }
  window.addEventListener(
    'error',
    (e) => {
      push({
        kind: 'error',
        message: String(e.message || e.error || '').slice(0, 300),
        source: String(e.filename || '') + (e.lineno ? ':' + e.lineno : '')
      })
    },
    true
  )
  window.addEventListener(
    'unhandledrejection',
    (e) => {
      const r = e.reason
      push({ kind: 'rejection', message: String((r && r.message) || r || '').slice(0, 300), source: '' })
    },
    true
  )
  const original = console.error.bind(console)
  console.error = (...args) => {
    push({
      kind: 'console',
      message: args
        .map((a) => {
          if (typeof a === 'string') return a
          try {
            return JSON.stringify(a)
          } catch {
            return String(a)
          }
        })
        .join(' ')
        .slice(0, 300),
      source: ''
    })
    original(...args)
  }
})()
