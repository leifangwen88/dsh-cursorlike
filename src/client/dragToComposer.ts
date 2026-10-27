/**
 * dsh-vscode-mode client — drag a file/folder from the editor into the chat
 * composer, Cursor-style.
 *
 * Drop handling is delegated to the existing AddToConversation facade
 * (`appendReference`), so the result is a normal @file/@folder chip, not a
 * plain-text hack. Only our own MIME is accepted; OS file drops are untouched.
 */
import type { AddToConversation } from './addToConversation.js'
import { readDragRef, DRAG_REF_MIME } from './dragRef.js'

const DROP_CLASS = 'edrv-composer-drop-target'

function hasDragRef(data: DataTransfer | null): boolean {
  return Boolean(data && Array.from(data.types).includes(DRAG_REF_MIME))
}

function composerSeatOf(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>('[data-composer-seat]') : null
}

function sessionOf(seat: HTMLElement): string | undefined {
  return seat.closest('[data-conversation-session]')?.getAttribute('data-conversation-session') || undefined
}

/**
 * Install the composer drop bridge. Returns a disposer.
 * @param addToConversation existing editor -> composer reference facade
 */
export function installDragToComposer(addToConversation: AddToConversation): () => void {
  const clear = () => {
    for (const node of Array.from(document.querySelectorAll(`.${DROP_CLASS}`))) node.classList.remove(DROP_CLASS)
  }

  const onDragOver = (event: DragEvent) => {
    if (!hasDragRef(event.dataTransfer)) return
    const seat = composerSeatOf(event.target)
    if (!seat) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    for (const node of Array.from(document.querySelectorAll(`.${DROP_CLASS}`))) node.classList.remove(DROP_CLASS)
    seat.classList.add(DROP_CLASS)
  }

  const onDragLeave = (event: DragEvent) => {
    const seat = composerSeatOf(event.target)
    if (seat && !seat.contains(event.relatedTarget as Node | null)) seat.classList.remove(DROP_CLASS)
  }

  const onDrop = (event: DragEvent) => {
    const seat = composerSeatOf(event.target)
    if (!seat) return
    const payload = readDragRef(event.dataTransfer)
    if (!payload) return
    event.preventDefault()
    event.stopPropagation()
    clear()
    const sessionId = sessionOf(seat)
    if (!sessionId) return
    void addToConversation
      .appendReference(sessionId, payload.path, undefined, payload.isDir ? 'folder' : 'file')
      .catch(() => undefined)
  }

  document.addEventListener('dragover', onDragOver, true)
  document.addEventListener('dragleave', onDragLeave, true)
  document.addEventListener('drop', onDrop, true)
  return () => {
    clear()
    document.removeEventListener('dragover', onDragOver, true)
    document.removeEventListener('dragleave', onDragLeave, true)
    document.removeEventListener('drop', onDrop, true)
  }
}
