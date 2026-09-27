/**
 * 主题会话信号：把后端 `theme/list` / `theme/set` 的解析结果接到 palette 上。
 *
 * 与 model.ts / mode.ts / usage.ts 同构（一个 ref + 订阅者），但有一点不同：它**直接改 palette**
 * —— 主题不是「被展示的数据」而是渲染用的颜色本身，所以设值时顺手 applyTheme。
 *
 * 离线（mock / 后端没连上）时用 `BUILTIN_THEMES`：/theme 照样能列、能切，只是看不到自定义主题。
 * 主题文件始终由后端读（前端不碰配置文件与业务环境变量），这里只接收已经解析好的色板。
 */
import { ref } from 'vue'
import { applyTheme, BUILTIN_THEMES, DEFAULT_THEME } from '../core/theme.ts'

export type ThemeEntry = Readonly<{
  name: string
  displayName: string
  base: string
  source: 'builtin' | 'custom'
}>

export type ThemeCatalog = Readonly<{
  /** 实际生效的主题名（配置里写的名字找不到时会回落内置 dark） */
  current: string
  /** 配置里写的名字（可能是不存在的主题，见上） */
  requested: string
  base: string
  colors: Record<string, string>
  themes: ThemeEntry[]
}>

const catalog = ref<ThemeCatalog | null>(null)
type Listener = (c: ThemeCatalog) => void
const listeners = new Set<Listener>()

/** 订阅目录变化（选择器条目/高亮要跟着更新时用）。 */
export function onThemeCatalog(fn: Listener): void {
  listeners.add(fn)
}

function publish(next: ThemeCatalog): void {
  catalog.value = next
  applyTheme(next.colors, next.base)
  for (const fn of listeners) fn(next)
}

/** 后端 `theme/list` / `theme/set` 的应答 → 换色 + 广播。 */
export function setBackendTheme(payload: ThemeCatalog | null): void {
  if (!payload || !payload.current) return
  publish({
    current: payload.current,
    requested: payload.requested || payload.current,
    base: payload.base || 'dark',
    colors: payload.colors ?? {},
    themes: payload.themes ?? [],
  })
}

/** 内置目录（mock / 未握手）：dark + light，够用且值与后端同源。 */
export function builtinCatalog(current = 'dark'): ThemeCatalog {
  const name = current in BUILTIN_THEMES ? current : 'dark'
  return {
    current: name,
    requested: current,
    base: name,
    colors: { ...BUILTIN_THEMES[name] },
    themes: Object.keys(BUILTIN_THEMES).map((key) => ({
      name: key,
      displayName: key,
      base: key,
      source: 'builtin' as const,
    })),
  }
}

/** 当前可用目录：后端给过就用它（含自定义主题），否则内置。 */
export function themeCatalog(): ThemeCatalog {
  return catalog.value ?? builtinCatalog()
}

/** 离线切主题（mock / 后端未连）：只认内置名，返回实际生效的名字。 */
export function applyBuiltinTheme(name: string): string {
  const local = builtinCatalog(name)
  publish(local)
  return local.current
}

/** 切到新的后端会话/退出 rpc 时复位成内置 dark。 */
export function resetTheme(): void {
  catalog.value = null
  applyTheme(DEFAULT_THEME, 'dark')
  for (const fn of listeners) fn(builtinCatalog())
}
