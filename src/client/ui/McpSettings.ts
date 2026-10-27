// @ts-nocheck
/**
 * dsh-cursorlike client — 设置页（编辑器 / AI 补全 / 语言服务器 / 性能优化 / 兼容性）。
 * MCP 与系统集成已移出本插件。
 * 作者 ddj 2026年10月27号
 */
import React from 'react'
import { rpc } from '../rpc.js'
import { SettingsContext } from '../settingsContext.js'
import { getSavePolicy, setSavePolicy } from '../savePolicy.js'
import { normalizeSidebarMinWidth, SIDEBAR_MIN_DEFAULT } from '../sidebarMin.js'
import { EDITOR_LIMIT_DEFAULT, normalizeMaxOpenEditors } from '../../shared/editorLimit.js'
import { AiSettings } from './AiSettings.js'
import { LspSettings } from './LspSettings.js'
import { PerfSettings } from './PerfSettings.js'

/** 编辑器设置：自动保存 + 页签上限 + 侧边栏宽度。 */
function EditorSettings() {
  const settings = React.useContext(SettingsContext)
  const snapshot = settings?.getSnapshot?.()
  const loading = !snapshot || snapshot.status === 'loading'
  const writable = snapshot?.status === 'ready' && snapshot?.writable !== false && Boolean(settings?.set)
  const [minW, setMinW] = React.useState(SIDEBAR_MIN_DEFAULT)
  const [minDraft, setMinDraft] = React.useState(null)
  const [limit, setLimit] = React.useState(EDITOR_LIMIT_DEFAULT)
  const [limitDraft, setLimitDraft] = React.useState(null)
  const [saveMode, setSaveMode] = React.useState(() => getSavePolicy().mode)
  const [saveDelay, setSaveDelay] = React.useState(() => getSavePolicy().delay)
  const [saveDelayDraft, setSaveDelayDraft] = React.useState(null)

  React.useEffect(() => {
    const onChange = () => {
      const snap = settings?.getSnapshot?.()
      setMinW(normalizeSidebarMinWidth(snap?.value?.sidebarMinWidth))
      setLimit(normalizeMaxOpenEditors(snap?.value?.maxOpenEditors))
    }
    onChange()
    return settings?.subscribe?.(onChange)
  }, [settings])

  const commitMinW = () => {
    if (minDraft === null) return
    const next = normalizeSidebarMinWidth(minDraft)
    setMinDraft(null)
    setMinW(next)
    settings?.set?.('sidebarMinWidth', next).catch(() => {})
  }
  const commitLimit = () => {
    if (limitDraft === null) return
    const next = normalizeMaxOpenEditors(limitDraft)
    setLimitDraft(null)
    setLimit(next)
    settings?.set?.('maxOpenEditors', next).catch(() => {})
  }
  const saveAutoMode = (mode) => {
    setSaveMode(mode)
    setSavePolicy({ mode, delay: saveDelay })
  }
  const commitAutoDelay = () => {
    if (saveDelayDraft === null) return
    setSaveDelayDraft(null)
    const next = Math.max(200, Math.min(Number(saveDelayDraft) || 1000, 10000))
    setSaveDelay(next)
    setSavePolicy({ mode: saveMode, delay: next })
  }

  return React.createElement('section', { className: 'vsm-panel' },
    React.createElement('h3', { className: 'vsm-panel-title' }, '编辑器'),
    React.createElement('div', { className: 'vsm-panel-body' },
      React.createElement('label', { className: 'vsm-general-row' },
        React.createElement('span', null, '自动保存',
          React.createElement('small', { className: 'vsm-devform-note' },
            '默认关闭：编辑后保持未保存，Ctrl+S 才写盘；Agent 修改仍直接落盘。')),
        React.createElement('select', { value: saveMode, onChange: (event) => saveAutoMode(event.target.value) },
          React.createElement('option', { value: 'off' }, '关闭（手动保存）'),
          React.createElement('option', { value: 'afterDelay' }, '停止输入后保存'),
          React.createElement('option', { value: 'onFocusChange' }, '失焦时保存'),
          React.createElement('option', { value: 'onWindowChange' }, '切换窗口时保存'))),
      saveMode === 'afterDelay' && React.createElement('label', { className: 'vsm-general-row' },
        React.createElement('span', null, '自动保存延迟'),
        React.createElement('input', {
          type: 'number', min: 200, max: 10000, step: 100,
          value: saveDelayDraft ?? saveDelay,
          onChange: (event) => setSaveDelayDraft(event.target.value),
          onBlur: commitAutoDelay,
          onKeyDown: (event) => { if (event.key === 'Enter') commitAutoDelay() },
        }),
        React.createElement('small', null, '毫秒；默认 1000')),
      React.createElement('label', { className: 'vsm-general-row' },
        React.createElement('span', null, '页签数量上限'),
        React.createElement('input', {
          type: 'number', min: 0, max: 50, step: 1,
          value: limitDraft ?? limit,
          disabled: loading || !writable,
          onChange: (event) => setLimitDraft(event.target.value),
          onBlur: commitLimit,
          onKeyDown: (event) => { if (event.key === 'Enter') commitLimit() },
        }),
        React.createElement('small', null, '0 = 不限制；超限时关闭最久未使用页签（固定页签除外）')),
      React.createElement('label', { className: 'vsm-general-row' },
        React.createElement('span', null, '侧边栏最小宽度'),
        React.createElement('input', {
          type: 'number', min: 180, max: 560, step: 10,
          value: minDraft ?? minW,
          disabled: loading || !writable,
          onChange: (event) => setMinDraft(event.target.value),
          onBlur: commitMinW,
          onKeyDown: (event) => { if (event.key === 'Enter') commitMinW() },
        }),
        React.createElement('small', null, '180–560 px；低于该宽度时自动隐藏')),
    ),
  )
}

