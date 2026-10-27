/** dsh-vscode-mode Host composition. @author ddj 2026年09月28号 */
import { registerRoutes } from './routes.js'
import { captureToolResult } from './capture.js'
import { installCapture } from './officialCapture.js'
import { installEvidence } from './reviewCapture.js'
import { closeArchiveDbs } from './archiveDb.js'
import { handleRpc } from './rpc.js'
import { newSearcher } from './search/orchestrator.js'
import { newContentSearcher } from './search/content.js'
import { cwdOf } from './registry.js'
import { setupOpenSettings, buildSettingsSchema } from './fileOpenSettings.js'
import type { SettingsDeps } from './fileOpenSettings.js'
import z from '@deepseek-ai/schemastery'
import { disposeIndex } from './treeIndex.js'
import { sweepTreeCache } from './paths.js'
import { buildReport } from './compat.js'
import { bindHostLog, log } from './log.js'
import { createLspManager } from './lsp/manager.js'
import { createLspRpc } from './lsp/rpc.js'
import { disposeAllServers, hookExitReclaim } from './lsp/transport.js'
import { createAiRpc } from './ai/rpc.js'
import { createFileVersions } from './fileVersions.js'
import { createDapRpc } from './dap/rpc.js'
import { installRulesSection } from './rules.js'
import { installSkillGroup } from './skills.js'
import type { RpcHandlerMap, RpcMethod, RpcRequestMap } from './shared/rpc.js'
import type { Registry } from './registry.js'
import type { Ctx } from './store.js'

export const name = 'dsh-cursorlike'
export const inject = ['sessions', 'fs', 'webServer', 'loader', 'tools', 'workspaceRegistry', 'agents']
/** Shared settings schema; volatile fields remain live across supported Host generations. */
export const Config = buildSettingsSchema(z as unknown as SettingsDeps['z'], { volatile: true })
type Runtime = ReturnType<typeof createRuntime>

// #region Owned services
/**
 * Create the managers shared by RPC routes, tools and lifecycle callbacks.
 * @author ddj 2026年09月28号
 * @param ctx Host context.
 * @param config Plugin configuration.
 * @returns One owned set of managers for this plugin instance.
 */
function createRuntime(ctx: Ctx, config: unknown) {
  const registry: Registry = new Map()
  const searcher = newSearcher(ctx)
  const contentSearcher = newContentSearcher(ctx)
  const settings = setupOpenSettings(ctx, config, () => {})
  const lspManager = createLspManager((line) => log.debug(line))
  const lspRpc = createLspRpc({ ctx, pluginConfig: config, manager: lspManager })
  const aiRpc = createAiRpc({ ctx, settings })
  const dapRpc = createDapRpc(ctx)
  const fileVersions = createFileVersions(ctx)
  return { registry, searcher, contentSearcher, lspManager, lspRpc, aiRpc, dapRpc, fileVersions }
}

/**
 * Own tool capture, per-session caches, and process cleanup under one Host fiber.
 * @author ddj 2026年09月28号
 * @param ctx Host context.
 * @param runtime Managers created by this instance.
 */
function attachRuntime(ctx: Ctx, runtime: Runtime): void {
  const evidence = installEvidence(ctx)
  const stopCapture = installCapture(ctx, (cwd, snapshot) => { evidence.persist(cwd, snapshot); return true })
  /** @author ddj 2026年09月28号 @param exec Tool execution. @param result Tool result. */
  function onResult(exec: unknown, result: unknown): void {
    void captureToolResult(ctx, runtime.registry, exec, result)
  }
  /** @author ddj 2026年09月28号 @param session Disposed session. */
  function onDisposed(session: { id?: unknown }): void {
    const cwd = cwdOf(session)
    if (cwd) {
      runtime.registry.delete(cwd)
      runtime.searcher.dispose(cwd)
      runtime.contentSearcher.dispose(cwd)
      disposeIndex(cwd)
    }
    if (typeof session.id === 'string') runtime.lspRpc.disposeSession(session.id)
  }
  /** @author ddj 2026年09月28号 Release every manager even if another cleanup rejects. */
  async function cleanup(): Promise<void> {
    await stopCapture()
    evidence.dispose()
    runtime.fileVersions.dispose()
    closeArchiveDbs()
    disposeAllServers()
    const tasks = [() => runtime.lspManager.disposeAll(), () => runtime.dapRpc.dispose()]
    await Promise.allSettled(tasks.map((run) => Promise.resolve().then(run)))
  }
  ctx.on('tools/result', onResult)
  ctx.on('session/disposed', onDisposed)
  ctx.effect(() => cleanup, 'vscode-mode:runtime')
  hookExitReclaim()
}

/**
 * Add user rules and bundled skills without requiring them on older Hosts.
 * @author ddj 2026年09月28号
 * @param ctx Host context.
 */
function installContent(ctx: Ctx): void {
  if (!installRulesSection(ctx)) log.warn('未检测到 systemPrompt 服务，规则仅可管理不注入')
  if (!installSkillGroup(ctx)) log.warn('技能组未调度，插件技能组不可用')
}
// #endregion

/**
 * Activate authenticated routes, scoped MCP, analysis submission and private file opens.
 * @author ddj 2026年09月28号
 * @param ctx Injected Host context.
 * @param config Validated live plugin configuration.
 * @returns Startup readiness; owned effects are released on activation failure or unload.
 */
export async function apply(ctx: Ctx, config?: unknown): Promise<void> {
  bindHostLog(ctx)
  const runtime = createRuntime(ctx, config)
  const warnings: string[] = []
  attachRuntime(ctx, runtime)
  installContent(ctx)
  /** @author ddj 2026年09月28号 @param method RPC name. @param args Typed request. @returns RPC result. */
  function dispatch<M extends RpcMethod>(method: M, args: RpcRequestMap[M]) {
    const { registry, searcher, contentSearcher, lspRpc, aiRpc, fileVersions, dapRpc } = runtime
    return handleRpc(ctx, registry, method, args, searcher, contentSearcher, lspRpc.handlers,
      aiRpc.handlers, fileVersions, dapRpc.handlers)
  }
  /** @author ddj 2026年09月28号 @param warning Startup compatibility diagnostic. */
  function noteWarning(warning: string): void { warnings.push(warning) }
  registerRoutes(ctx, config, dispatch, noteWarning)
  void sweepTreeCache()
  await logCompatSummary(ctx, warnings)
  log.info('编辑差异审查已装配（认证路由）')
}

/**
 * Log the actual compatibility report without turning a reporting failure into boot failure.
 * @author ddj 2026年09月28号
 * @param ctx Host context.
 * @param warnings Activation diagnostics.
 */
async function logCompatSummary(ctx: Ctx, warnings: string[]): Promise<void> {
  try {
    const report = await buildReport(ctx)
    report.warnings.push(...warnings)
    const dsh = report.dshVersion ? 'DSH ' + report.dshVersion : 'DSH 未探测'
    const head = '兼容性：' + dsh + ' · ' + report.external.length + ' 项外部适配 / ' + report.guards.length + ' 项护栏 / ' + (report.adapters?.length ?? 0) + ' 项版本适配'
    if (report.warnings.length) log.warn(head + '，警告 ' + report.warnings.length + ' 条：' + report.warnings.join('；'))
    else log.info(head + '，无警告')
  } catch (error) {
    log.warn('兼容性报告生成失败：' + String(error))
  }
}
