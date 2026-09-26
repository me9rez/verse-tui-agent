/**
 * 思考强度域（/effort）：档位表来自后端 thinking/get，切换走 thinking/set。
 *
 * 条目在打开瞬间从 thinking/get 构建存 ref（异步取数无响应式依赖，用 computed 会把首帧空值缓存住）；
 * 每次 cycle 也重新取实时值，切模型后不会用过期档位。
 */
import { ref, type Ref } from 'vue'
import type { TCommandPaletteItem } from '@simon_he/vue-tui'
import type { TranscriptStore } from '../../transcript/index.ts'
import type { SessionController } from './useSessionController.ts'
import type { TurnUi } from './useTurnRuntime.ts'

export type EffortControl = Readonly<{
  /** 当前思考档位：thinking/get 回填 + 切换后更新（空 = 后端未设置/不发光标参数） */
  effort: Ref<string>
  items: Ref<TCommandPaletteItem[]>
  pickerOpen: Ref<boolean>
  selIdx: Ref<number>
  /** /effort 无参：弹选择器（Alt+E 是顺序直切，不弹窗） */
  openPicker(beforeOpen?: () => void): Promise<void>
  /** Alt+E：在当前模型的档位表内循环直切下一档（不弹窗） */
  cycle(): Promise<void>
  /** /effort <档位>：文本路径直切 */
  applySwitch(level: string): Promise<void>
}>

export function useEffortControl(deps: {
  session: SessionController
  ui: TurnUi
  store: TranscriptStore
}): EffortControl {
  const { session, ui, store } = deps

  const effort = ref('')
  const pickerOpen = ref(false)
  const selIdx = ref(0)
  const items = ref<TCommandPaletteItem[]>([])

  /** /effort 切换的共用实现：选择器 Enter 与 /effort <档位> 文本路径走同一套守卫、调用与文案。 */
  async function applySwitch(level: string): Promise<void> {
    if (session.sessionRef.value.kind !== 'rpc') {
      store.addNote('当前是 mock 剧本，没有思考档位；/rpc 切到后端后再用 /effort <档位>。')
      return
    }
    if (ui.streaming) {
      store.addNote('⚠ 本轮还在跑，等结束再切换思考档位。')
      return
    }
    try {
      const next = await session.sessionRef.value.setThinking?.(level.toLowerCase())
      if (!next) store.addNote('后端不支持 thinking/set（需要更新 rpc_server.py）。')
      else {
        effort.value = next
        store.addNote(
          `思考档位已切换为 ${next}：下一轮生效（off = 关闭思考；模型不支持时后端回 -32602）。`,
        )
      }
    } catch (err) {
      store.addNote(`切换失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /** 打开思考强度选择器：/effort 无参与 Alt+E 共用（守卫同 applySwitch 的前置检查）。 */
  async function openPicker(beforeOpen?: () => void): Promise<void> {
    if (session.sessionRef.value.kind !== 'rpc') {
      store.addNote('当前是 mock 剧本，没有思考档位；/rpc 切到后端后再用 /effort <档位>。')
      return
    }
    if (ui.streaming) {
      store.addNote('⚠ 本轮还在跑，等结束再切换思考档位。')
      return
    }
    try {
      const info = await session.sessionRef.value.getThinking?.()
      if (!info) {
        store.addNote('后端不支持 thinking/get（需要更新 rpc_server.py）。')
        return
      }
      effort.value = info.effort
      const levels = info.support_efforts.length ? info.support_efforts : ['low', 'medium', 'high', 'xhigh']
      if (!levels.includes('off')) levels.push('off')
      items.value = levels.map((lv) => ({
        label: lv,
        detail: lv === info.effort ? '（当前）' : lv === 'off' ? '关闭思考' : '',
        value: lv,
        keywords: [lv],
      }))
      selIdx.value = Math.max(0, levels.indexOf(info.effort))
      beforeOpen?.() // 三个选择器互斥，别叠开（由装配层关掉另外两个）
      pickerOpen.value = true
    } catch (err) {
      store.addNote(`读取思考档位失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /** Alt+E：在当前模型的档位表内循环直切下一档（不弹窗）。
   *  当前档位来自 thinking/get（每次取实时值，切模型后不会用过期状态）。 */
  async function cycle(): Promise<void> {
    if (session.sessionRef.value.kind !== 'rpc') {
      store.addNote('当前是 mock 剧本，没有思考档位；/rpc 切到后端后再用 /effort <档位>。')
      return
    }
    if (ui.streaming) {
      store.addNote('⚠ 本轮还在跑，等结束再切换思考档位。')
      return
    }
    try {
      const info = await session.sessionRef.value.getThinking?.()
      if (!info) {
        store.addNote('后端不支持 thinking/get（需要更新 rpc_server.py）。')
        return
      }
      effort.value = info.effort
      const levels = info.support_efforts.length ? info.support_efforts : ['low', 'medium', 'high', 'xhigh']
      if (!levels.includes('off')) levels.push('off')
      const i = levels.indexOf(info.effort)
      await applySwitch(levels[(i + 1 + levels.length) % levels.length]!)
    } catch (err) {
      store.addNote(`切换思考档位失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return { effort, items, pickerOpen, selIdx, openPicker, cycle, applySwitch }
}
