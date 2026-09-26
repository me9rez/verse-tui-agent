/**
 * 状态栏域：把 phase / 模式 / harness 模式 / 模型 / cwd 拼成左段，把
 * 会话 · usage · tools · 耗时拼成右段，并在窄终端下从右往左丢段（先丢 cwd，再丢模型），
 * 保证状态栏不换行不溢出。
 *
 * 纯计算，不碰渲染：摆坐标在 components/StatusStrip.ts。
 */
import { computed, type ComputedRef, type Ref } from 'vue'
import type { Style } from '@simon_he/vue-tui/core'
import { styles } from '../../core/theme.ts'
import { cellWidth, formatDuration } from '../../core/text.ts'
import { cacheText, ctxText, fmtK, type UsageView } from '../usage.ts'
import type { TranscriptStore } from '../../transcript/index.ts'
import type { SessionController } from './useSessionController.ts'
import type { TurnUi } from './useTurnRuntime.ts'

export type StatusSegment = { text: string; style: Style }

export type StatusBar = Readonly<{
  segs: ComputedRef<{ parts: StatusSegment[]; right: string }>
}>

/** 段间分隔（' · '）宽度；左段段间、右段段间、左右两段之间的间隙都用它 */
const SEP = 3

/**
 * 裁切优先级：数字越小越先丢；不标 dropPrio 的段（phase）永不丢。
 *
 * 这个顺序就是信息优先级，不是显示顺序：cwd 最不值钱，usage 细节次之；
 * **模型名与 harness 模式段必须留住** —— test/rpc.test.ts 在 100 列下断言
 * 「状态栏能看到后端 model」与「`· plan ·` 模式段可见」守的就是这条线。
 *（只丢左段、右段整串不参与时，右段加入 usage 后变长约 50 列，
 *  丢段循环会一路把模型段、harness 段也丢光，那两条断言就红了。）
 */
const PRIO = {
  cwd: 1,
  cache: 2,
  elapsed: 3,
  ctx: 4,
  /** 本地估算的 tok 段（没跑过 rpc 轮次时的 fallback，与 in/out 互斥出现） */
  tokens: 5,
  inOut: 6,
  model: 7,
  tools: 8,
  harness: 9,
  label: 10,
  mode: 11,
} as const

/** 带裁切优先级的段 */
type DropSegment = StatusSegment & { dropPrio?: number }

/** 段宽 = 各项之和 + 项间 ' · '（与 StatusStrip 的摆放一致：左段从 x=1 起，右段贴右边） */
function widthOf(list: Array<{ text: string }>): number {
  return list.reduce((n, p) => n + cellWidth(p.text), 0) + Math.max(0, list.length - 1) * SEP
}

/**
 * 窄终端裁切（纯函数，原地删项；test/hotkeys.test.ts 直测）：
 * 每轮丢掉「当前还在场的最低优先级项」，直到 左宽 + 右宽 + 间隙 ≤ cols - 2。
 * phase 段不标优先级 = 保底，宁可溢出也不丢，否则状态栏会空成一条线。
 */
export function fitStatus<T extends { text: string; dropPrio?: number }>(
  left: T[],
  right: T[],
  cols: number,
): void {
  const fits = (): boolean => widthOf(left) + widthOf(right) + SEP <= cols - 2
  while (!fits()) {
    let victim: T[] | null = null
    let victimIdx = -1
    let victimPrio = Number.POSITIVE_INFINITY
    for (const list of [left, right]) {
      for (let i = 0; i < list.length; i += 1) {
        const prio = list[i].dropPrio
        if (prio !== undefined && prio < victimPrio) {
          victim = list
          victimIdx = i
          victimPrio = prio
        }
      }
    }
    if (!victim) break
    victim.splice(victimIdx, 1)
  }
}

export function useStatusBar(deps: {
  store: TranscriptStore
  session: SessionController
  ui: TurnUi
  phaseText: ComputedRef<string>
  /** 欢迎块/状态栏显示的 model（模型域提供） */
  displayModel: ComputedRef<string>
  usageView: ComputedRef<UsageView | null>
  maxCtx: ComputedRef<number>
  harnessMode: Ref<string>
  cols: ComputedRef<number>
}): StatusBar {
  const { store, session, ui, phaseText, displayModel, usageView, maxCtx, harnessMode, cols } = deps

  const segs = computed(() => {
    const stats = { ...store.stats.value, tokens: store.estimateTokens() }
    // 有真实 usage（rpc 跑过至少一轮）显示 LLM 返回的用量与缓存命中；否则退回本地估算
    const uv = usageView.value
    const mode = session.sessionRef.value.kind === 'rpc' ? 'rpc' : 'mock'

    // 左段（项序 = 显示序）
    const left: DropSegment[] = [
      {
        text: `${phaseText.value}${ui.streaming ? '  (Esc 中断)' : ''}`,
        style: ui.streaming ? styles.statusActive : styles.statusOk,
      },
      { text: mode, style: styles.tipCmd, dropPrio: PRIO.mode },
      // harness 模式段（仅 rpc）：plan 高亮提醒「只规划不动手」，execute 用普通蓝
      ...(mode === 'rpc' && harnessMode.value
        ? [
            {
              text: harnessMode.value,
              style: harnessMode.value === 'plan' ? styles.statusActive : styles.tipCmd,
              dropPrio: PRIO.harness,
            },
          ]
        : []),
      { text: displayModel.value, style: styles.infoValue, dropPrio: PRIO.model },
      { text: process.cwd(), style: styles.faint, dropPrio: PRIO.cwd },
    ]

    // 右段（项序 = 显示序）：usage 的 in/out、ctx 占用、cache 命中各自可单独丢
    const usageItems: DropSegment[] = uv
      ? (
          [
            [`in ${fmtK(uv.input)}`, PRIO.inOut],
            [`out ${fmtK(uv.output)}`, PRIO.inOut],
            [ctxText(uv, maxCtx.value), PRIO.ctx],
            [cacheText(uv), PRIO.cache],
          ] as Array<[string | null, number]>
        )
          .filter((pair): pair is [string, number] => Boolean(pair[0]))
          .map(([text, dropPrio]) => ({ text, style: styles.faint, dropPrio }))
      : [{ text: `${stats.tokens} tok`, style: styles.faint, dropPrio: PRIO.tokens }]
    const right: DropSegment[] = [
      { text: session.sessionRef.value.label, style: styles.faint, dropPrio: PRIO.label },
      ...usageItems,
      { text: `${stats.tools} tools`, style: styles.faint, dropPrio: PRIO.tools },
      ...(ui.streaming
        ? [{ text: formatDuration(ui.elapsedMs), style: styles.faint, dropPrio: PRIO.elapsed }]
        : []),
    ]

    // 左右两段一起参与裁切（纯函数，见 fitStatus 注释）
    fitStatus(left, right, cols.value)

    const parts: StatusSegment[] = []
    left.forEach((item, i) => {
      if (i) parts.push({ text: ' · ', style: styles.faint })
      parts.push({ text: item.text, style: item.style })
    })
    return { parts, right: right.map((item) => item.text).join(' · ') }
  })

  return { segs }
}
