/**
 * 会话隔离：同一工作区（同一 review DB / 记录桶）内，文件卡与审查页只能看到
 * 当前对话自己的 pending 改动。官方 review DB 按 cwd 保存，因此读取必须带 sessionId。
 * 作者 ddj 2026年10月28号
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeArchiveDbs, migrateActive } from '../src/archiveDb.js'
import { hasOfficial, reviewDb, reviewDetail, reviewPage, saveSnapshot } from '../src/reviewDb.js'
import type { ReviewSnapshot } from '../src/shared/review.js'

const cwd = '/cursorlike-session-scope'
let home = ''
let previousHome: string | undefined

/** 一条官方快照：files 指定相对路径列表。 */
function snapshot(sessionId: string, turn: number, seq: number, files: string[]): ReviewSnapshot {
  return {
    sourceKind: 'official', sessionId, turn, seq, capturedAt: '2026-10-28T00:00:00Z',
    summary: { cwd, turn, total: files.length, added: files.length, deleted: 0,
      files: files.map((file) => ({ path: file, display: file, added: 1, deleted: 0 })) },
    files: files.map((file) => ({
      identity: cwd + '/' + file,
      diff: { kind: 'text', path: file, display: file, before: true, after: true, coarse: false,
        hunks: [{ oldStart: 1, oldLines: 0, newStart: 1, newLines: 1, lines: ['+B'] }] },
    })),
  }
}

beforeAll(async () => {
  previousHome = process.env.DSH_HOME
  home = mkdtempSync(join(tmpdir(), 'edrv-session-scope-'))
  process.env.DSH_HOME = home
  await migrateActive(cwd, null, async () => null)
  saveSnapshot(cwd, snapshot('session-a', 1, 10, ['a.ts']))
  saveSnapshot(cwd, snapshot('session-b', 1, 20, ['a.ts', 'b.ts']))
})

afterAll(() => {
  closeArchiveDbs()
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  rmSync(home, { recursive: true, force: true })
})

describe('官方 review DB 的会话隔离', () => {
  it('按会话查询有复合索引（避免每 5s 轮询退化成全工作区扫描）', () => {
    const db = reviewDb(cwd)
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='review_files'")
      .all().map((row) => String((row as { name: unknown }).name))
    expect(indexes).toContain('review_session_pending')
    expect(indexes).toContain('review_session_identity')
    const plan = JSON.stringify(db.prepare(`EXPLAIN QUERY PLAN SELECT id FROM review_files
      WHERE session_id=? AND current=1 AND decision='pending'`).all('session-a'))
    expect(plan).toContain('review_session_pending')
  })

  it('不传 sessionId 时保留工作区聚合视图（历史/兼容）', () => {
    const page = reviewPage(cwd)
    expect(page.pending).toBe(3)
    expect(page.overview?.files.map((file) => file.pending)).toEqual([2, 1])
  })

  it('传入 sessionId 后 items / pending / overview / coveredPaths 只含该会话', () => {
    const a = reviewPage(cwd, 0, false, undefined, 'session-a')
    expect(a.pending).toBe(1)
    expect(a.items.map((item) => item.sessionId)).toEqual(['session-a'])
    expect(a.overview?.files).toMatchObject([{ sourceKind: 'official', path: cwd + '/a.ts', label: 'a.ts', pending: 1, added: 1, deleted: 0 }])
    expect(a.overview?.coveredPaths).toEqual([cwd + '/a.ts'])

    const b = reviewPage(cwd, 0, false, undefined, 'session-b')
    expect(b.pending).toBe(2)
    expect(b.items.every((item) => item.sessionId === 'session-b')).toBe(true)
    expect(b.overview?.files.map((file) => [file.label, file.pending])).toEqual([['a.ts', 1], ['b.ts', 1]])
    expect(b.overview?.coveredPaths).toEqual([cwd + '/a.ts', cwd + '/b.ts'])
  })

  it('按 path 重取审查项同样受会话约束', () => {
    const a = reviewPage(cwd, 0, false, cwd + '/a.ts', 'session-a')
    expect(a.items).toHaveLength(1)
    expect(a.items[0].sessionId).toBe('session-a')
    expect(reviewPage(cwd, 0, false, cwd + '/b.ts', 'session-a').items).toEqual([])
    expect(reviewPage(cwd, 0, false, cwd + '/b.ts', 'session-b').items).toHaveLength(1)
  })

  it('详情与 hasOfficial 不跨会话泄漏', () => {
    const aItem = reviewPage(cwd, 0, false, cwd + '/a.ts', 'session-a').items[0]
    expect(reviewDetail(cwd, aItem.id, 'session-a')).not.toBeNull()
    expect(reviewDetail(cwd, aItem.id, 'session-b')).toBeNull()
    expect(reviewDetail(cwd, aItem.id)).not.toBeNull()

    expect(hasOfficial(cwd, cwd + '/a.ts', 'session-a')).toBe(true)
    expect(hasOfficial(cwd, cwd + '/b.ts', 'session-a')).toBe(false)
    expect(hasOfficial(cwd, cwd + '/b.ts', 'session-b')).toBe(true)
    expect(hasOfficial(cwd, cwd + '/b.ts')).toBe(true)
  })

  it('历史视图也按会话过滤', () => {
    const historyA = reviewPage(cwd, 0, true, undefined, 'session-a')
    expect(historyA.items.every((item) => item.sessionId === 'session-a')).toBe(true)
    const historyB = reviewPage(cwd, 0, true, undefined, 'session-b')
    expect(historyB.items.every((item) => item.sessionId === 'session-b')).toBe(true)
    expect(historyB.items).toHaveLength(2)
  })
})
