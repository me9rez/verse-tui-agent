import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // 这些套件是「线性流程 + 软断言」的有状态脚本（各起一个 TUI 实例、写 .artifacts）；
    // 文件并行没有收益，反而引入 worker 间时序抖动 → 串行换确定性。
    fileParallelism: false,
    testTimeout: 300_000,
    hookTimeout: 300_000,
  },
})
