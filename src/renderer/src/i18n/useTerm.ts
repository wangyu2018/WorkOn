/**
 * 词典 hook：组件里 `const t = useTerm()`，然后 `t('project')` / `t('askProjectQ', project.domain)`。
 * 域解析顺序：调用方给的项目域 → 主角色默认域 → generic。
 */

import { useSettingsStore } from '../stores/settingsStore'
import { defaultDomainOfUserType, resolveTerm, type TermKey } from '@shared/dictionary'

export type TermFn = (key: TermKey, domain?: string) => string

export function useTerm(): TermFn {
  const userType = useSettingsStore((s) => s.settings.userType)
  const fallback = defaultDomainOfUserType(userType)
  return (key: TermKey, domain?: string) => resolveTerm(domain || fallback, key)
}
