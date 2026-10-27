/**
 * dsh-vscode-mode client — 会话待审文件投影（输入框文件卡数据源）。
 * 只读聚合：官方 page.overview/page.items + 旧工具记录 hunks，可单测、不发 RPC。
 * 官方行 +N/−M 取自已下发页的 items（分页截断时按已知项求和，动作前再按 path 重取）；
 * 旧记录行 +N/−M 直接由待处理 hunk 的 old/new 行数计算。
 * 作者 ddj 2026年10月27号
 */
import type { DecideItem } from '../../shared/rpc.js'
import type { ReviewItem, ReviewPage } from '../../shared/review.js'
import type { RecordView } from '../../shared/types.js'
import { diffPathKey, diffSummary } from './diffSummary.js'
import type { DiffFile } from './diffSummary.js'
import { isRecPending, noopHunk, statusAt } from './records.js'

/** 文件卡一行：待审文件的最小展示与动作载荷。 */
export interface SessionFileRow {
  /** 功能路径（打开 diff/编辑区、官方按 path 重取 items 的稳定口径）。 */
  path: string
  /** 展示路径（官方 display / 旧记录 displayPath 或原始 path；相对化由视图层完成）。 */
  display: string
  /** 行内展示的文件名。 */
  name: string
  /** 待处理差异的新增行数（官方 items 求和 / 旧记录 hunk 行数求和）。 */
  added: number
  /** 待处理差异的删除行数。 */
  deleted: number
  /** 待处理处数（官方 = 待审记录数；旧记录 = 非空待处理 hunk 数）。 */
  pending: number
  sourceKind: 'official' | 'legacy'
  /** 是否存在可打开的文本差异（官方二进制/超大文件、旧记录空差异为 false → 打开编辑区而不是 diff）。 */
  diffable: boolean
  /** 官方当前页命中该文件的待审项（可能被分页截断；动作前会按 path 重取完整列表）。 */
  items: ReviewItem[]
  /** 该文件的待处理旧记录（仅 legacy 行非空）。 */
  pendingRecords: RecordView[]
}

/** 会话待审文件投影。 */
export interface SessionFilesSnapshot {
  rows: SessionFileRow[]
  total: number
}

/**
 * 文本行数（去掉一个结尾换行；空串 0 行）。
 * @author ddj 2026年10月27号
 * @param text 原始文本
 * @returns 行数
 */
function lineCountOf(text: string | null | undefined): number {
  if (typeof text !== 'string' || text === '') return 0
  const normalized = text.replace(/\r\n/g, '\n')
  const trimmed = normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized
  return trimmed === '' ? 0 : trimmed.split('\n').length
}

/**
 * 文件名（含扩展名；兼容 / 与 \ 分隔）。
 * @author ddj 2026年10月27号
 * @param path 路径
 * @returns 文件名，空路径为空串
 */
export function fileBaseName(path: string): string {
  return String(path ?? '').split(/[\\/]/).pop() ?? ''
}

/**
 * 路径是否以绝对形态出现（Windows 盘符或 POSIX 根）。
 * @author ddj 2026年10月27号
 * @param label 展示路径
 * @returns 是否绝对路径
 */
export function isAbsolutePathLabel(label: string): boolean {
  const text = String(label ?? '')
  return /^[a-z]:[\\/]/i.test(text) || text.startsWith('/')
}

/**
 * 把展示路径相对化：已知工作区根时剥离根前缀；否则仅统一分隔符。
 * @author ddj 2026年10月27号
 * @param label 展示路径
 * @param root 会话工作区根（可空）
 * @returns 相对展示路径
 */
export function relativeDisplayOf(label: string, root: string | null): string {
  const normalized = String(label ?? '').replace(/\\/g, '/')
  if (!root) return normalized
  const base = String(root).replace(/\\/g, '/').replace(/\/+$/, '')
  if (!base) return normalized
  if (normalized.toLowerCase() === base.toLowerCase()) return fileBaseName(normalized)
  if (normalized.toLowerCase().startsWith((base + '/').toLowerCase())) return normalized.slice(base.length + 1)
  return normalized
}

/**
 * 官方页内命中某文件的待审项。
 * 官方 overview.path 是 identity（绝对），items 同时带 currentPath/path/display，按任一形态匹配。
 * @author ddj 2026年10月27号
 * @param file 官方文件摘要
 * @param page 官方页（可空）
 * @returns 待审项数组（可能为空/被分页截断）
 */
function officialItemsOf(file: DiffFile, page: ReviewPage | null): ReviewItem[] {
  const items = page?.items ?? []
  const pathKey = diffPathKey(file.path)
  const labelKey = diffPathKey(file.label)
  return items.filter((item) => {
    if (!item.current || item.decision !== 'pending') return false
    return diffPathKey(item.currentPath) === pathKey
      || diffPathKey(item.path) === pathKey
      || diffPathKey(item.path) === labelKey
      || diffPathKey(item.display) === labelKey
  })
}

/**
 * 旧记录待处理差异的新增/删除行数（只统计仍 pending 且非空差异的 hunk）。
 * @author ddj 2026年10月27号
 * @param records 待处理旧记录
 * @returns 增删行数
 */
