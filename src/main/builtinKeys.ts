/**
 * 内置服务密钥：混淆存储（XOR+Base64），防仓库/包体明文扫描与顺手爬取。
 * 注意：客户端可逆的混淆不是安全边界——密钥仍可被逆向提取，
 * 依赖控制台随时作废轮换；用户自填 key 永远优先于内置回退。
 */
const WEATHER_MASK = 'workon.paper.v1'
const WEATHER_OBF = 'R1gQUgpeS0AER1VBGkRTQFZGXF1WTxZQEwYQG0AFRgs='

function deobfuscate(obf: string, mask: string): string {
  const raw = Buffer.from(obf, 'base64').toString('binary')
  let out = ''
  for (let i = 0; i < raw.length; i++) {
    out += String.fromCharCode(raw.charCodeAt(i) ^ mask.charCodeAt(i % mask.length))
  }
  return out
}

/** 和风天气内置回退 Key（用户在 设置→天气 自填的 key 优先） */
export function builtinWeatherKey(): string {
  try {
    return deobfuscate(WEATHER_OBF, WEATHER_MASK)
  } catch {
    return ''
  }
}
