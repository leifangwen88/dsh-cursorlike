/**
 * dsh-vscode-mode client — 输入框文件卡的动作实现（最小可用版）。
 *
 * 语义：
 * - 官方记录：`edrv.review.review.list(path)` 重取该文件完整待审项，逐项 `edrv.review.decide(scope=file)`；
 *   Keep=accepted，Undo=rejected（host 校验证据/版本，失败会返回可读原因）。
 * - 旧工具记录：汇总为一次 `edrv.decideBatch`（Undo 按记录时间/hunk 逆序回滚）。
 * - 只调用既有 RPC，不新增 host 方法；失败不静默：逐项收集 error 交给卡片展示。
 *
 * 与 EditorView 的差异（有意保留的最小实现边界）：
 * 批量动作按文件顺序执行，不先做全量预检；某个文件失败后仍继续处理其他独立文件，
 * 因此多文件 Keep/Undo 可能部分完成。结果里如实回报 completed/failed。
 * 若后续需要「全量预检再执行」的原子语义，可改为复用 reviewBatch.ts（官方批量）+
 * 打包旧记录 items，同样不需要改 host。
 *
 * 作者 ddj 2026年10月27号
 */
import type { DecideItem } from '../../shared/rpc.js'
import type { ReviewItem } from '../../shared/review.js'
import { emitRefresh } from '../events.js'
import { rpc } from '../rpc.js'
import { legacyDecisionItems } from '../state/sessionFiles.js'
import type { SessionFileRow } from '../state/sessionFiles.js'

/** 一次文件卡动作的结果（按决策项计数，不按文件）。 */
export interface FileActionOutcome {
  /** 已完成的决策项/记录数。 */
  completed: number
  /** 失败的决策项/记录数。 */
  failed: number
  /** 失败原因（人类可读，含文件展示名）。 */
  errors: string[]
}

/** 官方 decided 重试复用：同 id/seq/revision/动作 复用同一 operationId（host 幂等）。 */
const officialOperations = new Map<string, string>()

/**
 * 空结果。
 * @author ddj 2026年10月27号
 * @returns zero 计数结果
 */
function emptyOutcome(): FileActionOutcome {
  return { completed: 0, failed: 0, errors: [] }
}

/**
 * 合并子结果。
 * @author ddj 2026年10月27号
 * @param target 目标结果
 * @param source 子结果
 */
function mergeOutcome(target: FileActionOutcome, source: FileActionOutcome): void {
  target.completed += source.completed
  target.failed += source.failed
  target.errors.push(...source.errors)
}

/**
 * 错误文本化。
 * @author ddj 2026年10月27号
 * @param error 任意异常
 * @returns 文案
 */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 官方单文件待审项（按 path 重取，不受 overview 首页 50 行截断影响）。
 * @author ddj 2026年10月27号
 * @param sessionId 会话 id
 * @param row 官方文件行
 * @returns 当前待审项
 * @throws 列表读取失败
 */
async function officialPendingItems(sessionId: string, row: SessionFileRow): Promise<ReviewItem[]> {
  const listed = await rpc('edrv.review.list', { sessionId, path: row.path })
  if (!listed.ok) throw new Error(listed.error)
  return listed.page.items.filter((item) => item.current && item.decision === 'pending')
}

/**
 * 官方单个待审项的文件级决策（operationId 幂等复用）。
 * @author ddj 2026年10月27号
 * @param sessionId 会话 id
 * @param item 待审项
 * @param reject true=Undo，false=Keep
 * @throws host 返回的失败原因
 */
async function decideOfficialItem(sessionId: string, item: ReviewItem, reject: boolean): Promise<void> {
  const key = JSON.stringify([sessionId, item.id, item.seq, item.revision, reject])
  let operationId = officialOperations.get(key)
  if (!operationId) {
    operationId = crypto.randomUUID()
    officialOperations.set(key, operationId)
  }
  const result = await rpc('edrv.review.decide', {
    sessionId,
    id: item.id,
    seq: item.seq,
    revision: item.revision,
    operationId,
    scope: 'file',
    decision: reject ? 'rejected' : 'accepted',
  })
  if (!result.ok) throw new Error(result.error)
  officialOperations.delete(key)
}

