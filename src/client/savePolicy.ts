/**
 * Client save policy — Cursor/VS Code-compatible editor auto-save.
 * Default is off: edits stay dirty until the user saves. Agent edits are
 * independent and continue to write through their own file tools.
 */
export type AutoSaveMode = 'off' | 'afterDelay' | 'onFocusChange' | 'onWindowChange'

export interface SavePolicy {
  mode: AutoSaveMode
  delay: number
}

export const AUTO_SAVE_DEFAULT: SavePolicy = { mode: 'off', delay: 1000 }
const MODE_KEY = 'dsh-cursorlike.autoSave'
const DELAY_KEY = 'dsh-cursorlike.autoSaveDelay'

/** Read the persisted policy; malformed values fall back to off. */
export function getSavePolicy(): SavePolicy {
  if (typeof window === 'undefined') return { ...AUTO_SAVE_DEFAULT }
  try {
    const raw = window.localStorage.getItem(MODE_KEY)
    const mode: AutoSaveMode = raw === 'afterDelay' || raw === 'onFocusChange' || raw === 'onWindowChange'
      ? raw
      : 'off'
    const delayRaw = Number(window.localStorage.getItem(DELAY_KEY))
    const delay = Number.isFinite(delayRaw) && delayRaw >= 200 ? Math.min(delayRaw, 10000) : AUTO_SAVE_DEFAULT.delay
    return { mode, delay }
  } catch {
    return { ...AUTO_SAVE_DEFAULT }
  }
}

/** Persist a policy change for the current client. */
export function setSavePolicy(next: SavePolicy): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(MODE_KEY, next.mode)
    window.localStorage.setItem(DELAY_KEY, String(Math.max(200, Math.min(Number(next.delay) || 1000, 10000))))
    window.dispatchEvent(new CustomEvent('edrv:autosave-changed'))
  } catch {
    // Local storage may be unavailable; the in-memory editor remains usable.
  }
}
