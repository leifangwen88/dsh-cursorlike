/**
 * dsh-vscode-mode client — file/folder drag payload shared by the explorer and
 * the composer drop bridge.
 */
export const DRAG_REF_MIME = 'application/x-dsh-cursorlike-ref'

export interface DragRefPayload {
  path: string
  isDir: boolean
}

/** Set the editor's file/folder drag payload on a native dragstart. */
export function setDragRef(event: { dataTransfer: DataTransfer | null }, payload: DragRefPayload): void {
  const data = event.dataTransfer
  if (!data) return
  data.effectAllowed = 'copy'
  data.setData(DRAG_REF_MIME, JSON.stringify(payload))
  // Plain text fallback lets other drop targets treat it as an @mention.
  data.setData('text/plain', `@${payload.path}`)
}

/** Read a drag payload without trusting malformed external drops. */
export function readDragRef(data: DataTransfer | null): DragRefPayload | null {
  if (!data) return null
  const raw = data.getData(DRAG_REF_MIME)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<DragRefPayload>
    if (typeof parsed.path !== 'string' || !parsed.path) return null
    return { path: parsed.path, isDir: parsed.isDir === true }
  } catch {
    return null
  }
}
