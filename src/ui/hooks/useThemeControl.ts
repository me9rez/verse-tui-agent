/**
 * 主题域：条目、选择器开关、切换（选择器 Enter 与 `/theme <名字>` 共用同一套守卫与文案）。
 *
 * 与其他三个选择器同构，区别在守卫：**主题不需要后端**（内置 dark/light 恒在，mock 下也能切），
 * 所以唯一要拦的是「本轮还在跑」—— 换色会让转写区全量重绘，跑到一半重绘会打断视口位置。
 */
import { computed, ref, type ComputedRef, type Ref } from 'vue'
import type { TCommandPaletteItem } from '@simon_he/vue-tui'
import { applyBuiltinTheme, onThemeCatalog, themeCatalog } from '../../session/theme.ts'
import type { TranscriptStore } from '../../transcript/index.ts'
import type { SessionController } from './useSessionController.ts'
import type { TurnUi } from './useTurnRuntime.ts'

export type ThemeControl = Readonly<{
  /** 选择器条目：内置两项 + 后端扫到的自定义主题（Custom: <文件名>） */
  items: ComputedRef<TCommandPaletteItem[]>
  /** 当前生效主题名（状态栏/提示用） */
  displayTheme: ComputedRef<string>
  pickerOpen: Ref<boolean>
  selIdx: Ref<number>
  /** /theme 无参：弹选择器 */
  openPicker(beforeOpen?: () => void): void
  /** /theme <名字>：文本路径直切 */
  applySwitch(name: string): Promise<void>
}>

export function useThemeControl(deps: {
  session: SessionController
  ui: TurnUi
  store: TranscriptStore
}): ThemeControl {
  const { session, ui, store } = deps

  const pickerOpen = ref(false)
  const selIdx = ref(0)
  /** 目录变化（后端 theme/list 回来、或本地切过）时靠它让 computed 失效重算 */
  const version = ref(0)
  onThemeCatalog(() => {
    version.value++
  })

  const items = computed<TCommandPaletteItem[]>(() => {
    void version.value
    const c = themeCatalog()
    return c.themes.map((t) => ({
      // 与 Kimi 一致：自定义主题带 Custom: 前缀，一眼区分内置
      label: t.source === 'custom' ? `Custom: ${t.name}` : t.name,
      detail: `${t.source === 'custom' ? `自定义 · 基于 ${t.base}` : `内置 · ${t.base}`}${t.name === c.current ? '（当前）' : ''}`,
      value: t.name,
      keywords: [t.displayName, t.base, t.source],
    }))
  })

  const displayTheme = computed(() => {
    void version.value
    return themeCatalog().current
  })

  /** 打开选择器前把高亮预置到当前主题。 */
  function currentIndex(): number {
    const cur = themeCatalog().current
    const i = items.value.findIndex((one) => one.value === cur)
    return i >= 0 ? i : 0
  }

  /** 切换的共用实现：选择器 Enter 与 /theme <名字> 走同一套守卫、调用与文案。 */
  async function applySwitch(name: string): Promise<void> {
    if (ui.streaming) {
      store.addNote('⚠ 本轮还在跑，等结束再换主题。')
      return
    }
    const c = themeCatalog()
    if (!c.themes.some((t) => t.name === name)) {
      store.addNote(`没有主题「${name}」。可用：${c.themes.map((t) => t.name).join(' / ')}`)
      return
    }
    if (session.sessionRef.value.kind === 'rpc') {
      try {
        const next = await session.sessionRef.value.setTheme?.(name)
        if (!next) store.addNote('后端不支持 theme/set（需要更新 rpc_server.py）。')
        else {
          store.addNote(`主题已切换为 ${next}（会话内有效；要常驻就写 tui.toml 的 theme）`)
          store.bump() // 行样式是渲染时求值的：bump 一次即全量换色
        }
      } catch (err) {
        store.addNote(`切换失败：${err instanceof Error ? err.message : String(err)}`)
      }
      return
    }
    const applied = applyBuiltinTheme(name)
    store.addNote(`主题已切换为 ${applied}（内置；mock 下只有 dark / light，/rpc 后可读自定义主题）`)
    store.bump()
  }

  /** 打开主题选择器（/theme 无参）。 */
  function openPicker(beforeOpen?: () => void): void {
    if (ui.streaming) {
      store.addNote('⚠ 本轮还在跑，等结束再换主题。')
      return
    }
    selIdx.value = currentIndex()
    beforeOpen?.() // 几个选择器互斥，别叠开（由装配层关掉另外几个）
    pickerOpen.value = true
  }

  return { items, displayTheme, pickerOpen, selIdx, openPicker, applySwitch }
}
