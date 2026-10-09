/**
 * 天气模块（v3.4）：基于和风天气（QWeather）按城市名查询，本地维护城市，不采集经纬度
 *
 * 设计：
 *  - 城市：用户在设置里填（settings.city）；API Key：用户自填优先，未填回退内置混淆 key（builtinKeys.ts）
 *  - 新版和风 API：每个账号有独立 host（形如 xxxxx.qweatherapi.com），认证用请求头 X-QW-Api-Key
 *  - 城市名 → 城市搜索 API 拿 LocationID → 实时/逐小时/3天预报 API
 *  - 结果本地缓存 30 分钟，避免频繁请求（和风免费版有 QPS 限制）
 *  - 网络失败时返回缓存（若有），否则返回错误信息
 *  - 提供三档数据：实时（getWeather）、今晚+明天摘要（getWeatherBrief）、未来逐小时（getWeatherNextHours）
 */
import { getSettings } from './settings'
import { builtinWeatherKey } from './builtinKeys'

/** 单个时间点的天气（和风 24h 预报每 1 小时一条） */
export interface WeatherHour {
  /** 小时（0-23） */
  hour: number
  /** 完整时间戳（ms），用于跨天边界判断「未来 N 小时」 */
  ts: number
  /** 天气描述（和风直接返回中文，如「多云」） */
  text: string
  /** 温度（℃） */
  tempC: number
  /** 天气图标代码（和风 icon） */
  code: number
  /** 降水概率（%） */
  chanceOfRain: number
}

export interface WeatherInfo {
  city: string
  /** 当前天气描述 */
  text: string
  /** 当前温度（℃） */
  tempC: number
  /** 体感温度（℃） */
  feelsC: number
  /** 湿度（%） */
  humidity: number
  /** 风速（km/h） */
  windKph: number
  /** 天气图标代码（和风 icon） */
  code: number
  /** 今日最高/最低温 */
  maxC: number
  minC: number
  /** 未来逐小时（今天剩余时段） */
  hourly: WeatherHour[]
  /** 明天天气摘要 */
  tomorrow: { text: string; maxC: number; minC: number; code: number }
  /** 数据时间戳 */
  ts: number
}

interface CacheEntry {
  city: string
  data: WeatherInfo
  ts: number
}

const CACHE_TTL_MS = 30 * 60 * 1000 // 30 分钟
let cache: CacheEntry | null = null
/** 城市名 → LocationID 缓存（避免每次重复搜索） */
let locCache: { city: string; id: string } | null = null

/** 判断天气描述是否属于降水（雨/雪/雷/冰雹） */
function isPrecipText(text: string): boolean {
  return /(雨|雪|雷|雹|冰粒)/.test(text)
}

/** 城市名 → LocationID（和风城市搜索 API，新版用 X-QW-Api-Key 头） */
async function lookupLocation(city: string, key: string, host: string): Promise<string> {
  if (locCache && locCache.city === city) return locCache.id
  const url = `https://${host}/geo/v2/city/lookup?location=${encodeURIComponent(city)}&range=cn&number=1`
  const res = await fetch(url, {
    headers: { 'X-QW-Api-Key': key },
    signal: AbortSignal.timeout(8000)
  })
  if (!res.ok) throw new Error(`城市搜索 HTTP ${res.status}`)
  const json = (await res.json()) as { code: string; location?: { id: string }[] }
  if (json.code !== '200' || !json.location?.[0]?.id) {
    throw new Error(`城市「${city}」未找到（${json.code}）`)
  }
  const id = json.location[0].id
  locCache = { city, id }
  return id
}

/** 从和风 JSON 提取实时 + 逐小时 + 明天 */
function parseQweather(nowJson: any, hourlyJson: any, dailyJson: any, city: string): WeatherInfo {
  const now = nowJson?.now ?? {}
  const hourly = hourlyJson?.hourly ?? []
  const daily = dailyJson?.daily ?? []
  const today = daily[0] ?? {}
  const tomorrow = daily[1] ?? {}

  const nowTs = Date.now()
  const hourlyList: WeatherHour[] = hourly
    .map((h: any) => {
      const hour = Number(h?.fxTime?.slice(11, 13) ?? 0)
      const fxTs = new Date(h?.fxTime).getTime()
      return {
        hour,
        ts: Number.isNaN(fxTs) ? nowTs : fxTs,
        text: h?.text ?? '未知',
        tempC: Number(h?.temp ?? 0),
        code: Number(h?.icon ?? 0),
        chanceOfRain: Number(h?.pop ?? 0)
      }
    })
    .filter((h: WeatherHour, i: number) => {
      // 只保留当前及之后时段：优先用 fxTime 完整时间戳判断，避免跨天边界误判
      const fx = hourly[i]?.fxTime
      if (fx) {
        const t = new Date(fx).getTime()
        if (!Number.isNaN(t)) return t >= nowTs
      }
      return h.hour >= new Date().getHours()
    })

  return {
    city,
    text: now?.text ?? '未知',
    tempC: Number(now?.temp ?? 0),
    feelsC: Number(now?.feelsLike ?? 0),
    humidity: Number(now?.humidity ?? 0),
    windKph: Number(now?.windSpeed ?? 0),
    code: Number(now?.icon ?? 0),
    maxC: Number(today?.tempMax ?? 0),
    minC: Number(today?.tempMin ?? 0),
    hourly: hourlyList,
    tomorrow: {
      text: tomorrow?.textDay ?? '未知',
      maxC: Number(tomorrow?.tempMax ?? 0),
      minC: Number(tomorrow?.tempMin ?? 0),
      code: Number(tomorrow?.iconDay ?? 0)
    },
    ts: Date.now()
  }
}

