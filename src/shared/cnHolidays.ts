/**
 * 中国法定节假日 / 调休补班表（本地数据，无外部 API）。
 * - holiday = 放休日（红）；workday = 周末调休补班日（班）。
 * - 2025：按国办发明电〔2024〕7 号，完整准确。
 * - 2026：节日法定日按公历/农历既定日期内置；**调休补班日以国务院通知为准，公布后在此补齐**。
 *   补法：`'2026-02-14': { name: '春节', type: 'workday' }` 一行一条。
 */
export interface HolidayDay {
  name: string
  type: 'holiday' | 'workday'
}

const TABLE: Record<string, HolidayDay> = {
  // ── 2025 ──
  '2025-01-01': { name: '元旦', type: 'holiday' },
  '2025-01-28': { name: '春节', type: 'holiday' },
  '2025-01-29': { name: '春节', type: 'holiday' },
  '2025-01-30': { name: '春节', type: 'holiday' },
  '2025-01-31': { name: '春节', type: 'holiday' },
  '2025-02-01': { name: '春节', type: 'holiday' },
  '2025-02-02': { name: '春节', type: 'holiday' },
  '2025-02-03': { name: '春节', type: 'holiday' },
  '2025-02-04': { name: '春节', type: 'holiday' },
  '2025-01-26': { name: '春节', type: 'workday' },
  '2025-02-08': { name: '春节', type: 'workday' },
  '2025-04-04': { name: '清明节', type: 'holiday' },
  '2025-04-05': { name: '清明节', type: 'holiday' },
  '2025-04-06': { name: '清明节', type: 'holiday' },
  '2025-05-01': { name: '劳动节', type: 'holiday' },
  '2025-05-02': { name: '劳动节', type: 'holiday' },
  '2025-05-03': { name: '劳动节', type: 'holiday' },
  '2025-05-04': { name: '劳动节', type: 'holiday' },
  '2025-05-05': { name: '劳动节', type: 'holiday' },
  '2025-04-27': { name: '劳动节', type: 'workday' },
  '2025-05-31': { name: '端午节', type: 'holiday' },
  '2025-06-01': { name: '端午节', type: 'holiday' },
  '2025-06-02': { name: '端午节', type: 'holiday' },
  '2025-10-01': { name: '国庆节·中秋节', type: 'holiday' },
  '2025-10-02': { name: '国庆节·中秋节', type: 'holiday' },
  '2025-10-03': { name: '国庆节·中秋节', type: 'holiday' },
  '2025-10-04': { name: '国庆节·中秋节', type: 'holiday' },
  '2025-10-05': { name: '国庆节·中秋节', type: 'holiday' },
  '2025-10-06': { name: '国庆节·中秋节', type: 'holiday' },
  '2025-10-07': { name: '国庆节·中秋节', type: 'holiday' },
  '2025-10-08': { name: '国庆节·中秋节', type: 'holiday' },
  '2025-09-28': { name: '国庆节', type: 'workday' },
  '2025-10-11': { name: '国庆节', type: 'workday' },
  // ── 2026（节日法定日；调休补班公布后补齐） ──
  '2026-01-01': { name: '元旦', type: 'holiday' },
  '2026-01-02': { name: '元旦', type: 'holiday' },
  '2026-01-03': { name: '元旦', type: 'holiday' },
  '2026-02-16': { name: '春节（除夕）', type: 'holiday' },
  '2026-02-17': { name: '春节', type: 'holiday' },
  '2026-02-18': { name: '春节', type: 'holiday' },
  '2026-02-19': { name: '春节', type: 'holiday' },
  '2026-02-20': { name: '春节', type: 'holiday' },
  '2026-02-21': { name: '春节', type: 'holiday' },
  '2026-02-22': { name: '春节', type: 'holiday' },
  '2026-02-23': { name: '春节', type: 'holiday' },
  '2026-04-05': { name: '清明节', type: 'holiday' },
  '2026-04-06': { name: '清明节', type: 'holiday' },
  '2026-05-01': { name: '劳动节', type: 'holiday' },
  '2026-05-02': { name: '劳动节', type: 'holiday' },
  '2026-05-03': { name: '劳动节', type: 'holiday' },
  '2026-05-04': { name: '劳动节', type: 'holiday' },
  '2026-05-05': { name: '劳动节', type: 'holiday' },
  '2026-06-19': { name: '端午节', type: 'holiday' },
  '2026-06-20': { name: '端午节', type: 'holiday' },
  '2026-06-21': { name: '端午节', type: 'holiday' },
  '2026-09-25': { name: '中秋节', type: 'holiday' },
  '2026-09-26': { name: '中秋节', type: 'holiday' },
  '2026-09-27': { name: '中秋节', type: 'holiday' },
  '2026-10-01': { name: '国庆节', type: 'holiday' },
  '2026-10-02': { name: '国庆节', type: 'holiday' },
  '2026-10-03': { name: '国庆节', type: 'holiday' },
  '2026-10-04': { name: '国庆节', type: 'holiday' },
  '2026-10-05': { name: '国庆节', type: 'holiday' },
  '2026-10-06': { name: '国庆节', type: 'holiday' },
  '2026-10-07': { name: '国庆节', type: 'holiday' }
}

/** 查某天的节假日信息：null = 普通日 */
export function holidayOf(dateKey: string): HolidayDay | null {
  return TABLE[dateKey] ?? null
}

/** 是否放休日（含节假日与周末）——排班/达成率口径可用 */
export function isRestDay(dateKey: string): boolean {
  const hol = TABLE[dateKey]
  if (hol) return hol.type === 'holiday'
  const d = new Date(dateKey + 'T00:00:00')
  const dow = d.getDay()
  return dow === 0 || dow === 6
}
