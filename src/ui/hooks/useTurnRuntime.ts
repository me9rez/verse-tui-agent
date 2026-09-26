/**
 * 轮次域：一轮对话的状态机（phase / streaming / 已耗时 / 中断）与 runTurn。
 *
 * 数据流：会话层产出增量 → sink 写进 store → 视图按 version 增量重绘；
 * 一轮恰好一个终态（result 或 error）由会话层保证，这里只负责起轮/收尾与落盘钩子。
 *
 * ui 用 reactive 而不是 ref 是因为它被渲染函数逐字段读（phase/streaming/elapsedMs），
 * 拆开后仍是同一份对象，语义不变。
 */
import { computed, onBeforeUnmount, reactive, type ComputedRef } from 'vue'
import { createTurnSink, type Phase } from '../../session/sink.ts'
import type { RawImage } from '../../session/seam.ts'
import type { TranscriptStore } from '../../transcript/index.ts'
import type { SessionController } from './useSessionController.ts'

export type TurnUi = {
  phase: Phase
  streaming: boolean
  aborted: boolean
  startedAt: number
  elapsedMs: number
}

export type TurnRuntime = Readonly<{
  ui: TurnUi
  /** 状态栏左段的 phase 文案（✻ Thinking… / ● Running tool… / ✻ Streaming… / ✻ ready） */
  phaseText: ComputedRef<string>
  runTurn(prompt: string, images?: RawImage[]): Promise<void>
  interrupt(): void
  whenIdle(): Promise<void>
}>

export function useTurnRuntime(deps: {
  store: TranscriptStore
  session: SessionController
  /** 流式节奏倍数：1 = 演示速度，0 = 尽快跑完（smoke 用） */
  speed: number
  invalidate(): void
}): TurnRuntime {
  const { store, session, speed, invalidate } = deps

  const ui = reactive<TurnUi>({ phase: 'idle', streaming: false, aborted: false, startedAt: 0, elapsedMs: 0 })
  const waiters: Array<() => void> = []

  // 已耗时走 200ms ticker：只在流式中走表，收尾停表（避免空转重绘）
  let timer: ReturnType<typeof setInterval> | null = null
  const startTicker = () => {
    if (timer) return
    timer = setInterval(() => {
      if (ui.streaming) ui.elapsedMs = Date.now() - ui.startedAt
    }, 200)
  }
  const stopTicker = () => {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
  }
  onBeforeUnmount(stopTicker)

  const sleep = (ms: number) => (ms <= 0 ? Promise.resolve() : new Promise<void>((r) => setTimeout(r, ms)))

  /** 一轮对话：会话产出增量 → 写进 store → 视图按 version 增量重绘。 */
  async function runTurn(prompt: string, images?: RawImage[]): Promise<void> {
    if (ui.streaming) return
    store.addUser(prompt)
    session.turnIndex.value += 1
    ui.streaming = true
    ui.aborted = false
    ui.phase = 'thinking'
    ui.startedAt = Date.now()
    ui.elapsedMs = 0
    startTicker()

    const { sink, finish, beginTurn } = createTurnSink(
      store,
      (phase) => {
        ui.phase = phase
      },
      {
        onTurnEnd(turnRec) {
          session.persistTurn(turnRec)
        },
      },
    )
    beginTurn(prompt)

    const chunkDelayMs = speed <= 0 ? 0 : Math.max(1, Math.round(12 * speed))
    try {
      await session.sessionRef.value.respond(
        prompt,
        {
          sink,
          aborted: () => ui.aborted,
          chunkDelayMs,
          turn: session.turnIndex.value,
          sleep,
        },
        images,
      )
    } finally {
      finish(ui.aborted, session.sessionRef.value.snapshot?.())
      ui.streaming = false
      ui.phase = 'idle'
      stopTicker()
      invalidate()
      const pending = waiters.splice(0)
      for (const resolve of pending) resolve()
    }
  }

  const phaseText = computed(() => {
    if (ui.phase === 'thinking') return '✻ Thinking…'
    if (ui.phase === 'tool') return '● Running tool…'
    if (ui.phase === 'answering') return '✻ Streaming…'
    return '✻ ready'
  })

  return {
    ui,
    phaseText,
    runTurn,
    interrupt: () => {
      if (ui.streaming) ui.aborted = true
    },
    whenIdle: () => (ui.streaming ? new Promise<void>((resolve) => waiters.push(resolve)) : Promise.resolve()),
  }
}
