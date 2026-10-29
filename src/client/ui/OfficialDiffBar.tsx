import React from 'react'
import { Button, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CumulativeReview, ReviewDetail, ReviewItem, ReviewPage } from '../../shared/review.js'

export interface OfficialBarProps {
  official: { sessionId: string; path: string; pending: number; detail?: ReviewDetail; cumulative?: CumulativeReview | null; records?: ReviewItem[]; page: ReviewPage; onSelect: (id: string) => void }
  activePath: string
  pendingRegions?: unknown[]
  staleRegions?: unknown[]
  diffIdx?: number
  fileTotal?: number
  fileIdx?: number
  allPendingCount?: number
  reviewBatchBusy?: boolean
  batchUnavailable?: string
  onAcceptAllFiles?: () => void
  onUndoAllFiles?: () => void
  onPrevFile: () => void
  onNextFile: () => void
  onPrevDiff: () => void
  onNextDiff: () => void
  onAcceptFile: () => void
  onUndoFile: () => void
  reviewError?: string
}

type Mark = 'left' | 'right' | 'up' | 'down' | 'check' | 'undo' | 'more' | 'file'
const marks: Record<Mark, string> = {
  left: 'm10 4-5 4 5 4', right: 'm6 4 5 4-5 4', up: 'm4 10 4-5 4 5', down: 'm4 6 4 5 4-5',
  check: 'm3 8 3 3 7-7', undo: 'M5 3 2 6l3 3M2 6h7a4 4 0 0 1 0 8',
  more: 'M3 8h.01M8 8h.01M13 8h.01', file: 'M9 2H4v12h8V5L9 2Zm0 0v4h3M6 9h4M6 11h3',
}

/** @private @author ddj 2026年10月27号 @param mark Toolbar action. @returns Decorative consistent-stroke icon; labels live on buttons. */
function barIcon(mark: Mark): React.ReactElement {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={marks[mark]} /></svg>
}

/** @private @author ddj 2026年10月27号 @param props Global workspace counts and bulk handlers. @returns Persistent global review controls, distinct from current-file actions. */
function ReviewAllRow(props: OfficialBarProps): React.ReactElement {
  const total = props.fileTotal ?? 0
  const current = total && (props.fileIdx ?? -1) >= 0 ? (props.fileIdx ?? 0) + 1 : 0
  const disabled = props.reviewBatchBusy || !!props.batchUnavailable || !props.allPendingCount
  return <div className="edrv-review-global" role="group" aria-label="全部待审文件">
    <span className="edrv-review-total" title="当前工作区待审差异文件数">差异文件 <strong>{current} / {total}</strong></span>
    <span className="edrv-review-all-actions">
      <Button size="sm" variant="ghost" onClick={props.onAcceptAllFiles} disabled={disabled || !props.onAcceptAllFiles} title={props.batchUnavailable || 'Keep 当前工作区全部待审文件（含其他轮次），不改写磁盘'}>Keep All</Button>
      <Button size="sm" variant="ghost" className="edrv-review-undo" onClick={props.onUndoAllFiles} disabled={disabled || !props.onUndoAllFiles} title={props.batchUnavailable || '检查全部待审记录后逐项 Undo；缺少证据或遇到冲突停止，不强制覆盖'}>Undo All</Button>
    </span>
  </div>
}

