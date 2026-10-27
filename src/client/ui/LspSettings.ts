// @ts-nocheck
/**
 * dsh-cursorlike client — 语言智能设置（状态 + 自动检测 + 高级命令）。
 * 不包含语言服务器市场/扩展管理：服务器来自系统 PATH、自动发现或用户显式配置。
 */
import React from 'react'
import { rpc } from '../rpc.js'

const LANGUAGE_LABELS = { lua: 'Lua', csharp: 'C#' }
const PHASE_LABELS = {
  ready: '已启动',
  indexing: '索引中',
  starting: '启动中',
  idle: '未启动',
  unavailable: '不可用',
  stopped: '已停止',
}

function createEmptyConfig() {
  return { enabled: true, command: '', path: '' }
}

/** 语言智能状态页。 */
export function LspSettings() {
  const [servers, setServers] = React.useState([])
  const [config, setConfig] = React.useState({})
  const [error, setError] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [editing, setEditing] = React.useState('')
  const [draft, setDraft] = React.useState(createEmptyConfig())

  const reload = React.useCallback(() => {
    setBusy(true)
    setError('')
    Promise.all([rpc('edrv.lsp.configGet', {}), rpc('edrv.lsp.detect', {})])
      .then(([cfg, det]) => {
        if (cfg?.ok) setConfig(cfg.config ?? {})
        if (det?.ok) setServers(det.servers ?? [])
        else setError(det?.error || '语言服务器检测失败')
      })
      .catch((failure) => setError(String(failure)))
      .finally(() => setBusy(false))
  }, [])

  React.useEffect(() => { reload() }, [reload])

  const redetect = (languageId) => {
    setBusy(true)
    setError('')
    rpc('edrv.lsp.redetect', { languageId })
      .then((res) => {
        if (res?.ok) setServers(res.servers ?? [])
        else setError(res?.error || '重新检测失败')
      })
      .catch((failure) => setError(String(failure)))
      .finally(() => setBusy(false))
  }

  const beginEdit = (languageId) => {
    const current = config?.[languageId] || createEmptyConfig()
    setEditing(languageId)
    setDraft({
      enabled: current.enabled !== false,
      command: current.command || '',
      path: current.path || '',
    })
  }

  const save = (languageId) => {
    setBusy(true)
    setError('')
    rpc('edrv.lsp.configUpdate', {
      languageId,
      enabled: draft.enabled !== false,
      command: draft.command || undefined,
      path: draft.path || undefined,
    })
      .then((res) => {
        if (!res?.ok) { setError(res?.error || '保存失败'); return }
        setConfig(res.config ?? config)
        setEditing('')
        reload()
      })
      .catch((failure) => setError(String(failure)))
      .finally(() => setBusy(false))
  }

  const rows = servers.length
    ? servers
    : ['lua', 'csharp'].map((languageId) => ({ languageId, phase: 'idle', source: 'none' }))
  const sorted = [...rows].sort((a, b) => {
    const order = ['lua', 'csharp']
    const ai = order.indexOf(a.languageId)
    const bi = order.indexOf(b.languageId)
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi)
  })

  return React.createElement('section', { className: 'vsm-panel' },
    React.createElement('h3', { className: 'vsm-panel-title' }, '语言智能'),
    React.createElement('div', { className: 'vsm-panel-body' },
      React.createElement('p', { className: 'vsm-devform-note' },
        'LSP 负责跳转、引用、补全、悬停、签名和诊断。没有服务器时自动降级为语法高亮 + AI 补全。'),
      error ? React.createElement('div', { className: 'vsm-mcp-error vsm-mcp-banner' }, error) : null,
      React.createElement('div', { className: 'vsm-general-row' },
        React.createElement('span', null, '自动发现'),
        React.createElement('button', { className: 'vsm-primary vsm-small', disabled: busy, onClick: reload }, busy ? '检测中…' : '重新检测')),
      sorted.map((server) => {
        const languageId = server.languageId
        const phase = server.phase || 'idle'
        const label = LANGUAGE_LABELS[languageId] || languageId
        const isEditing = editing === languageId
        return React.createElement('div', { key: languageId, className: 'vsm-lsp-row' },
          React.createElement('div', { className: 'vsm-general-row' },
            React.createElement('span', null,
              label,
              React.createElement('small', { className: 'vsm-devform-note' },
                ' · ' + (PHASE_LABELS[phase] || phase) + (server.providerName ? ' · ' + server.providerName : '')),
              server.reason ? React.createElement('small', { className: 'vsm-mcp-error' }, ' · ' + server.reason) : null),
            React.createElement('div', { className: 'vsm-devform-actions' },
              React.createElement('button', { className: 'vsm-small', disabled: busy, onClick: () => redetect(languageId) }, '重新检测'),
              React.createElement('button', { className: 'vsm-small', onClick: () => (isEditing ? setEditing('') : beginEdit(languageId)) }, isEditing ? '收起' : '高级'))),
          isEditing ? React.createElement('div', { className: 'vsm-lsp-advanced' },
            React.createElement('label', { className: 'vsm-general-row' },
              React.createElement('span', null, '命令'),
              React.createElement('input', {
                value: draft.command,
                placeholder: '留空 = 自动发现，例如 lua-language-server',
                onChange: (event) => setDraft({ ...draft, command: event.target.value }),
              })),
            React.createElement('label', { className: 'vsm-general-row' },
              React.createElement('span', null, '路径'),
              React.createElement('input', {
                value: draft.path,
                placeholder: '可执行文件绝对路径（可选）',
                onChange: (event) => setDraft({ ...draft, path: event.target.value }),
              })),
            React.createElement('div', { className: 'vsm-devform-actions' },
              React.createElement('button', { className: 'vsm-primary vsm-small', disabled: busy, onClick: () => save(languageId) }, '保存并重测'))) : null,
        )
      }),
      React.createElement('p', { className: 'vsm-devform-note' },
        '当前内置语言：Lua / C#。TypeScript / JavaScript / JSON / CSS / HTML 使用 Monaco 内置语言服务；其它语言需要对应 language server。'),
    ),
  )
}
