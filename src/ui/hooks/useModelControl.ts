/**
 * 模型域：后端权威 model id、选择器条目与开关、切模型（选择器 Enter 与 /model <id> 文本路径共用）、
 * 以及「模型决定」的两个派生值：上下文窗口 maxCtx（config/get 下发）与本轮真实 usage 视图。
 *
 * 权威来源是后端：握手 initialize 回填 + /model 切换后更新，不拿本地配置当真相；
 * mock 没有模型概念（displayModel 走 kind 分支）。
 */
import { computed, ref, type ComputedRef, type Ref } from 'vue'
import type { TCommandPaletteItem } from '@simon_he/vue-tui'
import { onBackendModel } from '../../session/model.ts'
import { onBackendUsage } from '../../session/usage.ts'
import { effectiveConfig } from '../../core/config.ts'
import { readUsage, type UsageView } from '../usage.ts'
import type { TranscriptStore } from '../../transcript/index.ts'
import type { SessionController } from './useSessionController.ts'
import type { TurnUi } from './useTurnRuntime.ts'

export type ModelControl = Readonly<{
  /** 后端回填的 model id（没握手过 = ''） */
  backendModel: Ref<string>
  /** 欢迎块/状态栏显示的 model：rpc = 后端确认的 id（没连上显示「连接后端中…」）；mock = 离线剧本 */
  displayModel: ComputedRef<string>
  /** 选择器条目 = config/get 下发的 [models] 别名（与 model/set 同一语义） */
  items: ComputedRef<TCommandPaletteItem[]>
  /** 当前模型上下文窗口：ctx 百分比的分母；没配 = 0 */
  maxCtx: ComputedRef<number>
  /** 上一轮真实 usage 的视图（null = 状态栏退回本地估算） */
  usageView: ComputedRef<UsageView | null>
  /** 当前模型是否声明 image_in：不支持时图片在请求前被后端投影为文本占位符（请求仍成功） */
  imageSupported: ComputedRef<boolean>
  pickerOpen: Ref<boolean>
  selIdx: Ref<number>
  /** /model 无参：弹选择器（Alt+M 是顺序直切，不弹窗） */
  openPicker(beforeOpen?: () => void): Promise<void>
  /** Alt+M：按 [models] 顺序循环直切下一个模型（不弹窗） */
  cycle(): Promise<void>
  /** /model <id>：文本路径直切 */
  applySwitch(id: string): Promise<void>
}>

export function useModelControl(deps: {
  session: SessionController
  ui: TurnUi
  store: TranscriptStore
}): ModelControl {
  const { session, ui, store } = deps

  const backendModel = ref('')
  onBackendModel((m) => {
    backendModel.value = m
  })
  const displayModel = computed(() =>
    session.sessionRef.value.kind === 'rpc'
      ? backendModel.value || '连接后端中…'
      : '离线剧本',
  )

  /** 上一轮 LLM 真实 usage（agent/chat 终态 result.usage 回填）：状态栏 ctx/cache 段数据源 */
  const backendUsage = ref<Record<string, number> | null>(null)
  onBackendUsage((u) => {
    backendUsage.value = u
  })
  const usageView = computed(() => readUsage(backendUsage.value))

  const maxCtx = computed<number>(() => {
    const alias = backendModel.value || effectiveConfig().default_model
    const m = effectiveConfig().models.find((one) => one.alias === alias)
    return m?.max_context_size || 0
  })
  const imageSupported = computed<boolean>(() => {
    const alias = backendModel.value || effectiveConfig().default_model
    const m = effectiveConfig().models.find((one) => one.alias === alias)
    return !!m?.capabilities?.includes('image_in')
  })

  // ── 选择器 ────────────────────────────────────────────────────────────
  /** TCommandPalette 的 selectedIndex 是受控 prop（源码读 props.selectedIndex ?? inner，只传静态值会冻结 ↑↓），必须双向绑 */
  const pickerOpen = ref(false)
  const selIdx = ref(0)
  const items = computed<TCommandPaletteItem[]>(() => {
    const cur = backendModel.value || effectiveConfig().default_model
    return effectiveConfig().models.map((m) => ({
      label: m.alias,
      // detail 只留 display_name（+当前标记）：provider 已在别名里，原始 id /env 可查——
      // 曾拼 ' · provider/model' 整条原始 id，行太长右列被截断（2026-09-24 截图反馈）
      detail: `${m.display_name || m.model}${m.alias === cur ? '（当前）' : ''}`,
      value: m.alias,
      keywords: [m.model, m.provider],
    }))
  })
  /** 打开选择器前把高亮预置到当前模型。 */
  function currentIndex(): number {
    const cur = backendModel.value || effectiveConfig().default_model
    const i = items.value.findIndex((m) => m.value === cur)
    return i >= 0 ? i : 0
  }

  /** /model 切换的共用实现：选择器 Enter 与 /model <id> 文本路径走同一套守卫、调用与文案。 */
  async function applySwitch(id: string): Promise<void> {
    if (session.sessionRef.value.kind !== 'rpc') {
      store.addNote('当前是 mock 剧本，没有模型可切；/rpc 切到后端后再用 /model <id>。')
      return
    }
    if (ui.streaming) {
      store.addNote('⚠ 本轮还在跑，等结束再切换模型。')
      return
    }
    try {
      const next = await session.sessionRef.value.setModel?.(id)
      if (!next) store.addNote('后端不支持 model/set（需要更新 rpc_server.py）。')
      else
        store.addNote(
          `模型已切换为 ${next}：服务端后续轮次生效；plan/todos 随 harness 重建重置，对话历史仍在磁盘。`,
        )
    } catch (err) {
      store.addNote(`切换失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /** 打开模型选择器：/model 无参使用（Alt+M 是顺序直切，不弹窗）。 */
  async function openPicker(beforeOpen?: () => void): Promise<void> {
    if (session.sessionRef.value.kind !== 'rpc') {
      store.addNote(`当前模型：${displayModel.value}（mock 剧本无模型）`)
    } else if (ui.streaming) {
      store.addNote('⚠ 本轮还在跑，等结束再切换模型。')
    } else if (!items.value.length) {
      store.addNote(`当前模型：${displayModel.value}（config.toml [models] 为空，可用 /model <id> 直切）`)
    } else {
      selIdx.value = currentIndex()
      beforeOpen?.() // 三个选择器互斥，别叠开（由装配层关掉另外两个）
      pickerOpen.value = true
    }
  }

  /** Alt+M：按 [models] 顺序循环直切下一个模型（不弹窗）。守卫与 applySwitch 一致。 */
  async function cycle(): Promise<void> {
    if (session.sessionRef.value.kind !== 'rpc') {
      store.addNote(`当前模型：${displayModel.value}（mock 剧本无模型）`)
      return
    }
    if (ui.streaming) {
      store.addNote('⚠ 本轮还在跑，等结束再切换模型。')
      return
    }
    const models = effectiveConfig().models
    if (!models.length) {
      store.addNote(`当前模型：${displayModel.value}（config.toml [models] 为空，可用 /model <id> 直切）`)
      return
    }
    const cur = backendModel.value || effectiveConfig().default_model
    const i = models.findIndex((m) => m.alias === cur)
    const next = models[(i + 1 + models.length) % models.length]!
    await applySwitch(next.alias)
  }

  return {
    backendModel,
    displayModel,
    items,
    maxCtx,
    usageView,
    imageSupported,
    pickerOpen,
    selIdx,
    openPicker,
    cycle,
    applySwitch,
  }
}
