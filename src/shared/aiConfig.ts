/**
 * AI 接入配置的共享判定
 * - 本机 / 内网地址（Ollama 等）默认无鉴权，允许免 API Key 使用
 * - 远程 OpenAI 兼容服务仍需 Key
 */

/** 是否为本机 / 内网 AI 服务地址（Ollama 默认无鉴权） */
export function isLocalAiBaseUrl(baseUrl?: string): boolean {
  const raw = String(baseUrl ?? '').trim()
  if (!raw) return false
  let host = ''
  try {
    host = new URL(raw).hostname.toLowerCase()
  } catch {
    return false
  }
  if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '[::1]' || host === '::1') {
    return true
  }
  if (/^127\.\d+\.\d+\.\d+$/.test(host)) return true
  if (/^10\.\d+\.\d+\.\d+$/.test(host)) return true
  if (/^192\.168\.\d+\.\d+$/.test(host)) return true
  if (/^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(host)) return true
  return false
}

/** AI 是否具备可用凭据：有 Key，或指向本机/内网无鉴权服务 */
export function aiCredsReady(cfg: { aiApiKey?: string; aiBaseUrl?: string }): boolean {
  return !!String(cfg.aiApiKey ?? '').trim() || isLocalAiBaseUrl(cfg.aiBaseUrl)
}