/**
 * 获取指定城市的实时天气（含未来逐小时 + 明天）。
 * @param city 城市名（如「北京」「天津」），为空时回退到 settings.city
 */
export async function getWeather(city?: string): Promise<WeatherInfo | { error: string }> {
  const s = getSettings()
  const target = (city ?? s.city ?? '').trim()
  // 用户自填 key 优先；未填时回退内置混淆 key（防包体明文扫描，见 builtinKeys.ts）
  const key = (s.weatherApiKey ?? '').trim() || builtinWeatherKey()
  const host = (s.weatherApiHost ?? '').trim().replace(/^https?:\/\//, '')
  if (!target) {
    return { error: '未设置城市，请在「我的位置」中填写城市名' }
  }
  if (!key) {
    return { error: '未配置和风天气 API Key，请在「设置 → 天气」中填写' }
  }
  if (!host) {
    return { error: '未配置和风天气 API Host，请在「设置 → 天气」中填写（控制台设置页查看）' }
  }

  // 命中缓存（同城市且未过期）
  if (cache && cache.city === target && Date.now() - cache.ts < CACHE_TTL_MS) {
    return cache.data
  }

  try {
    const locId = await lookupLocation(target, key, host)
    const base = `https://${host}/v7/weather`
    const headers = { 'X-QW-Api-Key': key }
    const [nowRes, hourlyRes, dailyRes] = await Promise.all([
      fetch(`${base}/now?location=${locId}`, { headers, signal: AbortSignal.timeout(8000) }),
      fetch(`${base}/24h?location=${locId}`, { headers, signal: AbortSignal.timeout(8000) }),
      fetch(`${base}/3d?location=${locId}`, { headers, signal: AbortSignal.timeout(8000) })
    ])
    const [nowJson, hourlyJson, dailyJson] = (await Promise.all([
      nowRes.json(),
      hourlyRes.json(),
      dailyRes.json()
    ])) as [any, any, any]
    if (nowJson.code !== '200') throw new Error(`实时天气 ${nowJson.code}`)
    const data = parseQweather(nowJson, hourlyJson, dailyJson, target)
    cache = { city: target, data, ts: Date.now() }
    return data
  } catch (e) {
    // 网络失败时回退到缓存
    if (cache && cache.city === target) return cache.data
    return { error: `天气查询失败：${(e as Error).message}` }
  }
}

/** 未来 N 小时内的天气（用于右上角图标，取逐小时段） */
export async function getWeatherNextHours(city: string | undefined, hours: number): Promise<WeatherHour[] | { error: string }> {
  const res = await getWeather(city)
  if ('error' in res) return res
  const nowTs = Date.now()
  // 只取未来 hours 小时内（用完整时间戳判断，避免跨天边界把「明天同一小时」误算进来）
  return res.hourly.filter((h) => h.ts >= nowTs && h.ts < nowTs + hours * 3600 * 1000)
}

/** 今晚 + 明天天气摘要（用于下班/周末提醒） */
export async function getWeatherBrief(city: string | undefined): Promise<{ tonight: WeatherHour | null; tomorrow: WeatherInfo['tomorrow'] } | { error: string }> {
  const res = await getWeather(city)
  if ('error' in res) return res
  // 今晚：取今天 18 点之后最近的一个时段（用完整时间戳判断，避免取到明天 18 点）
  const today18 = new Date()
  today18.setHours(18, 0, 0, 0)
  const tonight = res.hourly.find((h) => h.ts >= today18.getTime()) ?? res.hourly[res.hourly.length - 1] ?? null
  return { tonight, tomorrow: res.tomorrow }
}

/** 判断未来 N 小时内是否有降水（供"有雨优先弹雨"） */
export function hasPrecipIn(hours: WeatherHour[]): boolean {
  return hours.some((h) => isPrecipText(h.text))
}