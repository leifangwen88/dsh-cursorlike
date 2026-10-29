/**
 * 累计官方审查：同一文件多轮 pending 修改必须合并成一份 diff，
 * 而不是只返回最后一轮。证据链（review_evidence）是最早 before / 最新 after 的来源。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeArchiveDbs, migrateActive } from '../src/archiveDb.js'
import { reviewCumulative, reviewDb, reviewPage, saveSnapshot } from '../src/reviewDb.js'
import { rawReviewFile } from '../src/reviewEvidence.js'
import { reviewRegions } from '../src/shared/reviewRegions.js'
import { sessionFilesOf } from '../src/client/state/sessionFiles.js'
import type { ReviewSnapshot } from '../src/shared/review.js'

const cwd = '/cursorlike-cumulative-review'
let home = ''
let previousHome: string | undefined

/** @private @author ddj 2026年10月29号 @param sessionId Session. @param turn Turn. @param seq Event. @param path Relative file. @param before Presence before. @param after Presence after. @param body Patch body. @returns Official fixture. */
function snapshot(sessionId: string, turn: number, seq: number, path: string,
  before: boolean, after: boolean, body: string[]): ReviewSnapshot {
  const oldLines = body.filter((line) => line[0] === ' ' || line[0] === '-').length
  const newLines = body.filter((line) => line[0] === ' ' || line[0] === '+').length
  return {
    sourceKind: 'official', sessionId, turn, seq, capturedAt: '2026-10-29T00:00:00Z',
    summary: { cwd, turn, total: 1, added: 1, deleted: 1,
      files: [{ path, display: path, added: 1, deleted: 1 }] },
    files: [{ identity: cwd + '/' + path, diff: { kind: 'text', path, display: path,
      before, after, coarse: false, hunks: [{ oldStart: 1, oldLines, newStart: 1, newLines, lines: body }] } }],
  }
}

/** @private @author ddj 2026年10月29号 @param sessionId Session. @param turn Turn. @param seq Event. @param path Relative file. @returns Binary official fixture. */
function binarySnapshot(sessionId: string, turn: number, seq: number, path: string): ReviewSnapshot {
  return {
    sourceKind: 'official', sessionId, turn, seq, capturedAt: '2026-10-29T00:00:00Z',
    summary: { cwd, turn, total: 1, added: 0, deleted: 0,
      files: [{ path, display: path, added: 0, deleted: 0, binary: true }] },
    files: [{ identity: cwd + '/' + path, diff: { kind: 'binary', path, display: path } }],
  }
}

/** @private @author ddj 2026年10月29号 @param sessionId Session. @param path Relative file. @param before Raw before. @param after Raw after. */
function evidence(sessionId: string, path: string, before: string | null, after: string | null): void {
  const db = reviewDb(cwd)
  const ids = db.prepare('SELECT id FROM review_files WHERE session_id=? AND identity=? ORDER BY rowid')
    .all(sessionId, cwd + '/' + path) as Array<{ id: string }>
  // 每个测试文件只有两轮；按行顺序对应调用顺序。
  const index = ids.length - 1
  db.prepare('INSERT OR REPLACE INTO review_evidence(file_id,payload) VALUES(?,?)')
    .run(ids[index].id, JSON.stringify({ before: rawReviewFile(before === null ? null : Buffer.from(before)),
      after: rawReviewFile(after === null ? null : Buffer.from(after)) }))
}

beforeAll(async () => {
  previousHome = process.env.DSH_HOME
  home = mkdtempSync(join(tmpdir(), 'edrv-cumulative-'))
  process.env.DSH_HOME = home
  await migrateActive(cwd, null, async () => null)
})

