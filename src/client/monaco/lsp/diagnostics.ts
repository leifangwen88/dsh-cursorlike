// @ts-nocheck
/**
 * dsh-cursorlike client — LSP diagnostics → Monaco model markers.
 * Host caches textDocument/publishDiagnostics; this module polls the active
 * model and paints error/warning/info/hint squiggles.
 */
import { fetchDiagnostics } from './lspClient.js'

const OWNER = 'edrv-lsp'

function severityOf(monaco, severity) {
  const enumValue = monaco.MarkerSeverity || {}
  if (severity === 1) return enumValue.Error ?? 8
  if (severity === 2) return enumValue.Warning ?? 4
  if (severity === 3) return enumValue.Info ?? 2
  return enumValue.Hint ?? 1
}

/**
 * Replace all markers for one model with the latest host diagnostics.
 * @param monaco Monaco namespace
 * @param model Active text model
 * @param path Workspace-relative path
 */
export async function refreshDiagnostics(monaco, model, path) {
  if (!monaco || !model || model.isDisposed?.() || !path) return
  const list = await fetchDiagnostics(path)
  if (!monaco || model.isDisposed?.()) return
  const markers = []
  for (const item of list) {
    if (!item || !item.range || !item.range.start || !item.range.end) continue
    const marker = {
      severity: severityOf(monaco, item.severity),
      message: String(item.message ?? ''),
      source: item.source,
      code: item.code,
      startLineNumber: item.range.start.line + 1,
      startColumn: item.range.start.character + 1,
      endLineNumber: item.range.end.line + 1,
      endColumn: item.range.end.character + 1,
    }
    const tags = []
    if (Array.isArray(item.tags)) {
      if (item.tags.includes(1)) tags.push(monaco.MarkerTag?.Unnecessary ?? 1)
      if (item.tags.includes(2)) tags.push(monaco.MarkerTag?.Deprecated ?? 2)
    }
    if (tags.length) marker.tags = tags
    markers.push(marker)
  }
  monaco.editor.setModelMarkers(model, OWNER, markers)
}

/** Clear all diagnostics owned by this plugin for a model. */
export function clearDiagnostics(monaco, model) {
  if (!monaco || !model || model.isDisposed?.()) return
  monaco.editor.setModelMarkers(model, OWNER, [])
}
