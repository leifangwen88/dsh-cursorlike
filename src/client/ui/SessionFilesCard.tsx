/**
 * dsh-vscode-mode client — 输入框待审文件卡（Cursor 式）。
 *
 * 只渲染摘要，不渲染逐行 diff：
 * - 头部：多文件 `N Files`；单文件显示相对路径；右侧 Undo / Keep / Review。
 * - 行：文件图标 + 文件名 + `+N −M`；右侧 ×（Undo 该文件）/ ✓（Keep 该文件）。
 * - 点行：有文本差异 → 由外层调 openDiffView(path)；无差异 → openEditorView(path)。
 * - 数据由 ConversationDiffDock 从 records/review 共享订阅投影（state/sessionFiles.ts）传入。
 *
 * 相对路径：官方行自带 display（天然相对）；旧记录行可能是绝对路径，此时用一次
 * `edrv.listDir('')` 取会话工作区根只做展示剥离（既有只读 RPC，不新增 host 方法，
 * 失败静默回退原路径）。这与动作/数据无关，仅影响头部单文件文案。
 *
 * 作者 ddj 2026年10月27号
 */
import React from 'react'
import { rpc } from '../rpc.js'
import { isAbsolutePathLabel, relativeDisplayOf } from '../state/sessionFiles.js'
import type { SessionFileRow } from '../state/sessionFiles.js'
import { fileIconEl } from './icons.js'
import { keepSessionFiles, undoSessionFiles } from './SessionFileActions.js'
import '../styles/session-files.css'

const EXPANDED_KEY = 'dsh-cursorlike.sessionFiles.expanded.v1.'

/** Default collapsed; a user's explicit choice is remembered per session. */
function readExpanded(sessionId: string): boolean {
  try {
    return window.localStorage.getItem(EXPANDED_KEY + String(sessionId || '')) === '1'
  } catch {
    return false
  }
}

function writeExpanded(sessionId: string, expanded: boolean): void {
  try {
    window.localStorage.setItem(EXPANDED_KEY + String(sessionId || ''), expanded ? '1' : '0')
  } catch {
    // Local storage may be unavailable; keep the in-memory state.
  }
}

export interface SessionFilesCardProps {
  /** 会话 id（动作与工作区根探测用）。 */
  sessionId: string
  /** 待审文件行（官方在前、旧记录在后）。 */
  rows: SessionFileRow[]
  /** 点击文件行（外层决定 openDiffView / openEditorView）。 */
  onOpenFile: (row: SessionFileRow) => void
  /** Review 按钮（外层 emitShowLauncher('pending')）。 */
  onReview: () => void
}

/** 会话工作区根探测缓存（只做展示相对化；失败缓存 null，不重试刷屏）。 */
const workspaceRoots = new Map<string, Promise<string | null>>()

/**
 * 取会话工作区根（一次 `edrv.listDir('')`，按会话缓存）。
 * @author ddj 2026年10月27号
 * @param sessionId 会话 id
 * @returns 工作区根绝对路径；失败/不可用为 null
 */
function workspaceRootOf(sessionId: string): Promise<string | null> {
  const cached = workspaceRoots.get(sessionId)
  if (cached) return cached
  const probe = rpc('edrv.listDir', { sessionId, path: '' })
    .then((result) => (result.ok && result.root ? String(result.root) : null))
    .catch(() => null)
  workspaceRoots.set(sessionId, probe)
  return probe
}

/**
 * 文件卡主体。
 * @author ddj 2026年10月27号
 * @param props 文件行与回调
 * @returns 卡片元素；无待审文件时 null
 */
