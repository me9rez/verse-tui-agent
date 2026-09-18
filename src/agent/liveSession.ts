/**
 * 真实模型流：任何 OpenAI 兼容端点（含本机 llama-server / 各种网关）的 SSE。
 *
 * 启用方式：
 *   VT_LIVE=1 VT_BASE_URL=https://<endpoint>/v1 VT_MODEL=<model> [VT_API_KEY=...] pnpm dev
 *
 * 说明：这一路只做纯文本流（content + reasoning_content），不带工具调用——
 * demo 里工具那层是本地剧本演的，避免假装模型真的能执行命令。
 */
import type { AgentSession, TurnContext } from './session.ts'

export type LiveOptions = {
  baseUrl: string
  model: string
  apiKey?: string
  system?: string
}

const DEFAULT_SYSTEM = [
  '你是运行在终端里的编码助手。回答用中文，简洁、结构化。',
  '可以用 markdown：标题、列表、代码围栏（标注语言）、行内代码、表格。',
  '不要输出 emoji 装饰。',
].join('\n')

export function createLiveSession(opts: LiveOptions): AgentSession {
  return {
    id: 'live',
    label: `live · ${opts.model}`,
    async respond(prompt: string, ctx: TurnContext): Promise<void> {
      const controller = new AbortController()
      const watchdog = setInterval(() => {
        if (ctx.aborted()) controller.abort()
      }, 50)
      const url = `${opts.baseUrl.replace(/\/+$/, '')}/chat/completions`
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}),
          },
          body: JSON.stringify({
            model: opts.model,
            stream: true,
            messages: [
              { role: 'system', content: opts.system ?? DEFAULT_SYSTEM },
              { role: 'user', content: prompt },
            ],
          }),
          signal: controller.signal,
        })

        if (!res.ok || !res.body) {
          const body = await res.text().catch(() => '')
          ctx.sink.answerDelta(`\n[请求失败] HTTP ${res.status} ${res.statusText}\n${body.slice(0, 400)}\n`)
          return
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
          for (const raw of lines) {
            const line = raw.trim()
            if (!line.startsWith('data:')) continue
            const payload = line.slice(5).trim()
            if (!payload || payload === '[DONE]') continue
            let json: any
            try {
              json = JSON.parse(payload)
            } catch {
              continue
            }
            const delta = json?.choices?.[0]?.delta ?? json?.choices?.[0]?.message ?? {}
            const reasoning = delta.reasoning_content ?? delta.reasoning
            if (typeof reasoning === 'string' && reasoning) ctx.sink.thinkingDelta(reasoning)
            if (typeof delta.content === 'string' && delta.content) ctx.sink.answerDelta(delta.content)
          }
        }
        ctx.sink.thinkingEnd()
      } catch (err) {
        if (!ctx.aborted()) {
          ctx.sink.answerDelta(`\n[流中断] ${err instanceof Error ? err.message : String(err)}\n`)
        }
      } finally {
        clearInterval(watchdog)
      }
    },
  }
}
