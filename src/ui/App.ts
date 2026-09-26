/**
 * Verse 的界面装配：终端流式 agent 的 TUI（vue-tui 渲染）。
 *
 * 版面（全屏 + alternate screen，坐标都是绝对单元格坐标）：
 *   y=0..divider-1  空态：欢迎块（版本边框 + 像素 logo + model/cwd + Tips）+ 空态提示；
 *                   有内容：转写正文（transcript plane：流式增量只重绘这里）
 *   y=dividerY      分割线（输入区上沿）
 *   y=inputY        输入行（> 前缀 + 无边框 TInput + 占位符，overlay plane——补全弹窗同平面）
 *   y=statusDividerY 分割线（输入区下沿，把输入行与状态栏分开）
 *   y=statusY       状态栏（phase · 模式 · 模型 · cwd / 会话 · tok · tools）
 *
 * 流式输出的落点全在 TranscriptStore：每次增量只改一行 + 自增 version，
 * <TTranscriptView> 比对每行 getRowVersion 后只重绘脏行。
 */
import { computed, defineComponent, h, ref, type PropType } from 'vue'
import { TView } from '@simon_he/vue-tui'
import { TRenderPlane } from '@simon_he/vue-tui/agent'
import { layoutOf } from './layout.ts'
// 界面按功能域拆在 hooks/（组合式函数，无渲染）与 components/（渲染子组件）里；
// 本文件只剩装配：props → hook 串联 → plane 外壳 → 子组件 → AppApi。
import { useShell } from './hooks/useShell.ts'
import { useSessionController } from './hooks/useSessionController.ts'
import { useTurnRuntime } from './hooks/useTurnRuntime.ts'
import { useHarnessMode } from './hooks/useHarnessMode.ts'
import { useModelControl } from './hooks/useModelControl.ts'
import { useEffortControl } from './hooks/useEffortControl.ts'
import { useImageAttachment } from './hooks/useImageAttachment.ts'
import { useStatusBar } from './hooks/useStatusBar.ts'
import { useSlashCommands } from './hooks/useSlashCommands.ts'
import { useComposer } from './hooks/useComposer.ts'
import { useKeyboardControls } from './hooks/useKeyboardControls.ts'
import { TranscriptPane } from './components/TranscriptPane.ts'
import { StatusStrip } from './components/StatusStrip.ts'
import { DividerBar } from './components/DividerBar.ts'
import { ComposerRow } from './components/ComposerRow.ts'
import { PickerStack } from './components/PickerStack.ts'
import { TipsColumn } from './components/TipsColumn.ts'
import { createTranscriptStore, type TranscriptStore } from '../transcript/index.ts'
import type { Phase } from '../session/sink.ts'

export type { Phase } from '../session/sink.ts'

export type AppApi = {
  submit(text: string): void
  interrupt(): void
  whenIdle(): Promise<void>
  store: TranscriptStore
  /** 全部折叠/展开，返回切换后的状态（true = 现已全部折叠） */
  toggleAll(): boolean
  /** 折叠/展开最近一个分组，返回组 id */
  toggleLast(): string | null
  /** 分组摘要（不含内容），供无头断言 */
  groups(): Array<{ id: string; kind: string; collapsed: boolean; lines: number }>
  /** 直接读终端 buffer 的行文本——smoke 用它断言「内容真的画到屏幕上了」。 */
  rowText(y: number): string
  screenText(): string[]
  state(): { phase: Phase; streaming: boolean; tokens: number; turns: number; tools: number; session: string }
  /** 当前会话能否导出上下文（透传 AgentSession.snapshot，ai 路返回消息数组） */
  sessionSnapshot(): unknown
  /** 当前会话 id（未落盘时为 null） */
  currentSessionId(): string | null
}

