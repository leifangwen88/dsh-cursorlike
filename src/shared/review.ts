/** Official facts are immutable; review decisions never imply a disk version. @author ddj 2026年10月26号 */
export interface ChangedFile {
  path: string
  display: string
  added: number
  deleted: number
  binary?: true
  oversized?: true
}
export interface ReviewHunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: string[]
}
export type OfficialDiff = { kind: 'text'; path: string; display: string; before: boolean; after: boolean; hunks: ReviewHunk[]; coarse: boolean }
  | { kind: 'binary' | 'oversized'; path: string; display: string }
export interface OfficialSummary {
  turn: number
  cwd: string
  files: ChangedFile[]
  total: number
  added: number
  deleted: number
  snapshot?: { before: string; after: string }
}
export interface ReviewSnapshot {
  sourceKind: 'official'
  sessionId: string
  turn: number
  seq: number
  capturedAt: string
  summary: OfficialSummary
  files: { identity: string; diff: OfficialDiff }[]
}
export type ReviewDecision = 'pending' | 'accepted' | 'rejected'
export type ReviewFileDecision = ReviewDecision | 'mixed'
export interface ReviewItem {
  id: string
  sessionId: string
  turn: number
  seq: number
  path: string
  currentPath: string
  display: string
  added: number
  deleted: number
  kind: OfficialDiff['kind']
  decision: ReviewFileDecision
  revision: number
  current: boolean
}
export interface ReviewDetail {
  item: ReviewItem
  diff: OfficialDiff
  capturedAt: string
  blocks: import('./reviewRegions.js').ReviewBlockState[]
  capability: { keep: boolean; undo: boolean; reason: string }
}
export interface CaptureGap {
  sessionId: string
  turn: number
  seq: number
  error: string
}
export interface ReviewFile {
  sourceKind: 'official'
  path: string
  label: string
  pending: number
  /** 该文件所有待审轮次的累计新增行数（不依赖第一页 items）。 */
  added?: number
  /** 该文件所有待审轮次的累计删除行数（不依赖第一页 items）。 */
  deleted?: number
}
export interface ReviewOverview {
  files: ReviewFile[]
  /** Every official identity, including decided files: never revive legacy actions for them. */
  coveredPaths: string[]
}
export interface ReviewPage {
  overview?: ReviewOverview
  items: ReviewItem[]
  pending: number
  nextCursor: number | null
  gaps: CaptureGap[]
}
/** 同一会话、同一文件的累计待审差异（最早未处理基线 → 最新未处理结果）。 */
export interface CumulativeReview {
  /** 后端文件身份（absolute/identity，与 review.list 的 path 一致）。 */
  path: string
  /** 展示路径（取最新轮次）。 */
  display: string
  /** 合并后的完整文本差异；没有可用证据时返回 null，客户端回退到单轮展示。 */
  diff: OfficialDiff
  /** 参与合并的待审记录，按时间正序（Undo 时客户端需要逆序执行）。 */
  items: ReviewItem[]
}
export interface ReviewRequest { sessionId: string }
export interface DecideReview extends ReviewRequest {
  id: string
  seq: number
  revision: number
  operationId: string
  scope?: 'file' | 'hunk'
  blockId?: string
  decision: 'accepted' | 'rejected'
}
export type ReviewResult<T> = ({ ok: true } & T) | { ok: false; error: string }
