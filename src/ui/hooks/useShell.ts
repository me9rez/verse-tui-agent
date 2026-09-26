/**
 * 终端外壳：尺寸、resize 订阅、重绘失效。
 *
 * 只在 App 的 setup 顶层调用一次 —— useTerminal() 是 inject(TerminalContextKey)，
 * 放进 TRenderPlane 子树里会拿到 **plane 作用域**的 scheduler（invalidate 只标脏那一个 plane，
 * 见 vue-tui 的 TRenderPlane.withPlane），重绘语义就与现在不同了。
 * 所以其它 hook / 子组件一律通过参数收 invalidate，不自己 useTerminal。
 */
import { onBeforeUnmount, ref, type Ref } from 'vue'
import { useTerminal } from '@simon_he/vue-tui/vue'

export type Shell = Readonly<{
  size: Ref<{ cols: number; rows: number }>
  /** 根 terminal：AppApi.rowText / screenText 直接读它的 buffer */
  terminal: ReturnType<typeof useTerminal>['terminal']
  invalidate(): void
}>

export function useShell(): Shell {
  const { terminal, scheduler } = useTerminal()
  const size = ref(terminal.size())
  const offResize = terminal.on('resize', () => {
    size.value = terminal.size()
    scheduler.invalidate()
  })
  onBeforeUnmount(offResize)
  return { size, terminal, invalidate: () => scheduler.invalidate() }
}