export const App = defineComponent({
  name: 'VerseApp',
  props: {
    sessionKind: { type: String as PropType<'mock' | 'rpc'>, default: 'mock' },
    /** 流式节奏倍数：1 = 演示速度，0 = 尽快跑完（smoke 用）。 */
    speed: { type: Number, default: 1 },
    autoPrompt: { type: String, default: '' },
    /** 启动时恢复哪个会话：具体 id，或 'last'（最近更新过的那个）；空 = 开新会话 */
    sessionId: { type: String, default: '' },
    /** false 时完全不动磁盘（测试与 tui.toml persist=false 走这里） */
    persist: { type: Boolean, default: true },
    /** 原始提交文本按 JSON 记入 .artifacts/input-debug.log（tui.toml debug_input / --debug-input） */
    debugInput: { type: Boolean, default: false },
    onReady: { type: Function as PropType<(api: AppApi) => void>, default: undefined },
    onExit: { type: Function as PropType<() => void>, default: undefined },
  },
  setup(props) {
    // 终端尺寸 / resize 订阅 / 重绘失效都归 useShell
    // （它也全仓唯一调用 useTerminal 的地方，见 useShell.ts 注释）
    const { size, terminal, invalidate } = useShell()

    const store = createTranscriptStore()
    // slash 补全的 plugins 与建议表归 ComposerRow（它们必须是实例级稳定引用，见该文件注释）
    const transcriptRef = ref<{ scrollToBottom?: () => void } | null>(null)

    // hook 调用顺序 = 依赖拓扑：会话域 → 轮次域 → harness 模式域。
    // 解构名与原实现一致（sessionRef / turn / ui / phaseText …），下面的调用点不用改。
    const sessionCtl = useSessionController({
      store,
      persist: props.persist,
      bootId: props.sessionId,
      bootKind: props.sessionKind,
      invalidate,
    })
    const {
      sessionRef, turnIndex: turn, current, persist,
      pickerOpen: sessionPickerOpen, pickerSelIdx: sessionSelIdx, pickerItems: sessionPickerItems,
      switchToSession, buildSessionItems, resetSession, switchKind,
    } = sessionCtl
    const turnRuntime = useTurnRuntime({
      store,
      session: sessionCtl,
      speed: props.speed,
      invalidate,
    })
    // 注意：App 里的 `turn` 是轮序（会话域），轮次域整体叫 turnRuntime
    const { ui, phaseText, runTurn, interrupt, whenIdle } = turnRuntime
    const { mode: harnessMode, toggle: toggleHarnessMode } = useHarnessMode({ session: sessionCtl, ui, store })

    // 模型域：后端 model id（权威来源）、选择器条目与开关、切模型（含 Alt+M 直切）、
    // maxCtx（ctx 百分比分母）与上一轮真实 usage 视图。
    const model = useModelControl({ session: sessionCtl, ui, store })
    const { displayModel, maxCtx, usageView, imageSupported } = model
    // 思考强度域：/effort（含 Alt+E 直切）
    const effort = useEffortControl({ session: sessionCtl, ui, store })
    const { effort: effortLevel } = effort
    // 贴图域：Alt+V 剪贴板贴图（待发图片 / 指示条 / 占位符文案）
    const image = useImageAttachment({ session: sessionCtl, imageSupported, store })
    const { chipText: imageChipText, placeholderText } = image

    // 三个选择器互斥：打开一个时关掉另外两个（与拆分前逐字一致）
    //（选择器本体渲染在 components/PickerStack.ts，三个都吃各自的 model/effort/session 对象）
    const closeOtherPickers = (keep: 'model' | 'effort' | 'session'): void => {
      if (keep !== 'model') model.pickerOpen.value = false
      if (keep !== 'effort') effort.pickerOpen.value = false
      if (keep !== 'session') sessionPickerOpen.value = false
    }

    // 状态栏域 / 命令域 / 输入域 / 键盘域：都要用到上面各域的对象，所以排在最后。
    // cols 用 computed 传（状态栏的窄终端丢段依赖列宽变化）。
    const status = useStatusBar({
      store,
      session: sessionCtl,
      ui,
      phaseText,
      displayModel,
      usageView,
      maxCtx,
      harnessMode,
      effort: effortLevel,
      cols: computed(() => size.value.cols),
    })
    const commands = useSlashCommands({
      store,
      session: sessionCtl,
      ui,
      turn: turnRuntime,
      model,
      effort,
      invalidate,
      onExit: props.onExit,
      closeOtherPickers,
    })
    const composer = useComposer({ turn: turnRuntime, image, commands, debugInput: props.debugInput })
    const { input, composerKey } = composer
    /** 全局按键表（挂在 TView 的 onKeydownCapture，捕获阶段先于 TInput） */
    const onKey = useKeyboardControls({
      store,
      ui,
      model,
      effort,
      harness: { mode: harnessMode, toggle: toggleHarnessMode },
      image,
      invalidate,
      scrollToBottom: () => transcriptRef.value?.scrollToBottom?.(),
      onExit: props.onExit,
    })

    /** 点击/回车落在某一行：是分组头部就折叠切换 */
    function toggleRowAt(rowIndex: number | undefined): boolean {
      if (rowIndex === undefined || rowIndex < 0) return false
      const entry = store.entryAt(rowIndex)
      if (!entry?.group) return false
      store.toggleGroup(entry.group)
      invalidate()
      return true
    }

    const api: AppApi = {
      submit: composer.submit,
      interrupt,
      whenIdle,
      store,
      toggleAll: () => {
        const next = store.toggleAllGroups()
        invalidate()
        return next
      },
      toggleLast: () => {
        const id = store.toggleLastGroup()
        invalidate()
        return id
      },
      groups: () =>
        store.groupSummary().map((g) => ({ id: g.id, kind: g.kind, collapsed: g.collapsed, lines: g.lines })),
      rowText: (y: number) =>
        terminal
          .getRow(y)
          .map((cell) => cell.ch)
          .join('')
          .trimEnd(),
      screenText: () => Array.from({ length: size.value.rows }, (_, y) => api.rowText(y)),
      state: () => ({
        phase: ui.phase,
        streaming: ui.streaming,
        tokens: store.estimateTokens(),
        turns: store.stats.value.turns,
        tools: store.stats.value.tools,
        session: sessionRef.value.id,
      }),
      sessionSnapshot: () => sessionRef.value.snapshot?.(),
      currentSessionId: () => current.session?.id ?? null,
    }

    if (props.autoPrompt) setTimeout(() => api.submit(props.autoPrompt), 30)
    setTimeout(() => props.onReady?.(api), 0)

    return () => {
      const cols = size.value.cols
      const l = layoutOf(size.value.rows, cols)
      // 关键：在分支之前先读一次 version，让整个渲染函数成为它的依赖。
      // 否则「空态」那一支不读任何响应式值，视图永远不会被唤醒去渲染正文
      //（子组件各自也读 version，这里是装配层的兜底）。
      void store.version.value
      const segs = status.segs.value

      return h(TView, { x: 0, y: 0, w: cols, h: size.value.rows, onKeydownCapture: onKey }, () => [
        // ── 正文（transcript plane：流式增量只重绘这里）──
        // 空态欢迎块 / 有内容转写 的分支在 TranscriptPane 里（它自己读 rowCount 作依赖）。
        h(TRenderPlane, { plane: 'transcript', key: 'body' }, () => [
          h(TranscriptPane, {
            store,
            // 左列可用宽：两列时是竖线左边的宽度（右列见下面 chrome plane 的 TipsColumn）
            cols: l.transcriptW,
            y: l.transcriptY,
            height: l.transcriptH,
            model: displayModel.value,
            viewRef: transcriptRef,
            onToggleRow: toggleRowAt,
          }),
        ]),
        // ── 状态栏与分割线（chrome plane：每 100ms 一次）──
        h(TRenderPlane, { plane: 'chrome', key: 'status' }, () => [
          h(StatusStrip, { parts: segs.parts, right: segs.right, cols, y: l.statusY }),
        ]),
        h(TRenderPlane, { plane: 'chrome', key: 'divider' }, () => [h(DividerBar, { cols, y: l.dividerY })]),
        // 状态栏上分割线：把输入行与状态栏分开（与输入区上沿那条同源，都在 chrome plane）
        h(TRenderPlane, { plane: 'chrome', key: 'divider-status' }, () => [
          h(DividerBar, { cols, y: l.statusDividerY }),
        ]),
        // ── 右列：竖线 │ + Tips/快捷键（文案全静态，挂 chrome plane 就够）──
        // 终端不够宽（< layout.ts 的 TWO_COL_MIN）时整块不渲染，转写独享整宽。
        ...(l.twoCol
          ? [
              h(TRenderPlane, { plane: 'chrome', key: 'tips' }, () => [
                h(TipsColumn, {
                  x: l.gutterX,
                  height: l.gutterH,
                  tipsX: l.tipsX,
                  tipsW: l.tipsW,
                  // 右列顶部「模式」区随 Shift+Tab 实时变（harnessMode 是 rpc 会话模式域的信号）
                  mode: harnessMode.value,
                }),
              ]),
            ]
          : []),
        // 输入行 = '>' 前缀 + 无边框 TInput + 占位符（step 风格）。
        // 必须在 'overlay' plane：补全弹窗画在 zIndex 1e4 的 overlay 栈，
        // 挂普通 plane/root 会被逐帧合并吃掉（实测 7 槽只剩 1 行）。
        // 输入行与补全/选择器都在 overlay plane（composer 见 components/ComposerRow.ts）。
        h(TRenderPlane, { plane: 'overlay', key: 'input' }, () => [
          h(ComposerRow, {
            cols,
            y: l.inputY,
            input: input.value,
            composerKey: composerKey.value,
            placeholder: placeholderText.value,
            imageChip: imageChipText.value,
            onInput: (v: string) => {
              input.value = v
            },
            // 提交后换掉输入框实例（清空内部文本）再走命令分发
            onSubmit: (v: string) => {
              input.value = ''
              composerKey.value += 1
              composer.submit(String(v ?? ''))
            },
          }),
          // 三个选择器（/model、/open、/effort）：开关与受控高亮的样板相同、
          // 条目与选中语义不同，装配收在 components/PickerStack.ts（同挂 overlay plane）
          h(PickerStack, { cols, model, session: sessionCtl, effort, store }),
        ]),
      ])
    }
  },
})