/** 兼容性：host 报告 + 客户端运行时适配项。 */
function CompatSection({ getSummary }) {
  const [report, setReport] = React.useState(null)
  const [error, setError] = React.useState('')
  React.useEffect(() => {
    let alive = true
    rpc('compat', {}).then((result) => {
      if (!alive) return
      if (result.ok) setReport(result.report || null)
      else setError(String(result.error || '兼容性报告不可用'))
    }).catch((failure) => { if (alive) setError(String(failure)) })
    return () => { alive = false }
  }, [])
  const rows = [
    ...((report && report.adapters) || []),
    ...((report && report.external) || []),
    ...((report && report.guards) || []),
    ...((typeof getSummary === 'function' && getSummary()) || []),
  ]
  return React.createElement('section', { className: 'vsm-panel' },
    React.createElement('h3', { className: 'vsm-panel-title' }, '兼容性'),
    React.createElement('div', { className: 'vsm-panel-body' },
      error ? React.createElement('div', { className: 'vsm-mcp-error vsm-mcp-banner' }, error) : null,
      report ? React.createElement('div', { className: 'vsm-general-row' },
        React.createElement('span', null, '版本'),
        React.createElement('small', null, 'DSH ' + (report.dshVersion || '未探测') + ' · 插件 ' + (report.pluginVersion || '当前'))) : null,
      (report && report.warnings && report.warnings.length)
        ? report.warnings.map((warning) => React.createElement('div', { key: warning, className: 'vsm-mcp-error' }, warning))
        : null,
      rows.length
        ? rows.map((item, index) => React.createElement('div', { key: String(item.name) + ':' + index, className: 'vsm-general-row' },
            React.createElement('span', null, item.name),
            React.createElement('small', { className: item.active ? 'vsm-compat-ok' : 'vsm-mcp-error' },
              (item.active ? '可用' : '不可用') + (item.note ? ' · ' + item.note : ''))))
        : React.createElement('div', { className: 'vsm-mcp-empty' }, '正在读取兼容性报告…')),
  )
}

/** 设置页入口：编辑器 / AI 补全 / 语言服务器 / 性能优化 / 兼容性。 */
export function McpSettings(props: {
  openerRegistry?: unknown
  getMcpSession?: () => unknown
  compatSummary?: () => unknown
  getShortcuts?: () => unknown
} = {}) {
  const [tab, setTab] = React.useState('editor')
  return React.createElement('section', { className: 'vsm-mcp-page' },
    React.createElement('header', { className: 'vsm-mcp-header' },
      React.createElement('div', null,
        React.createElement('h2', null, 'CursorLike'),
        React.createElement('p', null, 'Cursor 式编码工作台设置。'))),
    React.createElement('nav', { className: 'vsm-mcp-tabs' },
      React.createElement('button', { className: tab === 'editor' ? 'active' : '', onClick: () => setTab('editor') }, '编辑器'),
      React.createElement('button', { className: tab === 'ai' ? 'active' : '', onClick: () => setTab('ai') }, 'AI 补全'),
      React.createElement('button', { className: tab === 'lsp' ? 'active' : '', onClick: () => setTab('lsp') }, '语言服务器'),
      React.createElement('button', { className: tab === 'perf' ? 'active' : '', onClick: () => setTab('perf') }, '性能优化'),
      React.createElement('button', { className: tab === 'compat' ? 'active' : '', onClick: () => setTab('compat') }, '兼容性')),
    React.createElement('div', { className: 'vsm-mcp-body' },
      tab === 'editor' ? React.createElement(EditorSettings)
        : tab === 'ai' ? React.createElement(AiSettings)
          : tab === 'lsp' ? React.createElement(LspSettings)
            : tab === 'perf' ? React.createElement(PerfSettings)
              : React.createElement(CompatSection, { getSummary: props.compatSummary })),
  )
}
