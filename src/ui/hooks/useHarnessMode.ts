/**
 * harness 模式域（plan / execute）：mode/get 回填 + Shift+Tab 切换。
 * 只在 rpc 会话有意义（mock 是离线剧本，没有 harness），守卫与文案与原实现一致。
 */
import { ref, type Ref } from 'vue'
import { onBackendMode } from '../../session/mode.ts'
import type { TranscriptStore } from '../../transcript/index.ts'
import type { SessionController } from './useSessionController.ts'
import type { TurnUi } from './useTurnRuntime.ts'

export type HarnessMode = Readonly<{
  /** '' = 后端还没握手过；'plan' / 'execute' 由后端回填或切换后更新 */
  mode: Ref<string>
  toggle(): Promise<void>
}>

export function useHarnessMode(deps: {
  session: SessionController
  ui: TurnUi
  store: TranscriptStore
}): HarnessMode {
  const { session, ui, store } = deps
  const mode = ref('')
  onBackendMode((m) => {
    mode.value = m
  })

  /** Shift+Tab：plan ↔ execute。切换目标取自后端回填的当前值（没握手过按默认 plan）。 */
  async function toggle(): Promise<void> {
    if (session.sessionRef.value.kind !== 'rpc') {
      store.addNote('mock 是离线剧本，没有 harness 模式；/rpc 切到后端后用 Shift+Tab 切换 plan/execute。')
      return
    }
    if (ui.streaming) {
      store.addNote('⚠ 本轮还在跑，结束再切模式。')
      return
    }
    const target = mode.value === 'execute' ? 'plan' : 'execute'
    try {
      const next = await session.sessionRef.value.setMode?.(target)
      if (!next) {
        store.addNote('后端不支持 mode/set（需要更新 rpc_server.py）。')
        return
      }
      // 切成功后**不写转写**：当前模式在右列「模式」区与状态栏 harness 段常驻显示，
      // 写进转写只会刷屏（实测连按 9 次 Shift+Tab，9 行通知盖满整个转写区）。
      // next 仍要读出来：它同时是「后端是否真的支持 mode/set」的判据（上面那支）。
    } catch (err) {
      store.addNote(`切换模式失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return { mode, toggle }
}