function legacyLineCounts(records: RecordView[]): { added: number; deleted: number } {
  let added = 0
  let deleted = 0
  for (const rec of records) {
    const hunks = Array.isArray(rec.hunks) ? rec.hunks : []
    if (!hunks.length) {
      // 旧记录可能只有 callHunk（无 hunks 数组）：与 EditorView preciseHunk 的回退口径一致。
      const call = rec.callHunk
      if (call && statusAt(rec, 0) === 'pending' && !noopHunk(rec, call)) {
        added += lineCountOf(call.newText)
        deleted += lineCountOf(call.oldText)
      }
      continue
    }
    for (let index = 0; index < hunks.length; index++) {
      if (statusAt(rec, index) !== 'pending' || noopHunk(rec, hunks[index])) continue
      added += lineCountOf(hunks[index].newText)
      deleted += lineCountOf(hunks[index].oldText)
    }
  }
  return { added, deleted }
}

/**
 * 旧记录是否存在可打开文本差异（payload 缺失的旧记录 pending 但没有 hunk → 无差异可定位）。
 * @author ddj 2026年10月27号
 * @param records 待处理旧记录
 * @returns 是否可打开 diff
 */
function legacyDiffable(records: RecordView[]): boolean {
  return records.some((rec) => {
    const hunks = Array.isArray(rec.hunks) ? rec.hunks : []
    if (!hunks.length) {
      // 无 hunks 且无 callHunk 的旧记录没有可定位文本 → 点行打开编辑区而不是 diff。
      const call = rec.callHunk
      return !!call && call.oldText !== null && call.oldText !== call.newText
    }
    for (let index = 0; index < hunks.length; index++) {
      if (statusAt(rec, index) === 'pending' && !noopHunk(rec, hunks[index])) return true
    }
    return false
  })
}

/**
 * 单个文件行投影。
 * @author ddj 2026年10月27号
 * @param file diffSummary 文件摘要
 * @param page 官方页（可空）
 * @returns 文件行
 */
function rowOf(file: DiffFile, page: ReviewPage | null): SessionFileRow {
  const display = String(file.label || file.path)
  const name = fileBaseName(display) || fileBaseName(file.path)
  if (file.sourceKind === 'official') {
    const items = officialItemsOf(file, page)
    let added = 0
    let deleted = 0
    for (const item of items) {
      added += item.added
      deleted += item.deleted
    }
    return {
      path: file.path,
      display,
      name,
      added,
      deleted,
      pending: file.pending,
      sourceKind: 'official',
      // 无 items 元数据（分页截断）时乐观按文本差异处理：点击打开 diff 仍安全。
      diffable: items.length ? items.some((item) => item.kind === 'text') : true,
      items,
      pendingRecords: [],
    }
  }
  const pendingRecords = file.recs.filter((rec) => isRecPending(rec))
  const counts = legacyLineCounts(pendingRecords)
  return {
    path: file.path,
    display,
    name,
    added: counts.added,
    deleted: counts.deleted,
    pending: file.pending,
    sourceKind: 'legacy',
    diffable: legacyDiffable(pendingRecords),
    items: [],
    pendingRecords,
  }
}

/**
 * 会话待审文件投影入口（官方在前、旧记录按 path 排序，与 diffSummary 顺序一致）。
 * @author ddj 2026年10月27号
 * @param records 差异记录（共享订阅）
 * @param page 官方审查页（共享订阅）
 * @returns 待审文件投影
 */
export function sessionFilesOf(records: RecordView[], page: ReviewPage | null): SessionFilesSnapshot {
  const summary = diffSummary(records, page)
  const rows = summary.pendingFiles.map((file) => rowOf(file, page))
  return { rows, total: rows.length }
}

/**
 * 旧记录批决策项（Keep 正序、Undo 逆序：后发生的修改先回滚）。
 * create 记录/无 hunk 的旧记录按 call 作用域整条决策，与 EditorView itemOf 语义一致。
 * @author ddj 2026年10月27号
 * @param row 旧记录文件行
 * @param reject true=Undo（不采纳），false=Keep（采纳）
 * @returns edrv.decideBatch items
 */
export function legacyDecisionItems(row: SessionFileRow, reject: boolean): DecideItem[] {
  const decision = reject ? 'rejected' : 'accepted'
  const records = [...row.pendingRecords].sort((left, right) => (
    reject ? right.at.localeCompare(left.at) : left.at.localeCompare(right.at)
  ))
  const items: DecideItem[] = []
  for (const rec of records) {
    if (!isRecPending(rec)) continue
    const hunks = Array.isArray(rec.hunks) ? rec.hunks : []
    if (rec.create === true || !hunks.length) {
      items.push({ callId: rec.callId, scope: 'call', decision })
      continue
    }
    const indexes: number[] = []
    for (let index = 0; index < hunks.length; index++) {
      if (statusAt(rec, index) === 'pending' && !noopHunk(rec, hunks[index])) indexes.push(index)
    }
    if (reject) indexes.reverse()
    for (const index of indexes) items.push({ callId: rec.callId, scope: 'hunk', hunkIndex: index, decision })
  }
  return items
}