/** @public @author ddj 2026年10月27号 @param props Existing review callbacks and immutable record metadata. @returns Responsive review toolbar; no disk or decision side effects until an explicit action. */
export function OfficialDiffBar(props: OfficialBarProps): React.ReactElement {
  const { official, pendingRegions = [], staleRegions = [], diffIdx = 0 } = props
  const [menu, setMenu] = React.useState<'records' | null>(null)
  const name = String(props.activePath || '').split(/[\\/]/).pop() || '当前文件'
  const detail = official.detail
  const cumulative = official.cumulative
  const cumulativeItems = cumulative?.items?.length ?? 0
  const records = official.records ?? []
  const count = pendingRegions.length
  const position = count ? `${Math.min(diffIdx + 1, count)} / ${count}` : '—'

  /** @private @author ddj 2026年10月27号 @returns Close current popup without changing selection. */
  function closeMenu(): void { setMenu(null) }
  /** @private @author ddj 2026年10月27号 @param id Immutable record ID. @returns Select record and dismiss popup. */
  function selectRecord(id: string): void { official.onSelect(id); closeMenu() }
  /** @private @author ddj 2026年10月27号 @param mark Navigation icon. @param label Accessible action. @param action Existing callback. @param disabled Whether navigation is unavailable. @returns Compact keyboard-focusable navigation control. */
  function navButton(mark: Mark, label: string, action: () => void, disabled: boolean): React.ReactElement {
    return <Button size="sm" variant="ghost" className="edrv-review-icon" aria-label={label} title={label} disabled={disabled} onClick={action}>{barIcon(mark)}</Button>
  }

  const recordTrigger = cumulative
    ? <span className="edrv-review-record edrv-review-cumulative" title={`已合并 ${cumulativeItems} 轮待审修改`}>累计 {cumulativeItems} 轮</span>
    : <Button size="sm" variant="ghost" className="edrv-review-record" aria-label="选择官方差异记录" aria-haspopup="menu" aria-expanded={menu === 'records'} disabled={!records.length} onClick={() => setMenu(menu === 'records' ? null : 'records')}>
      {detail ? `轮次 ${detail.item.turn}` : '选择记录'}{barIcon('down')}
    </Button>
  const undoDisabled = props.reviewBatchBusy || (cumulative ? cumulativeItems === 0 : !detail?.capability.undo)
  const keepDisabled = props.reviewBatchBusy || (cumulative ? cumulativeItems === 0 : !detail?.capability.keep)
  const undoTitle = cumulative ? '回滚该文件在当前对话中的全部待审修改（按轮次逆序）' : detail?.capability.reason
  const keepTitle = cumulative ? '保留该文件在当前对话中的全部未处理修改' : '保留当前记录的未处理修改'

  return <div className="edrv-diffbar edrv-diffbar-dock edrv-reviewbar" data-edrv-diffbox="1" data-edrv-diff-source="official" role="region" aria-label="文件差异审查">
    <ReviewAllRow {...props} />
    {props.reviewBatchBusy ? <div className="edrv-review-notice" role="status">正在处理全部待审记录…</div> : null}
    <div className="edrv-review-heading">
      <span className="edrv-review-filemark">{barIcon('file')}</span>
      <span className="edrv-review-filename" title={props.activePath}>{name}</span>
      <span className="edrv-review-pending" title={cumulative ? `${cumulativeItems} 轮官方待审修改` : `${official.pending} 条官方待审记录`}>待审 <strong>{official.pending}</strong></span>
      {cumulative ? recordTrigger : <>
        {recordTrigger}
        <Menu open={menu === 'records'} anchor={recordTrigger} items={records.map((item) => ({ id: item.id, label: `轮次 ${item.turn} / 事件 ${item.seq}` }))} selectedId={detail?.item.id} onSelect={selectRecord} onClose={closeMenu} side="top" align="end" portal compact autoFocus />
      </>}
    </div>
    <div className="edrv-review-tools">
      <div className="edrv-review-nav" role="group" aria-label="文件导航">
        {navButton('left', '上一个差异文件', props.onPrevFile, !props.fileTotal)}
        {navButton('right', '下一个差异文件', props.onNextFile, !props.fileTotal)}
      </div>
      <div className="edrv-review-nav edrv-review-blocknav" role="group" aria-label="差异导航">
        {navButton('up', '上一个差异', props.onPrevDiff, !count)}
        <span className="edrv-review-position" aria-live="polite">{position}</span>
        {navButton('down', '下一个差异', props.onNextDiff, !count)}
      </div>
      <div className="edrv-review-actions">
        <Button size="sm" variant="ghost" className="edrv-review-undo" icon={barIcon('undo')} onClick={props.onUndoFile} disabled={undoDisabled} title={undoTitle}>Undo</Button>
        <Button size="sm" variant="primary" className="edrv-review-keep" icon={barIcon('check')} onClick={props.onAcceptFile} disabled={keepDisabled} title={keepTitle}>Keep</Button>
      </div>
    </div>
    {(detail || cumulative) && staleRegions.length > 0 ? <div className="edrv-review-notice" role="status">{staleRegions.length} 处差异无法定位（文件已被后续修改）</div> : null}
    {cumulative && (cumulative.diff.kind !== 'text' || cumulative.diff.coarse)
      ? <div className="edrv-review-notice" role="status">该文件差异过大或缺少原始基线：仅提供文件级 Keep / Undo，不显示逐行标记</div> : null}
    {props.reviewError ? <div className="edrv-review-notice edrv-review-error" role="alert">{props.reviewError}</div> : null}
  </div>
}