export function SessionFilesCard(props: SessionFilesCardProps): React.ReactElement | null {
  const { sessionId, rows, onOpenFile, onReview } = props
  const cardRef = React.useRef<HTMLDivElement | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [expanded, setExpanded] = React.useState(() => readExpanded(sessionId))
  const [notice, setNotice] = React.useState('')
  const [failed, setFailed] = React.useState(false)
  const [root, setRoot] = React.useState<string | null>(null)
  const [missing, setMissing] = React.useState<Set<string>>(() => new Set())

  React.useEffect(() => {
    setExpanded(readExpanded(sessionId))
  }, [sessionId])

  /** Persist the user's expand/collapse choice per conversation. */
  const toggleExpanded = () => {
    setExpanded((value) => {
      const next = !value
      writeExpanded(sessionId, next)
      return next
    })
  }

  // 只有旧记录且展示路径是绝对路径时才需要工作区根。
  const needsRoot = React.useMemo(
    () => rows.some((row) => row.sourceKind === 'legacy' && isAbsolutePathLabel(row.display)),
    [rows],
  )
  React.useEffect(() => {
    if (!needsRoot) return undefined
    let live = true
    void workspaceRootOf(sessionId).then((value) => {
      if (live) setRoot(value)
    })
    return () => { live = false }
  }, [sessionId, needsRoot])

  const pathKey = React.useMemo(() => rows.map((row) => row.path).join('\n'), [rows])
  React.useEffect(() => {
    if (!rows.length) {
      setMissing(new Set())
      return undefined
    }
    let live = true
    void rpc('edrv.pathsExist', { sessionId, paths: rows.map((row) => row.path) })
      .then((result) => {
        if (!live || !result.ok) return
        const next = new Set<string>()
        for (const row of rows) if (result.exists[row.path] === false) next.add(row.path)
        setMissing(next)
      })
      .catch(() => { /* 探测失败按存在处理，不阻塞卡片 */ })
    return () => { live = false }
  }, [sessionId, pathKey])

  // 待审文件集合变化后清掉上一次动作结果，避免旧提示误导。
  React.useEffect(() => {
    setNotice('')
    setFailed(false)
  }, [rows.length])

  const displayOf = React.useCallback(
    (row: SessionFileRow) => relativeDisplayOf(row.display, root),
    [root],
  )

  const run = React.useCallback(async (reject: boolean, target: SessionFileRow[]): Promise<void> => {
    if (busy || !target.length) return
    const actionable = reject ? target.filter((row) => !missing.has(row.path)) : target
    if (!actionable.length) {
      setNotice('目标文件已不存在，不能 Undo；可以 Keep 清除孤儿记录')
      return
    }
    setBusy(true)
    setNotice('')
    setFailed(false)
    try {
      const outcome = reject
        ? await undoSessionFiles(sessionId, actionable)
        : await keepSessionFiles(sessionId, actionable)
      const parts: string[] = []
      if (outcome.completed) parts.push('已' + (reject ? 'Undo' : 'Keep') + ' ' + outcome.completed + ' 处待审记录')
      if (outcome.failed) parts.push(outcome.failed + ' 处失败：' + (outcome.errors[0] ?? '未知错误'))
      setNotice(parts.join('；') || '没有可处理的待审记录')
      setFailed(outcome.failed > 0)
    } catch (error) {
      setFailed(true)
      setNotice(String(error))
    } finally {
      setBusy(false)
    }
  }, [busy, missing, sessionId])

  // The DSH input dock can sit under a transparent pointer layer; capture the
  // real geometry at document level so row/action clicks still work there.
  React.useEffect(() => {
    const card = cardRef.current
    if (!card) return undefined
    const inRect = (rect: DOMRect, event: MouseEvent): boolean =>
      event.clientX >= rect.left && event.clientX <= rect.right &&
      event.clientY >= rect.top && event.clientY <= rect.bottom
    const onClick = (event: MouseEvent) => {
      // Never let the document-level fallback compete with the chat composer:
      // an expanded card can end next to the input, and this listener must not
      // swallow a click that belongs to the composer.
      const target = event.target
      if (target instanceof Element && target.closest('[data-composer-seat], textarea, input, [contenteditable="true"], .monaco-editor')) return
      const composer = document.querySelector('[data-composer-seat]')
      if (composer && inRect(composer.getBoundingClientRect(), event)) return
      for (const button of Array.from(card.querySelectorAll<HTMLElement>('[data-session-action]'))) {
        if (!inRect(button.getBoundingClientRect(), event)) continue
        event.preventDefault()
        event.stopPropagation()
        const action = button.dataset.sessionAction
        const path = button.dataset.sessionPath
        if (action === 'toggle') {
          setExpanded((value) => !value)
          return
        }
        if (action === 'review') {
          onReview()
          return
        }
        const target = path ? rows.filter((row) => row.path === path) : rows
        if (target.length) void run(action === 'undo', target)
        return
      }
      for (const rowEl of Array.from(card.querySelectorAll<HTMLElement>('[data-session-file-path]'))) {
        if (!inRect(rowEl.getBoundingClientRect(), event)) continue
        event.preventDefault()
        event.stopPropagation()
        const row = rows.find((entry) => entry.path === rowEl.dataset.sessionFilePath)
        if (row) {
          if (missing.has(row.path)) setNotice('文件已不存在：' + displayOf(row) + '（孤儿记录，可 Keep 清除）')
          else onOpenFile(row)
        }
        return
      }
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [rows, busy, missing, displayOf, onOpenFile, onReview, run])

  if (!rows.length) return null

  const multi = rows.length > 1
  const title = multi ? rows.length + ' Files' : displayOf(rows[0])

  return (
    <div className="edrv-sfc" data-edrv-session-files="1" ref={cardRef}>
      <div
        className="edrv-sfc-head"
        data-session-action="toggle"
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        title={expanded ? '收起文件列表' : '展开文件列表'}
        onClick={() => toggleExpanded()}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            toggleExpanded()
          }
        }}
      >
        <span className="edrv-sfc-chevron" aria-hidden="true">{expanded ? '⌄' : '›'}</span>
        <span className="edrv-sfc-title" title={multi ? String(rows.length) + ' 个待审文件' : displayOf(rows[0])}>{title}</span>
        <span className="edrv-sfc-actions" onClick={(event) => event.stopPropagation()}>
          <button
            type="button"
            className="edrv-sfc-action edrv-sfc-undo"
            data-session-action="undo"
            title={multi ? 'Undo 全部待审文件（不采纳修改）' : 'Undo 待审文件（不采纳修改）'}
            disabled={busy}
            onClick={() => { void run(true, rows) }}
          >{multi ? 'Undo All' : 'Undo'}</button>
          <button
            type="button"
            className="edrv-sfc-action edrv-sfc-keep"
            data-session-action="keep"
            title={multi ? 'Keep 全部待审文件（采纳修改）' : 'Keep 待审文件（采纳修改）'}
            disabled={busy}
            onClick={() => { void run(false, rows) }}
          >{multi ? 'Keep All' : 'Keep'}</button>
          <button
            type="button"
            className="edrv-sfc-action edrv-sfc-review"
            data-session-action="review"
            title="打开差异审查（待审列表）"
            onClick={onReview}
          >Review</button>
        </span>
      </div>
      {expanded
        ? <div className="edrv-sfc-list">
        {rows.map((row) => {
          const display = displayOf(row)
          const absent = missing.has(row.path)
          return (
            <div
              key={row.path}
              className={absent ? 'edrv-sfc-row edrv-sfc-row-missing' : 'edrv-sfc-row'}
              role="button"
              tabIndex={0}
              title={absent ? display + '（文件已不存在）' : display}
              data-session-file-path={row.path}
              onClick={() => {
                if (absent) { setNotice('文件已不存在：' + display + '（孤儿记录，可 Keep 清除）'); return }
                onOpenFile(row)
              }}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  if (absent) { setNotice('文件已不存在：' + display + '（孤儿记录，可 Keep 清除）'); return }
                  onOpenFile(row)
                }
              }}
            >
              <span className="edrv-sfc-icon" aria-hidden="true">{fileIconEl(row.name)}</span>
              <span className="edrv-sfc-name">{row.name}</span>
              {absent ? <span className="edrv-sfc-missing-badge">文件已不存在</span> : null}
              <span className="edrv-sfc-stat" title={'新增 ' + row.added + ' 行 / 删除 ' + row.deleted + ' 行'}>
                <span className="edrv-sfc-add">{'+' + row.added}</span>
                <span className="edrv-sfc-del">{'−' + row.deleted}</span>
              </span>
              <span className="edrv-sfc-row-actions">
                <button
                  type="button"
                  className="edrv-sfc-icon-btn edrv-sfc-undo"
                  aria-label={'Undo ' + row.name}
                  data-session-action="undo"
                  data-session-path={row.path}
                  title={absent ? '文件已不存在，不能 Undo' : 'Undo 该文件（不采纳修改）'}
                  disabled={busy || absent}
                  onClick={(event) => { event.stopPropagation(); void run(true, [row]) }}
                >×</button>
                <button
                  type="button"
                  className="edrv-sfc-icon-btn edrv-sfc-keep"
                  aria-label={'Keep ' + row.name}
                  data-session-action="keep"
                  data-session-path={row.path}
                  title="Keep 该文件（采纳修改）"
                  disabled={busy}
                  onClick={(event) => { event.stopPropagation(); void run(false, [row]) }}
                >✓</button>
              </span>
            </div>
          )
        })}
      </div> : null}
      {busy || notice
        ? <div className={failed ? 'edrv-sfc-notice edrv-sfc-error' : 'edrv-sfc-notice'} role={failed ? 'alert' : 'status'}>{busy ? '正在处理…' : notice}</div>
        : null}
    </div>
  )
}
