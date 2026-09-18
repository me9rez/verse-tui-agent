/**
 * 二分定位脚本：不带 TUI，直接驱动 AI SDK 会话，看事件循环是否还会被卡住。
 * 用法：VT_DEBUG_PROMPT=... node src/debug-agent.ts
 */
import { spawn } from 'node:child_process'
import { createAiSdkSession } from '../agent/aiSdkSession.ts'
import type { TurnSink } from '../agent/session.ts'
import { loadDotEnv } from '../core/env.ts'

// .env / .env.local 先于业务逻辑加载（真实环境变量优先，文件不覆盖已存在的键）
loadDotEnv()


const heartbeat = setInterval(() => {
  console.log(`~ ${new Date().toISOString().slice(11, 19)} 事件循环活着${process.env.VT_DEBUG_NO_TOOLS ? '（无工具）' : ''}`)
}, 2000)

if (process.env.VT_DEBUG_SPAWN_ONLY === '1') {
  // 只测 spawn 那条命令本身，不接任何 UI
  const cmd = 'dir /b *.txt | find /c /v ""'
  const child = spawn('cmd.exe', ['/d', '/s', '/c', cmd], { cwd: process.cwd(), windowsHide: true })
  child.stdin?.end()
  child.stdout.on('data', (d) => console.log('out:', JSON.stringify(d.toString().slice(0, 60))))
  child.stderr.on('data', (d) => console.log('err:', JSON.stringify(d.toString().slice(0, 60))))
  child.on('close', (code) => {
    console.log(`close code=${code}`)
    clearInterval(heartbeat)
    process.exit(0)
  })
  setTimeout(() => {
    console.log('子进程 8s 没结束（命令在等 stdin）——但看心跳是否还活着')
  }, 8000)
  setTimeout(() => {
    console.log('20s 到：taskkill 进程树')
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
  }, 20_000)
} else {
  const session = createAiSdkSession({
    baseUrl: process.env.VT_BASE_URL ?? '',
    model: process.env.VT_MODEL ?? '',
    apiKey: process.env.VT_API_KEY,
    root: process.cwd(),
  })
  const sink: TurnSink = {
    thinkingDelta: (d) => process.stdout.write(`[think]${d.slice(0, 40)}`),
    thinkingEnd: () => console.log('\n[think end]'),
    toolStart: (t) => console.log(`\n[tool start] ${t.name}(${t.arg})`),
    toolLine: (t, line) => console.log(`  [tool line] ${line.slice(0, 100)}`),
    toolEnd: (t, status) => console.log(`[tool end] ${t.name} → ${status}`),
    answerDelta: (d) => process.stdout.write(d),
  }
  const prompt = process.env.VT_DEBUG_PROMPT ?? '直接动手，不要推理。用 bash 统计当前目录有几个 .txt 文件，然后一句话回答。'
  await session.respond(prompt, {
    sink,
    aborted: () => false,
    chunkDelayMs: 0,
    turn: 1,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  })
  console.log('\n[done]')
  clearInterval(heartbeat)
  process.exit(0)
}
