/**
 * dsh-vscode-mode client — 内联编辑浮层（选中代码 → 指令 → diff → 接受/拒绝）。
 * 不绑定快捷键；由选区悬浮条的 Quick Edit 按钮打开。
 */
import React from 'react'
import { rpc } from '../rpc.js'

export interface InlineEditSelection {
  path: string
  language: string
  selection: string
  before: string
  after: string
}

export interface InlineEditOverlayProps {
  selection: InlineEditSelection
  x: number
  y: number
  onAccept: (text: string) => void
  onClose: () => void
}

function splitLines(text: string): string[] {
  return String(text ?? '').replace(/\r\n/g, '\n').split('\n')
}

/**
 * 内联编辑浮层。
 * @param props 选中范围、锚点与写回回调
 * @returns 浮层元素
 */
export function InlineEditOverlay(props: InlineEditOverlayProps): React.ReactElement {
  const { selection, x, y, onAccept, onClose } = props
  const [instruction, setInstruction] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [result, setResult] = React.useState<string | null>(null)
  const [error, setError] = React.useState('')
  const inputRef = React.useRef<HTMLTextAreaElement | null>(null)
  const overlayRef = React.useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = React.useState(() => ({
    x: Math.max(8, Math.min(x, window.innerWidth - Math.min(520, window.innerWidth - 16) - 8)),
    y: Math.max(8, Math.min(y, window.innerHeight - 200)),
  }))
  const [drag, setDrag] = React.useState<{ dx: number; dy: number } | null>(null)

  /** Keep the whole overlay inside the viewport, including after result expansion. */
  const clamp = React.useCallback((nextX: number, nextY: number) => {
    const el = overlayRef.current
    const width = el?.offsetWidth || Math.min(520, window.innerWidth - 16)
    const height = el?.offsetHeight || 320
    return {
      x: Math.max(8, Math.min(nextX, window.innerWidth - width - 8)),
      y: Math.max(8, Math.min(nextY, window.innerHeight - Math.min(height, window.innerHeight - 16) - 8)),
    }
  }, [])

  React.useEffect(() => {
    inputRef.current?.focus()
  }, [])

  React.useLayoutEffect(() => {
    const el = overlayRef.current
    if (!el) return
    const fit = () => setPos((current) => clamp(current.x, current.y))
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(el)
    window.addEventListener('resize', fit)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', fit)
    }
  }, [clamp])

  React.useEffect(() => {
    if (!drag) return
    const move = (event: PointerEvent) => setPos(clamp(event.clientX - drag.dx, event.clientY - drag.dy))
    const up = () => setDrag(null)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [drag, clamp])

  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    if (event.target instanceof Element && event.target.closest('button')) return
    const rect = overlayRef.current?.getBoundingClientRect()
    if (!rect) return
    event.preventDefault()
    setDrag({ dx: event.clientX - rect.left, dy: event.clientY - rect.top })
  }

  const generate = async () => {
    const text = instruction.trim()
    if (!text || busy) return
    setBusy(true)
    setError('')
    setResult(null)
    try {
      const response = await rpc('edrv.ai.edit', {
        path: selection.path,
        language: selection.language,
        instruction: text,
        selection: selection.selection,
        before: selection.before,
        after: selection.after,
      })
      if (!response || response.ok !== true) {
        setError((response as { note?: string } | null)?.note || '生成失败')
        return
      }
      if (!response.text) {
        setError((response as { note?: string }).note || '模型没有返回替换代码')
        return
      }
      setResult(response.text)
    } catch (failure) {
      setError(String(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      ref={overlayRef}
      className="edrv-inline-edit"
      style={{ left: pos.x, top: pos.y }}
      onMouseDown={(event) => event.stopPropagation()}
      role="dialog"
      aria-label="内联编辑"
    >
      <div className="edrv-inline-edit-head" onPointerDown={startDrag} title="拖动移动">
        <span className="edrv-inline-edit-title">Quick Edit</span>
        <span className="edrv-inline-edit-file">{selection.path.split(/[\\/]/).pop()}</span>
        <button type="button" className="edrv-inline-edit-close" aria-label="关闭" onClick={onClose}>×</button>
      </div>
      <textarea
        ref={inputRef}
        className="edrv-inline-edit-input"
        rows={3}
        placeholder="比如：改成 async/await，并处理错误"
        value={instruction}
        onChange={(event) => setInstruction(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') { event.preventDefault(); onClose() }
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void generate() }
        }}
      />
      <div className="edrv-inline-edit-actions">
        <button type="button" className="edrv-inline-edit-btn" disabled={busy || !instruction.trim()} onClick={() => { void generate() }}>
          {busy ? '生成中…' : '生成'}
        </button>
        <button type="button" className="edrv-inline-edit-btn edrv-inline-edit-cancel" onClick={onClose}>取消</button>
      </div>
      {error ? <div className="edrv-inline-edit-error" role="alert">{error}</div> : null}
      {result !== null
        ? <div className="edrv-inline-edit-preview">
            <div className="edrv-inline-edit-section">
              <div className="edrv-inline-edit-label">原代码</div>
              <pre className="edrv-inline-edit-old">{splitLines(selection.selection).join('\n')}</pre>
            </div>
            <div className="edrv-inline-edit-section">
              <div className="edrv-inline-edit-label">替换为</div>
              <pre className="edrv-inline-edit-new">{splitLines(result).join('\n')}</pre>
            </div>
            <div className="edrv-inline-edit-actions">
              <button type="button" className="edrv-inline-edit-btn edrv-inline-edit-accept" onClick={() => onAccept(result)}>
                接受替换
              </button>
              <button type="button" className="edrv-inline-edit-btn edrv-inline-edit-cancel" onClick={() => setResult(null)}>返回修改</button>
            </div>
          </div>
        : null}
    </div>
  )
}
