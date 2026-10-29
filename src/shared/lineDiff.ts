/**
 * Shared line diff for cumulative official review.
 *
 * DSH 官方的 `ReviewSnapshot` 是按轮次保存的，每轮只带相对上一轮的 patch。
 * 编辑器需要的是「本会话最早未处理基线 → 最新未处理结果」的累计差异，因此这里提供
 * 一个纯函数行级 Myers diff：输入完整 before/after 文本，输出与官方 `ReviewHunk`
 * 同构的 unified hunk（带 3 行上下文），让 `reviewRegions` 可以直接复用。
 *
 * 不依赖 node/浏览器 API，host 与单测共用。
 */
import type { ReviewHunk } from './review.js'

type OpKind = 'equal' | 'delete' | 'insert'
interface Op { kind: OpKind; line: string }

/** 超过该行数不计算累计 diff（回退到单轮展示，避免阻塞 host）。 */
const MAX_LINES = 20000
/** Myers 的编辑距离上限：超出则回退，防止重写整个大文件时内存爆炸。 */
const MAX_D = 1200

/**
 * 文本 → 逻辑行（去掉 BOM、统一换行、去掉末尾换行产生的空行）。
 * @author ddj 2026年10月29号
 * @param text 原始文本
 * @returns 行数组
 */
export function diffTextLines(text: string): string[] {
  if (text === '') return []
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = normalized.split('\n')
  if (lines.length && lines[lines.length - 1] === '') lines.pop()
  return lines
}

/**
 * Myers diff：返回按顺序排列的 equal/delete/insert 操作。
 * @author ddj 2026年10月29号
 * @param before 旧行
 * @param after 新行
 * @returns 操作序列；编辑距离超限返回 null
 */
function diffOps(before: string[], after: string[]): Op[] | null {
  const n = before.length
  const m = after.length
  if (n === 0 && m === 0) return []
  if (n === 0) return after.map((line) => ({ kind: 'insert' as const, line }))
  if (m === 0) return before.map((line) => ({ kind: 'delete' as const, line }))
  const max = Math.min(n + m, MAX_D)
  // k -> x；用 -Infinity 表示尚未到达的对角线。
  const v = new Map<number, number>()
  v.set(1, 0)
  const trace: Map<number, number>[] = []
  for (let d = 0; d <= max; d++) {
    trace.push(new Map(v))
    for (let k = -d; k <= d; k += 2) {
      let x: number
      const left = v.get(k - 1)
      const right = v.get(k + 1)
      if (k === -d || (k !== d && (left ?? -Infinity) < (right ?? -Infinity))) x = right ?? 0
      else x = (left ?? 0) + 1
      let y = x - k
      while (x < n && y < m && before[x] === after[y]) { x++; y++ }
      v.set(k, x)
      if (x >= n && y >= m) return backtrack(trace, before, after, d)
    }
  }
  return null
}

/**
 * 从 trace 反向还原操作序列。
 * @author ddj 2026年10月29号
 * @param trace 每轮编辑距离的 k→x 快照
 * @param before 旧行
 * @param after 新行
 * @param finalD 最终编辑距离
 * @returns 正向操作序列
 */
function backtrack(trace: Map<number, number>[], before: string[], after: string[], finalD: number): Op[] {
  const ops: Op[] = []
  let x = before.length
  let y = after.length
  for (let d = finalD; d >= 0; d--) {
    const v = trace[d]
    const k = x - y
    const left = v.get(k - 1)
    const right = v.get(k + 1)
    const prevK = k === -d || (k !== d && (left ?? -Infinity) < (right ?? -Infinity)) ? k + 1 : k - 1
    const prevX = v.get(prevK) ?? 0
    const prevY = prevX - prevK
    while (x > prevX && y > prevY) {
      ops.push({ kind: 'equal', line: before[--x] })
      y--
    }
    if (d === 0) break
    if (x === prevX) ops.push({ kind: 'insert', line: after[--y] })
    else ops.push({ kind: 'delete', line: before[--x] })
    x = prevX
    y = prevY
  }
  return ops.reverse()
}

/**
 * 把完整 before/after 文本转成 unified hunks（3 行上下文）。
 * 无变化返回空数组；文件过大或编辑距离过大返回 null，由调用方回退。
 * @author ddj 2026年10月29号
 * @param before 基线文本
 * @param after 目标文本
 * @param context 上下文行数
 * @returns ReviewHunk 数组或 null
 */
export function diffTextHunks(before: string, after: string, context = 3): ReviewHunk[] | null {
  const a = diffTextLines(before)
  const b = diffTextLines(after)
  if (a.length > MAX_LINES || b.length > MAX_LINES) return null
  if (before === after) return []
  const ops = diffOps(a, b)
  if (!ops) return null
  const changes: number[] = []
  for (let index = 0; index < ops.length; index++) if (ops[index].kind !== 'equal') changes.push(index)
  if (!changes.length) return []

  const oldPrefix = new Array<number>(ops.length + 1).fill(0)
  const newPrefix = new Array<number>(ops.length + 1).fill(0)
  for (let index = 0; index < ops.length; index++) {
    oldPrefix[index + 1] = oldPrefix[index] + (ops[index].kind === 'insert' ? 0 : 1)
    newPrefix[index + 1] = newPrefix[index] + (ops[index].kind === 'delete' ? 0 : 1)
  }

  const hunks: ReviewHunk[] = []
  let groupStart = changes[0]
  let groupEnd = changes[0]
  const flush = (): void => {
    const from = Math.max(0, groupStart - context)
    const to = Math.min(ops.length - 1, groupEnd + context)
    const lines: string[] = []
    for (let index = from; index <= to; index++) {
      const op = ops[index]
      lines.push((op.kind === 'equal' ? ' ' : op.kind === 'delete' ? '-' : '+') + op.line)
    }
    hunks.push({
      oldStart: oldPrefix[from] + 1,
      oldLines: oldPrefix[to + 1] - oldPrefix[from],
      newStart: newPrefix[from] + 1,
      newLines: newPrefix[to + 1] - newPrefix[from],
      lines,
    })
  }
  for (let index = 1; index < changes.length; index++) {
    if (changes[index] - groupEnd <= context * 2) groupEnd = changes[index]
    else { flush(); groupStart = changes[index]; groupEnd = changes[index] }
  }
  flush()
  return hunks
}
