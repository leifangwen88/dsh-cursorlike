// @ts-nocheck
/**
 * dsh-vscode-mode client — 会话级差异 dock。
 * conversation.input.dock 是唯一实例：普通对话显示待审文件卡（Cursor 式），
 * 文件编辑页显示完整操作条（EditorView 发布快照）。
 * 轮询已收敛到 state/recordsFeed.ts 与 state/reviewFeed.ts 的会话级共享订阅，
 * 本组件不再自建定时器。卡内不渲染逐行 diff（diff 在聊天/Review 中查看）。
 * 作者 ddj 2026-08-26 / 2026-10-27
 */
import React from 'react'
import { openDiffView, openEditorView } from '../events.js'
import { subscribeReview } from '../state/reviewFeed.js'
import { subscribeRecords } from '../state/recordsFeed.js'
import { sessionFilesOf } from '../state/sessionFiles.js'
import { CommandPalette } from './CommandPalette.js'
import { SessionFilesCard } from './SessionFilesCard.js'

/**
 * 对话输入框上方的唯一差异 dock。
 * @author ddj 2026年08月26号 / 2026年10月27号
 * @param props DSH 注入的会话属性
 * @returns 待审文件卡 / 编辑器差异条 / 仅命令栏兜底
 */
export function ConversationDiffDock(props) {
  const sessionId = props?.sessionId
  const [feed, setFeed] = React.useState({ records: [], page: null })

  React.useEffect(() => {
    if (!sessionId) {
      setFeed({ records: [], page: null })
      return undefined
    }

    let records = []
    let page = null
    const sync = () => setFeed({ records, page })
    const offRecords = subscribeRecords(sessionId, (next) => { records = next; sync() })
    const offReview = subscribeReview(sessionId, (review) => { page = review.page; sync() })
    return () => { offRecords(); offReview() }
  }, [sessionId])

  // 待审文件投影（官方 page.items + 旧记录 hunks），只在订阅数据变化时重算。
  const sessionFiles = React.useMemo(() => sessionFilesOf(feed.records, feed.page), [feed])

  const renderDock = (content, key) => React.createElement('div', {
    key,
    className: 'edrv-diff-dock-shell',
    'data-edrv-diff-dock-shell': '1',
  }, content)

  // 命令栏浮层的兜底宿主：本 dock 是每会话常驻 slot（编辑区未挂载时仍能唤起命令栏）；
  // 与 EditorView 同时挂载时由 commandPaletteStore 的单实例认领保证只渲染一份。
  const palette = React.createElement(CommandPalette, { key: 'edrv-palette', sessionId })

  // 输入框文件卡始终是主形态（Cursor 用户期待它常驻）；编辑器自己的差异条在 EditorView 内。
  if (!sessionId || !sessionFiles.rows.length) return palette

  // 点行：有文本差异聚焦 diff，无差异（官方二进制/超大/空差异旧记录）打开编辑区。
  const openFile = (row) => {
    if (row.diffable) openDiffView(row.path)
    else openEditorView(row.path)
  }

  return React.createElement(React.Fragment, null,
    palette,
    renderDock(React.createElement(SessionFilesCard, {
      sessionId,
      rows: sessionFiles.rows,
      onOpenFile: openFile,
      onReview: () => {
        // 输入框卡片是唯一差异入口；Review 直接打开第一个待审 diff。
        if (sessionFiles.rows[0]) openDiffView(sessionFiles.rows[0].path)
      },
    }), sessionId || 'chat'))
}
