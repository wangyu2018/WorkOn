/**
 * 收藏网址 / 情报流 / Agent 连接器：主进程与渲染进程共享类型
 * 说明：情报数据单独落盘 userData/intel.json，不进入 db.json，避免高频抓取把主库撑大。
 */

export type IntelProvider = 'local' | 'weknora' | 'memoryHub'

export interface IntelConfig {
  enabled: boolean
  time: string // HH:MM
  model: string
  localBaseUrl: string
  autoIngest: boolean
  maxPerScan: number
  providers: Record<IntelProvider, boolean>
  weknora: {
    baseUrl: string
    token: string
    /** 账号密码登录：token 过期（24h）时自动续签；password 在主进程加密存储 */
    email: string
    password: string
    knowledgeId: string
    ingestPath: string
  }
  memoryHub: {
    baseUrl: string
    instanceId: string
    userKey: string
    teamId: string
  }
}

export interface BookmarkSite {
  id: string
  title: string
  url: string
  folder: string
  browser: string
  profile: string
  sourceId: string
}

export interface BookmarkSource {
  id: string
  browser: string
  profile: string
  path: string
  count: number
  folders: number
  lastModified: number
  exists: boolean
}

export interface WatchSite {
  id: string
  title: string
  url: string
  source: string
  addedAt: number
  enabled: boolean
}

/** 加密库条目：命私密规则的收藏网址，磁盘只存 safeStorage 密文 */
export interface VaultSite {
  id: string
  title: string
  url: string
  source: string
  folder?: string
  addedAt: number
  /** auto = 命中隐私规则自动隐藏；manual = 手动隐藏 */
  reason: 'auto' | 'manual'
}

export interface VaultStatus {
  count: number
  /** safeStorage = 系统钥匙串加密；plain = 系统加密不可用时的本机降级 */
  encryption: 'safeStorage' | 'plain'
  updatedAt?: number
}

export interface IntelIngested {
  local: boolean
  weknora: boolean
  memoryHub: boolean
  errors?: Partial<Record<IntelProvider, string>>
}

export type IntelItemStatus = 'new' | 'updated' | 'unchanged' | 'error'

export interface IntelItem {
  id: string
  title: string
  url: string
  source: string
  summary: string
  tags: string[]
  hash: string
  fetchedAt: number
  createdAt: number
  status: IntelItemStatus
  error?: string
  ingested: IntelIngested
  tokens?: number
  excerpt?: string
}

export interface AgentUsage {
  calls: number
  tokens: number
  lastAt?: number
}

export interface IntelUsage {
  runs: number
  calls: number
  tokens: number
  lastRunAt?: number
  lastRunDay?: string
  lastError?: string
  dispatch: Record<string, AgentUsage>
}

export interface IntelQuota {
  values: Record<string, number>
  note: string
  updatedAt?: number
}

export interface IntelState {
  config: IntelConfig
  watch: WatchSite[]
  items: IntelItem[]
  usage: IntelUsage
  quota: IntelQuota
}

export interface ProviderStatus {
  id: IntelProvider
  name: string
  ok: boolean
  detail: string
  latencyMs?: number
}

export interface IntelScanResult {
  added: number
  updated: number
  unchanged: number
  errors: number
  items: IntelItem[]
}