afterAll(() => {
  closeArchiveDbs()
  if (previousHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previousHome
  rmSync(home, { recursive: true, force: true })
})

describe('reviewCumulative', () => {
  it('merges two turns into one baseline→latest diff and keeps items chronological', () => {
    const path = 'cumulative.ts'
    saveSnapshot(cwd, snapshot('s1', 1, 10, path, true, true, ['-A', '+B']))
    evidence('s1', path, 'A\n', 'B\n')
    saveSnapshot(cwd, snapshot('s1', 2, 20, path, true, true, ['-B', '+C']))
    evidence('s1', path, 'B\n', 'C\n')

    const cumulative = reviewCumulative(cwd, 's1', cwd + '/' + path)
    expect(cumulative).not.toBeNull()
    expect(cumulative!.items.map((item) => item.turn)).toEqual([1, 2])
    expect(cumulative!.diff).toMatchObject({ kind: 'text', before: true, after: true })
    const lines = cumulative!.diff.hunks.flatMap((hunk) => hunk.lines)
    expect(lines).toEqual(expect.arrayContaining(['-A', '+C']))
    // 编辑器按当前内容定位累计 block：两轮修改应合并成一个可点击的 C 区域。
    const regions = reviewRegions(cumulative!.diff, 'cumulative:' + path, [], 'C\n')
    expect(regions).toHaveLength(1)
    expect(regions[0]).toMatchObject({ start: 1, end: 2, stale: false, status: 'pending' })

    // 文件卡概览的行数也是两轮累计，而不是第一页 items。
    const page = reviewPage(cwd, 0, false, undefined, 's1')
    expect(page.overview?.files).toMatchObject([{ path: cwd + '/' + path, pending: 2, added: 2, deleted: 2 }])
    const rows = sessionFilesOf([], page)
    expect(rows.rows.find((row) => row.path === cwd + '/' + path)).toMatchObject({ added: 2, deleted: 2, pending: 2 })
  })

  it('treats a file created during the conversation as a cumulative addition', () => {
    const path = 'created.ts'
    saveSnapshot(cwd, snapshot('s2', 1, 30, path, false, true, ['+x']))
    evidence('s2', path, null, 'x\n')
    saveSnapshot(cwd, snapshot('s2', 2, 40, path, true, true, ['+y']))
    evidence('s2', path, 'x\n', 'x\ny\n')

    const cumulative = reviewCumulative(cwd, 's2', cwd + '/' + path)
    expect(cumulative).not.toBeNull()
    expect(cumulative!.diff).toMatchObject({ before: false, after: true })
    expect(cumulative!.diff.hunks.flatMap((hunk) => hunk.lines)).toEqual(['+x', '+y'])
    const regions = reviewRegions(cumulative!.diff, 'cumulative:' + path, [], 'x\ny\n')
    expect(regions).toHaveLength(1)
    expect(regions[0]).toMatchObject({ start: 1, end: 3, stale: false })
  })

  it('keeps cumulative file semantics when evidence is missing', () => {
    const path = 'no-evidence.ts'
    saveSnapshot(cwd, snapshot('s3', 1, 50, path, true, true, ['-A', '+B']))
    saveSnapshot(cwd, snapshot('s3', 2, 60, path, true, true, ['-B', '+C']))
    const cumulative = reviewCumulative(cwd, 's3', cwd + '/' + path)
    expect(cumulative).not.toBeNull()
    expect(cumulative!.items.map((item) => item.turn)).toEqual([1, 2])
    // 没有原始字节时不回退单轮：仍给累计文件级视图，但没有逐行 hunk。
    expect(cumulative!.diff).toMatchObject({ kind: 'text', coarse: true, hunks: [] })
    expect(reviewRegions(cumulative!.diff, 'cumulative:' + path, [], 'C\n')).toEqual([])

    const single = 'single.ts'
    saveSnapshot(cwd, snapshot('s4', 1, 70, single, true, true, ['-A', '+B']))
    expect(reviewCumulative(cwd, 's4', cwd + '/' + single)).toBeNull()
  })

  it('refuses to merge pending records separated by an accepted round', () => {
    const path = 'interspersed.ts'
    saveSnapshot(cwd, snapshot('s5', 1, 80, path, true, true, ['-A', '+B']))
    evidence('s5', path, 'A\n', 'B\n')
    saveSnapshot(cwd, snapshot('s5', 2, 90, path, true, true, ['-B', '+C']))
    evidence('s5', path, 'B\n', 'C\n')
    saveSnapshot(cwd, snapshot('s5', 3, 100, path, true, true, ['-C', '+D']))
    evidence('s5', path, 'C\n', 'D\n')
    reviewDb(cwd).prepare("UPDATE review_files SET decision='accepted' WHERE session_id='s5' AND turn=2").run()
    expect(reviewCumulative(cwd, 's5', cwd + '/' + path)).toBeNull()
  })

  it('keeps cumulative file semantics for binary files (no line markers)', () => {
    const path = 'image.png'
    saveSnapshot(cwd, binarySnapshot('s7', 1, 140, path))
    saveSnapshot(cwd, binarySnapshot('s7', 2, 150, path))
    const cumulative = reviewCumulative(cwd, 's7', cwd + '/' + path)
    expect(cumulative).not.toBeNull()
    expect(cumulative!.diff).toMatchObject({ kind: 'binary', path, display: path })
    expect(cumulative!.items).toHaveLength(2)
    expect(reviewRegions(cumulative!.diff, 'cumulative:' + path, [], null)).toEqual([])
  })

  it('ignores accepted rounds after the last pending record', () => {
    const path = 'after-accepted.ts'
    saveSnapshot(cwd, snapshot('s6', 1, 110, path, true, true, ['-A', '+B']))
    evidence('s6', path, 'A\n', 'B\n')
    saveSnapshot(cwd, snapshot('s6', 2, 120, path, true, true, ['-B', '+C']))
    evidence('s6', path, 'B\n', 'C\n')
    saveSnapshot(cwd, snapshot('s6', 3, 130, path, true, true, ['-C', '+D']))
    reviewDb(cwd).prepare("UPDATE review_files SET decision='accepted' WHERE session_id='s6' AND turn=3").run()
    const cumulative = reviewCumulative(cwd, 's6', cwd + '/' + path)
    expect(cumulative).not.toBeNull()
    expect(cumulative!.items.map((item) => item.turn)).toEqual([1, 2])
  })
})
