/**
 * dsh-vscode-mode client — 可拖动的编辑器差异 dock。
 *
 * 只是给现有 DiffBox 提供位置/尺寸外壳：默认贴近编辑区底部、宽度跟随
 * 编辑区（比原来 max-content 更宽、更矮），可按会话拖到不挡代码的位置。
 * 不改变 DiffBox 的 Keep/Undo/刷新语义。
 */
import React from 'react'

const STORAGE_PREFIX = 'edrv.diffDock.frame.v1.'

interface Offset {
  x: number
  y: number
}

function storageKey(sessionId: string): string {
  return STORAGE_PREFIX + sessionId
}

function readOffset(sessionId: string): Offset {
  if (typeof window === 'undefined') return { x: 0, y: 0 }
  try {
    const raw = window.localStorage.getItem(storageKey(sessionId))
    if (!raw) return { x: 0, y: 0 }
    const parsed = JSON.parse(raw)
    const x = Number(parsed?.x)
    const y = Number(parsed?.y)
    return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : { x: 0, y: 0 }
  } catch {
    return { x: 0, y: 0 }
  }
}

export interface DiffDockFrameProps {
  sessionId: string
  children: React.ReactNode
}

/**
 * 差异 dock 的可拖动外壳。
 * @param props sessionId 与 DiffBox 内容
 * @returns 可拖动的 dock
 */
export function DiffDockFrame(props: DiffDockFrameProps): React.ReactElement {
  const { sessionId, children } = props
  const [offset, setOffset] = React.useState<Offset>(() => readOffset(sessionId))
  const drag = React.useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null)

  React.useEffect(() => {
    setOffset(readOffset(sessionId))
  }, [sessionId])

  React.useEffect(() => {
    try {
      window.localStorage.setItem(storageKey(sessionId), JSON.stringify(offset))
    } catch {
      // localStorage 不可用时仅丢弃位置记忆。
    }
  }, [offset, sessionId])

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const target = event.target as Element | null
    if (target?.closest('button, input, textarea, select, a, [role="menu"], [contenteditable="true"]')) return
    drag.current = {
      startX: event.clientX,
      startY: event.clientY,
      baseX: offset.x,
      baseY: offset.y,
    }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    event.currentTarget.classList.add('is-dragging')
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = drag.current
    if (!current) return
    setOffset({
      x: current.baseX + (event.clientX - current.startX),
      y: current.baseY + (event.clientY - current.startY),
    })
  }

  const finishDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    drag.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    event.currentTarget.classList.remove('is-dragging')
  }

  return (
    <div
      className="edrv-side-diff-dock edrv-diff-dock-shell edrv-diff-dock-draggable"
      data-edrv-diff-dock-shell="1"
      title="拖动差异条调整位置"
      style={{ transform: `translate(calc(-50% + ${offset.x}px), ${offset.y}px)` }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
    >
      {children}
    </div>
  )
}