/**
 * 官方单文件决策（逐项执行；某项失败后继续处理该文件其余项并如实计数）。
 * @author ddj 2026年10月27号
 * @param sessionId 会话 id
 * @param row 官方文件行
 * @param reject true=Undo
 * @returns 子结果
 * @throws 列表读取失败（未做任何决策）
 */
async function decideOfficialRow(sessionId: string, row: SessionFileRow, reject: boolean): Promise<FileActionOutcome> {
  const outcome = emptyOutcome()
  const items = await officialPendingItems(sessionId, row)
  for (const item of items) {
    try {
      await decideOfficialItem(sessionId, item, reject)
      outcome.completed += 1
    } catch (error) {
      outcome.failed += 1
      outcome.errors.push((item.display || item.currentPath || row.display) + '：' + errorText(error))
    }
  }
  return outcome
}

/**
 * 旧记录批量决策（一次 decideBatch；callId → 文件展示名用于失败文案）。
 * @author ddj 2026年10月27号
 * @param sessionId 会话 id
 * @param rows 旧记录文件行
 * @param reject true=Undo
 * @returns 子结果
 * @throws 批量 RPC 级失败（未做任何决策）
 */
async function decideLegacyRows(sessionId: string, rows: SessionFileRow[], reject: boolean): Promise<FileActionOutcome> {
  const outcome = emptyOutcome()
  const items: DecideItem[] = []
  const labels = new Map<string, string>()
  for (const row of rows) {
    items.push(...legacyDecisionItems(row, reject))
    for (const rec of row.pendingRecords) labels.set(rec.callId, row.display)
  }
  if (!items.length) return outcome
  const result = await rpc('edrv.decideBatch', { sessionId, items })
  if (!result.ok) throw new Error(result.error)
  for (const item of result.results) {
    if (item.ok) {
      outcome.completed += 1
    } else {
      outcome.failed += 1
      outcome.errors.push((labels.get(item.callId) ?? item.callId) + '：' + (item.error ?? '决策失败'))
    }
  }
  return outcome
}

/**
 * 统一决策入口：官方行先逐项 decide，旧记录行最后合并成一次 decideBatch；
 * 无论成功/失败都会派发一次 edrv:refresh，让记录/官方审查共享订阅重新拉取。
 * @author ddj 2026年10月27号
 * @param sessionId 会话 id
 * @param rows 目标文件行
 * @param reject true=Undo（不采纳），false=Keep（采纳）
 * @returns 汇总结果
 */
async function decideRows(sessionId: string, rows: SessionFileRow[], reject: boolean): Promise<FileActionOutcome> {
  const outcome = emptyOutcome()
  if (!rows.length) return outcome
  const officialRows = rows.filter((row) => row.sourceKind === 'official')
  const legacyRows = rows.filter((row) => row.sourceKind !== 'official')
  for (const row of officialRows) {
    try {
      mergeOutcome(outcome, await decideOfficialRow(sessionId, row, reject))
    } catch (error) {
      outcome.failed += 1
      outcome.errors.push(row.display + '：' + errorText(error))
    }
  }
  if (legacyRows.length) {
    try {
      mergeOutcome(outcome, await decideLegacyRows(sessionId, legacyRows, reject))
    } catch (error) {
      outcome.failed += legacyRows.length
      const message = errorText(error)
      for (const row of legacyRows) outcome.errors.push(row.display + '：' + message)
    }
  }
  emitRefresh({ paths: rows.map((row) => row.path), kind: 'structure' })
  return outcome
}

/**
 * Keep 目标文件的全部待处理修改（头部 Keep = 全部文件；行内 ✓ = 单文件）。
 * @author ddj 2026年10月27号
 * @param sessionId 会话 id
 * @param rows 目标文件行
 * @returns 汇总结果
 */
export function keepSessionFiles(sessionId: string, rows: SessionFileRow[]): Promise<FileActionOutcome> {
  return decideRows(sessionId, rows, false)
}

/**
 * Undo 目标文件的全部待处理修改（头部 Undo = 全部文件；行内 × = 单文件）。
 * @author ddj 2026年10月27号
 * @param sessionId 会话 id
 * @param rows 目标文件行
 * @returns 汇总结果
 */
export function undoSessionFiles(sessionId: string, rows: SessionFileRow[]): Promise<FileActionOutcome> {
  return decideRows(sessionId, rows, true)
}
