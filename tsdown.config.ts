import { defineConfig } from 'tsdown'

// 打包 src/cli 两个可执行入口为 ESM；依赖（vue、@simon_he/vue-tui）保持 external，
// 由运行时的 node_modules 解析——这是应用不是库，不做 dts。
export default defineConfig({
  entry: ['src/cli/terminal.ts', 'src/cli/shot.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  clean: true,
  // bin 入口需要 shebang（npm 装出来的 shim 靠它找到 node）；node 本身会剥掉 #! 行
  banner: { js: '#!/usr/bin/env node' },
})
