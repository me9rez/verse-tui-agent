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

    const usageSegs: string[] = uv
      ? [
          `in ${fmtK(uv.input)}`,
          `out ${fmtK(uv.output)}`,
          ctxText(uv, maxCtx.value),
          cacheText(uv),
        ].filter((s): s is string => !!s)
      : [`${stats.tokens} tok`]
    const right = [
      session.sessionRef.value.label,
      ...usageSegs,
      `${stats.tools} tools`,
      ui.streaming ? formatDuration(ui.elapsedMs) : '',
    ]
      .filter(Boolean)
      .join(' · ')
    const model = displayModel.value
    const parts: StatusSegment[] = [
      { text: `${phaseText.value}${ui.streaming ? '  (Esc 中断)' : ''}`, style: ui.streaming ? styles.statusActive : styles.statusOk },
      { text: ' · ', style: styles.faint },
      { text: mode, style: styles.tipCmd },
      // harness 模式段（仅 rpc）：plan 高亮提醒「只规划不动手」，execute 用普通蓝
      ...(mode === 'rpc' && harnessMode.value
        ? [
            { text: ' · ', style: styles.faint },
            {
              text: harnessMode.value,
              style: harnessMode.value === 'plan' ? styles.statusActive : styles.tipCmd,
            },
          ]
        : []),
      { text: ' · ', style: styles.faint },
      { text: model, style: styles.infoValue },
      { text: ' · ', style: styles.faint },
      { text: process.cwd(), style: styles.faint },
    ]
    // 窄终端从右往左丢段（先丢 cwd，再丢模型），保证状态栏不换行不溢出
    const rightW = cellWidth(right)
    const widthOf = (list: StatusSegment[]): number => list.reduce((n, p) => n + cellWidth(p.text), 0)
    while (parts.length > 1 && widthOf(parts) + rightW + 3 > cols.value - 2) {
      parts.pop() // cwd/model 段
      if (parts.at(-1)?.text === ' · ') parts.pop()
    }
    return { parts, right }
  })

  return { segs }
}
