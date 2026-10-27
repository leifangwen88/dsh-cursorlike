/**
 * dsh-vscode-mode host — AI 内联编辑（选中代码 → 指令 → 替换文本）。
 * 与 inline 补全共用 llm/route/settings；输出整段替换，不做 3 行早停。
 */
import { log } from '../log.js'
import type { LlmRuntimeLike, StreamChunk } from './llmTypes.js'
import type { AiEditRequest, AiEditResult } from '../shared/ai.js'
import { AI_EDIT_MAX_TOKENS, AI_EDIT_SYSTEM, AI_EDIT_TIMEOUT_MS, buildEditPrompt, cleanEditText } from '../shared/ai.js'
import { llmOf, taskRouteOf, type AiInlineDeps } from './inline.js'

/**
 * 单次内联编辑。
 * @param deps llm/config 依赖
 * @param req 编辑请求
 * @returns 替换文本或可读错误
 */
export async function aiEditComplete(deps: AiInlineDeps, req: AiEditRequest): Promise<AiEditResult> {
  const cfg = deps.config.get()
  if (!cfg.enabled) return { text: '', note: 'AI 功能未启用' }
  if (!req || typeof req.instruction !== 'string' || !req.instruction.trim()) {
    return { text: '', note: '请输入修改指令' }
  }
  if (typeof req.selection !== 'string' || !req.selection) {
    return { text: '', note: '请先选中代码' }
  }
  const llm = llmOf(deps.ctx)
  if (!llm) return { text: '', note: 'llm 服务不可用' }
  const route = await taskRouteOf(llm, cfg)
  if (!route) return { text: '', note: '未找到可用模型（请检查 DSH 模型配置）' }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('timeout')), AI_EDIT_TIMEOUT_MS)
  try {
    const stream = llm.stream({
      provider: route.provider,
      model: route.model,
      ...(route.effort ? { reasoningEffort: route.effort } : {}),
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: buildEditPrompt(req) }],
          source: { kind: 'user' },
        } as never,
      ],
      system: AI_EDIT_SYSTEM,
      temperature: 0.2,
      maxTokens: AI_EDIT_MAX_TOKENS,
      signal: controller.signal,
    })

    let text = ''
    let failNote = ''
    for await (const chunk of stream) {
      const c = chunk as StreamChunk
      if (c.type === 'text-delta') {
        text += c.text
      } else if (c.type === 'finish') {
        const kind = (c.reason as { kind?: string })?.kind
        if (kind === 'error' || kind === 'aborted') {
          const failure = (c.reason as { failure?: { code?: string; message?: string } }).failure
          failNote = (failure?.code ?? kind) + ': ' + (failure?.message ?? '模型调用失败')
        }
        break
      }
    }
    if (failNote) return { text: '', note: 'AI 编辑失败：' + failNote }
    const clean = cleanEditText(text)
    if (!clean) return { text: '', note: '模型没有返回可用的替换代码' }
    return { text: clean }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log.debug('[ai-edit] 失败：' + message)
    return { text: '', note: 'AI 编辑失败：' + message }
  } finally {
    clearTimeout(timer)
  }
}
