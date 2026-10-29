/** Official history shares the archive connection, but never the legacy callId namespace. @author ddj 2026年10月26号 */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { archiveDbFile } from './paths.js'
import { reviewBlocks } from './shared/reviewRegions.js'
import type { ReviewBlockState } from './shared/reviewRegions.js'
import type { DatabaseSync } from 'node:sqlite'
import { activeReady, dbFor } from './archiveDb.js'
import { evidenceText } from './reviewEvidence.js'
import type { ReviewEvidence } from './reviewEvidence.js'
import { diffTextHunks } from './shared/lineDiff.js'
import type { CaptureGap, CumulativeReview, DecideReview, OfficialDiff, ReviewDetail, ReviewItem, ReviewPage, ReviewSnapshot } from './shared/review.js'

type Row = Record<string, string | number | null>

/** @public @author ddj 2026年10月26号 @param cwd Migrated workspace. @returns Schema4 connection; DDL and version change roll back together. */
export function reviewDb(cwd: string): DatabaseSync {
  if (!activeReady(cwd)) throw new Error('官方审查要求先完成活跃库迁移')
  const db = dbFor(cwd)
  const version = db.prepare("SELECT value FROM metadata WHERE name='schema'").get() as Row
  if (version.value === '4') { migrateBlocks(cwd, db); ensureSessionIndexes(db); return db }
  db.exec('BEGIN IMMEDIATE')
  try {
    db.exec(`CREATE TABLE review_snapshots (
      session_id TEXT NOT NULL, turn INTEGER NOT NULL, seq INTEGER NOT NULL,
      payload TEXT NOT NULL, digest TEXT NOT NULL, current INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY(session_id,turn,seq));
      CREATE TABLE review_files (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL, turn INTEGER NOT NULL, seq INTEGER NOT NULL,
      identity TEXT NOT NULL, summary TEXT NOT NULL, diff TEXT NOT NULL,
      decision TEXT NOT NULL DEFAULT 'pending', revision INTEGER NOT NULL DEFAULT 0,
      current INTEGER NOT NULL DEFAULT 1);
      CREATE INDEX review_pending ON review_files(current,decision,id);
      CREATE INDEX review_turn ON review_files(session_id,turn,seq);
      CREATE TABLE review_capture (
      session_id TEXT NOT NULL, turn INTEGER NOT NULL, seq INTEGER NOT NULL,
      state TEXT NOT NULL, error TEXT, PRIMARY KEY(session_id,turn,seq));
      CREATE TABLE review_ops (
      operation_id TEXT PRIMARY KEY, request TEXT NOT NULL, state TEXT NOT NULL, result TEXT,
      evidence TEXT);
      UPDATE metadata SET value='4' WHERE name='schema';`)
    db.exec('COMMIT')
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK')
    throw error
  }
  migrateBlocks(cwd, db)
  ensureSessionIndexes(db)
  return db
}

/**
 * 一次性补齐按会话查询的复合索引。
 *
 * 文件卡/审查页默认按 session 过滤（session_id + current + decision + identity），
 * 旧的 review_pending(current,decision,id) 只能先扫全工作区 pending 再过滤；
 * 历史/文件很长的会话每 5s 轮询会放大到全表。索引随 schema 一次性迁移，幂等。
 * @author ddj 2026年10月28号
 * @param db 已迁移的 schema4 连接
 */
function ensureSessionIndexes(db: DatabaseSync): void {
  if (db.prepare("SELECT value FROM metadata WHERE name='review_session_index'").get()) return
  db.exec('BEGIN IMMEDIATE')
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS review_session_pending ON review_files(session_id,current,decision,identity);
      CREATE INDEX IF NOT EXISTS review_session_identity ON review_files(session_id,identity);
      INSERT INTO metadata(name,value) VALUES('review_session_index','1');`)
    db.exec('COMMIT')
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK')
    throw error
  }
}

/** @private @author ddj 2026年10月27号 @param cwd Workspace backup identity. @param db Open schema4 database. Extends the official-review sub-schema without changing legacy archive schema. @throws Migration failure, leaving prior decisions intact. */
function migrateBlocks(cwd: string, db: DatabaseSync): void {
  if (db.prepare("SELECT value FROM metadata WHERE name='review_schema'").get()) return
  const backup = archiveDbFile(cwd) + '.before-review-blocks.bak'
  if (!existsSync(backup)) db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`)

  db.exec('BEGIN IMMEDIATE')
  try {
    db.exec(`CREATE TABLE review_blocks (file_id TEXT NOT NULL, block_id TEXT NOT NULL,
      decision TEXT NOT NULL, PRIMARY KEY(file_id,block_id));
      CREATE TABLE review_evidence (file_id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      INSERT INTO metadata(name,value) VALUES('review_schema','2');`)
    const files = db.prepare('SELECT id,diff,decision FROM review_files').all() as Row[]
    for (const file of files) seedBlocks(db, String(file.id), JSON.parse(String(file.diff)), String(file.decision))
    db.exec('COMMIT')
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK')
    throw error
  }
}

/** @private @author ddj 2026年10月27号 @param db Transaction connection. @param id File record. @param diff Immutable official source. @param decision Prior file decision. Seeds deterministic blocks without changing source facts. */
function seedBlocks(db: DatabaseSync, id: string, diff: OfficialDiff, decision: string): void {
  const insert = db.prepare('INSERT INTO review_blocks VALUES(?,?,?)')
  for (const block of reviewBlocks(diff)) insert.run(id, block.id, decision)
}

/** @private @author ddj 2026年10月26号 @param text Canonical serialized input. @returns Collision-resistant identity. */
function digest(text: string): string { return createHash('sha256').update(text).digest('hex') }

/** @public @author ddj 2026年10月26号 @param cwd Workspace. @param snapshot Complete staged event. @returns False for late versions; commits facts, pointers and capture state atomically. */
export function saveSnapshot(cwd: string, snapshot: ReviewSnapshot): boolean {
  const db = reviewDb(cwd)
  const { sessionId, turn, seq } = snapshot
  if (snapshot.summary.cwd !== cwd || snapshot.summary.turn !== turn || snapshot.files.length !== snapshot.summary.files.length) throw new Error('官方采集不完整')
  const identities = new Set(snapshot.files.map((file) => file.identity))
  if (identities.size !== snapshot.files.length) throw new Error('官方文件身份重复')
  // capturedAt is acquisition metadata, not part of the immutable source identity.
  const hash = digest(JSON.stringify({ ...snapshot, capturedAt: '' }))
  db.exec('BEGIN IMMEDIATE')
  try {
    const prior = db.prepare('SELECT digest FROM review_snapshots WHERE session_id=? AND turn=? AND seq=?').get(sessionId, turn, seq) as Row | undefined
    if (prior && prior.digest !== hash) throw new Error('同一官方事件的内容发生变化')
    const latest = db.prepare('SELECT MAX(seq) AS seq FROM review_snapshots WHERE session_id=? AND turn=?').get(sessionId, turn) as Row
    if (prior || (typeof latest.seq === 'number' && latest.seq > seq)) { db.exec('COMMIT'); return false }
    insertSnapshot(db, snapshot, hash)
    db.prepare("INSERT INTO review_capture VALUES(?,?,?,'complete',NULL) ON CONFLICT(session_id,turn,seq) DO UPDATE SET state='complete',error=NULL").run(sessionId, turn, seq)
    db.exec('COMMIT')
    return true
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK')
    throw error
  }
}

/** @public @author ddj 2026年10月27号 @param cwd Workspace. @param resolvePath Backend path adapter. @returns Repairs only historical object-string identities; preserves IDs, decisions and immutable official facts. @throws Resolution or concurrent payload changes. */
export async function repairPaths(cwd: string, resolvePath: (cwd: string, path: string) => Promise<string>): Promise<void> {
  const db = reviewDb(cwd)
  const broken = db.prepare(`SELECT DISTINCT s.* FROM review_snapshots s JOIN review_files f
    USING(session_id,turn,seq) WHERE f.identity='[object Object]'`).all() as Row[]
  for (const row of broken) {
    const snapshot = JSON.parse(String(row.payload)) as ReviewSnapshot
    for (const file of snapshot.files) {
      if (file.identity !== '[object Object]') continue
      file.identity = await resolvePath(snapshot.summary.cwd, file.diff.path)
      if (!file.identity || file.identity === '[object Object]') throw new Error('官方文件路径修复失败')
    }
    if (new Set(snapshot.files.map((file) => file.identity)).size !== snapshot.files.length) throw new Error('官方文件身份重复')

    // All IO is staged before locking; compare the persisted payload to avoid overwriting newer repairs.
    db.exec('BEGIN IMMEDIATE')
    try {
      const current = db.prepare('SELECT payload FROM review_snapshots WHERE session_id=? AND turn=? AND seq=?')
        .get(snapshot.sessionId, snapshot.turn, snapshot.seq) as Row | undefined
      if (current?.payload === row.payload) {
        for (const file of snapshot.files) {
          db.prepare(`UPDATE review_files SET identity=? WHERE session_id=? AND turn=? AND seq=?
            AND identity='[object Object]' AND json_extract(diff,'$.path')=?`)
            .run(file.identity, snapshot.sessionId, snapshot.turn, snapshot.seq, file.diff.path)
        }
        db.prepare('UPDATE review_snapshots SET payload=?,digest=? WHERE session_id=? AND turn=? AND seq=?')
          .run(JSON.stringify(snapshot), digest(JSON.stringify({ ...snapshot, capturedAt: '' })), snapshot.sessionId, snapshot.turn, snapshot.seq)
      }
      db.exec('COMMIT')
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK')
      throw error
    }
  }
}

/** @private @author ddj 2026年10月26号 @param db Transaction. @param snapshot Source payload. @param hash Source digest. */
function insertSnapshot(db: DatabaseSync, snapshot: ReviewSnapshot, hash: string): void {
  const { sessionId, turn, seq } = snapshot
  const previous = db.prepare('SELECT id,identity,diff,decision FROM review_files WHERE session_id=? AND turn=? AND current=1').all(sessionId, turn) as Row[]
  db.prepare('UPDATE review_snapshots SET current=0 WHERE session_id=? AND turn=?').run(sessionId, turn)
  db.prepare('UPDATE review_files SET current=0 WHERE session_id=? AND turn=?').run(sessionId, turn)
  db.prepare('INSERT INTO review_snapshots VALUES(?,?,?,?,?,1)').run(sessionId, turn, seq, JSON.stringify(snapshot), hash)
  const insert = db.prepare('INSERT INTO review_files VALUES(?,?,?,?,?,?,?,?,0,1)')
  for (const [index, file] of snapshot.files.entries()) {
    const encoded = JSON.stringify(file.diff)
    const unchanged = previous.find((item) => item.identity === file.identity && item.diff === encoded)
    const id = digest(JSON.stringify([sessionId, turn, seq, file.identity]))
    const decision = String(unchanged?.decision ?? 'pending')
    insert.run(id, sessionId, turn, seq, file.identity, JSON.stringify(snapshot.summary.files[index]), encoded, decision)
    seedBlocks(db, id, file.diff, decision)
    if (unchanged) {
      // A same-turn republish must preserve mixed per-block decisions, not seed all blocks as mixed.
      db.prepare(`UPDATE review_blocks SET decision=(SELECT p.decision FROM review_blocks p
        WHERE p.file_id=? AND p.block_id=review_blocks.block_id)
        WHERE file_id=? AND EXISTS(SELECT 1 FROM review_blocks p WHERE p.file_id=? AND p.block_id=review_blocks.block_id)`)
        .run(unchanged.id, id, unchanged.id)
      db.prepare('INSERT INTO review_evidence SELECT ?,payload FROM review_evidence WHERE file_id=?').run(id, unchanged.id)
    }
  }
}

/** @public @author ddj 2026年10月26号 @param cwd Workspace. @param gap Announced event identity. @param state Durable inbox or explicit failure. */
export function captureState(cwd: string, gap: CaptureGap, state: 'queued' | 'gap'): void {
  reviewDb(cwd).prepare(`INSERT INTO review_capture VALUES(?,?,?,?,?) ON CONFLICT(session_id,turn,seq)
    DO UPDATE SET state=excluded.state,error=excluded.error WHERE review_capture.state<>'complete'`).run(gap.sessionId, gap.turn, gap.seq, state, gap.error)
}

/** @private @author ddj 2026年10月26号 @param row File and state. @returns Wire-safe summary without hunks. */
function itemOf(row: Row): ReviewItem {
  const summary = JSON.parse(String(row.summary))
  const kind = row.kind ?? (JSON.parse(String(row.diff)) as OfficialDiff).kind
  return { id: String(row.id), sessionId: String(row.session_id), turn: Number(row.turn), seq: Number(row.seq),
    ...summary, currentPath: String(row.identity), kind: kind as ReviewItem['kind'], decision: row.decision as ReviewItem['decision'], revision: Number(row.revision), current: row.current === 1 }
}

/** @public @author ddj 2026年10月26号 @param cwd Workspace. @param cursor Page offset. @param history Include withdrawn/decided history. @param path Optional file identity. @param sessionId Optional live session scope; omitted keeps the workspace-wide historical view. @returns Bounded metadata page for one session (or all sessions when omitted). */
export function reviewPage(cwd: string, cursor = 0, history = false, path?: string, sessionId?: string): ReviewPage {
  const db = reviewDb(cwd)
  const offset = Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : 0
  const sid = typeof sessionId === 'string' && sessionId !== '' ? sessionId : undefined
  const conditions = history ? [] : ["current=1 AND decision='pending'"]
  if (path !== undefined) conditions.push('identity=?')
  if (sid !== undefined) conditions.push('session_id=?')
  const clause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  const parameters: (string | number)[] = []
  if (path !== undefined) parameters.push(path)
  if (sid !== undefined) parameters.push(sid)
  parameters.push(offset)
  const rows = db.prepare(`SELECT id,session_id,turn,seq,identity,summary,decision,revision,current,
    json_extract(diff,'$.kind') AS kind FROM review_files ${clause} ORDER BY rowid DESC LIMIT 51 OFFSET ?`).all(...parameters) as Row[]
  const count = db.prepare(`SELECT COUNT(*) AS n FROM review_files WHERE current=1 AND decision='pending'
    ${sid !== undefined ? 'AND session_id=?' : ''}`).get(...(sid !== undefined ? [sid] : [])) as Row
  const gaps = db.prepare(`SELECT * FROM review_capture WHERE state<>'complete'
    ${sid !== undefined ? 'AND session_id=?' : ''} ORDER BY seq DESC LIMIT 50`).all(...(sid !== undefined ? [sid] : [])) as Row[]
  const capped = db.prepare(`SELECT session_id,turn,seq,json_extract(payload,'$.summary.total') AS total,
    json_array_length(payload,'$.summary.files') AS listed FROM review_snapshots WHERE current=1
    ${sid !== undefined ? 'AND session_id=?' : ''}
    AND json_extract(payload,'$.summary.total')>json_array_length(payload,'$.summary.files') LIMIT 50`).all(...(sid !== undefined ? [sid] : [])) as Row[]
  // Navigation is metadata-only and independent of the 50-row patch-history page.
  const files = db.prepare(`SELECT identity,MIN(json_extract(summary,'$.display')) AS label,COUNT(*) AS n,
    SUM(json_extract(summary,'$.added')) AS added,SUM(json_extract(summary,'$.deleted')) AS deleted
    FROM review_files WHERE current=1 AND decision='pending'
    ${sid !== undefined ? 'AND session_id=?' : ''} GROUP BY identity ORDER BY identity`).all(...(sid !== undefined ? [sid] : [])) as Row[]
  const covered = db.prepare(`SELECT DISTINCT identity FROM review_files
    ${sid !== undefined ? 'WHERE session_id=?' : ''}`).all(...(sid !== undefined ? [sid] : [])) as Row[]
  return { overview: { files: files.map((row) => ({ sourceKind: 'official', path: String(row.identity), label: String(row.label),
    pending: Number(row.n), added: Number(row.added ?? 0), deleted: Number(row.deleted ?? 0) })),
    coveredPaths: covered.map((row) => String(row.identity)) },
    items: rows.slice(0, 50).map(itemOf), pending: Number(count.n), nextCursor: rows.length > 50 ? offset + 50 : null,
    gaps: [
      ...gaps.map((row) => ({ sessionId: String(row.session_id), turn: Number(row.turn), seq: Number(row.seq), error: String(row.error || '采集中或上次采集被中断') })),
      ...capped.map((row) => ({ sessionId: String(row.session_id), turn: Number(row.turn), seq: Number(row.seq), error: `官方列表已截断：总计 ${row.total} 个文件，仅提供 ${row.listed} 个` })),
    ] }

}

/** @public @author ddj 2026年10月26号 @param cwd Migrated workspace. @param path Legacy write target. @param sessionId Optional live session scope; omitted keeps the workspace-wide guard. @returns Whether the session (or any session when omitted) owns an official version of the file. */
export function hasOfficial(cwd: string, path: string, sessionId?: string): boolean {
  const db = dbFor(cwd)
  // A read guard must not acquire a migration write lock on legacy-only databases.
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name='review_files' AND type='table'").get()) return false
  const sid = typeof sessionId === 'string' && sessionId !== '' ? sessionId : undefined
  const scope = sid !== undefined ? ' AND session_id=?' : ''
  if (/^[A-Za-z]:[\\/]/.test(path)) {
    return !!db.prepare(`SELECT 1 FROM review_files WHERE lower(replace(identity,char(92),'/'))=?${scope} LIMIT 1`)
      .get(path.replace(/\\/g, '/').toLowerCase(), ...(sid !== undefined ? [sid] : []))
  }
  return !!db.prepare(`SELECT 1 FROM review_files WHERE identity=?${scope} LIMIT 1`)
    .get(path, ...(sid !== undefined ? [sid] : []))
}

/** @public @author ddj 2026年10月26号 @param cwd Workspace. @param id Immutable file identity. @param sessionId Optional live session scope; other sessions' items resolve to null. @returns Historical patch, not a reconstruction from disk. */
export function reviewDetail(cwd: string, id: string, sessionId?: string): ReviewDetail | null {
  const db = reviewDb(cwd)
  const row = db.prepare(`SELECT f.*,json_extract(s.payload,'$.capturedAt') AS captured_at FROM review_files f JOIN review_snapshots s
    USING(session_id,turn,seq) WHERE f.id=?`).get(id) as Row | undefined
  if (!row) return null
  const sid = typeof sessionId === 'string' && sessionId !== '' ? sessionId : undefined
  if (sid !== undefined && String(row.session_id) !== sid) return null
  const blocks = db.prepare('SELECT block_id AS id,decision FROM review_blocks WHERE file_id=? ORDER BY rowid').all(id) as unknown as ReviewBlockState[]
  const diff = JSON.parse(String(row.diff)) as OfficialDiff
  const evidence = db.prepare('SELECT 1 FROM review_evidence WHERE file_id=?').get(id)
  const pending = row.current === 1 && row.decision === 'pending'
  const undo = pending && !!evidence && diff.kind === 'text' && diff.before && diff.after && !diff.coarse
  return { item: itemOf(row), diff, capturedAt: String(row.captured_at), blocks,
    capability: { keep: pending, undo,
      reason: undo ? 'Undo 将校验原始字节、当前文件版本及已处理差异块；文件变化会安全拒绝。'
        : '该记录缺少可验证的原始字节或受控写回能力；仍可显示差异和 Keep，不能猜测历史全文执行 Undo。' } }
}

/** @public @author ddj 2026年10月29号 @param cwd Workspace. @param sessionId Live session scope. @param identity File identity. @returns Cumulative pending diff; coarse file-level when line evidence is unavailable; null only when fewer than two contiguous pending records exist. */
export function reviewCumulative(cwd: string, sessionId: string, identity: string): CumulativeReview | null {
  const db = reviewDb(cwd)
  const all = db.prepare(`SELECT f.*,json_extract(s.payload,'$.capturedAt') AS captured_at
    FROM review_files f JOIN review_snapshots s USING(session_id,turn,seq)
    WHERE f.session_id=? AND f.identity=? AND f.current=1
    ORDER BY f.rowid`).all(sessionId, identity) as Row[]
  // 只合并最后一段连续的 pending：中间夹着已决策记录时，累计 diff 会把已接受
  // 的改动重新算进未处理差异里；此时回退单轮展示，避免误导。
  const firstPending = all.findIndex((row) => row.decision === 'pending')
  if (firstPending < 0) return null
  let lastPending = all.length - 1
  while (lastPending >= 0 && all[lastPending].decision !== 'pending') lastPending--
  const rows = all.slice(firstPending, lastPending + 1)
  if (rows.length < 2 || rows.some((row) => row.decision !== 'pending')) return null
  const first = rows[0]
  const last = rows[rows.length - 1]
  let firstDiff: OfficialDiff
  let lastDiff: OfficialDiff
  try {
    firstDiff = JSON.parse(String(first.diff)) as OfficialDiff
    lastDiff = JSON.parse(String(last.diff)) as OfficialDiff
  } catch { return null }
  const items = rows.map(itemOf)
  const display = String(lastDiff.display || lastDiff.path || identity)
  // 二进制/超大文件没有行级差异；仍返回“累计文件”让 bar/动作对齐 Cursor，
  // 只是不产生逐行红绿。
  if (firstDiff.kind !== 'text' || lastDiff.kind !== 'text') {
    const kind = firstDiff.kind === 'text' ? lastDiff.kind : firstDiff.kind
    if (kind === 'text') return null
    return { path: identity, display, items,
      diff: { kind, path: lastDiff.path, display: lastDiff.display } }
  }
  const coarse = (): CumulativeReview => ({
    path: identity, display, items,
    diff: { kind: 'text', path: lastDiff.path, display: lastDiff.display,
      before: firstDiff.before, after: lastDiff.after, hunks: [], coarse: true },
  })
  const evidenceOf = (id: string): ReviewEvidence | null => {
    const row = db.prepare('SELECT payload FROM review_evidence WHERE file_id=?').get(id) as Row | undefined
    if (!row) return null
    try { return JSON.parse(String(row.payload)) as ReviewEvidence } catch { return null }
  }
  const firstEvidence = evidenceOf(String(first.id))
  const lastEvidence = evidenceOf(String(last.id))
  // 原始字节缺失/无法解码/文件过大：不回退到“只显示最后一轮”，
  // 而是保留累计文件语义（Keep/Undo 整文件），并明确标记为 coarse。
  if (!firstEvidence || !lastEvidence) return coarse()
  try {
    if (firstDiff.before !== firstEvidence.before.present || lastDiff.after !== lastEvidence.after.present) return coarse()
    const before = evidenceText(firstEvidence).before
    const after = evidenceText(lastEvidence).after
    const hunks = diffTextHunks(before, after)
    if (!hunks) return coarse()
    return {
      path: identity,
      display,
      diff: {
        kind: 'text', path: lastDiff.path, display: lastDiff.display,
        before: firstDiff.before, after: lastDiff.after, hunks, coarse: false,
      },
      items,
    }
  } catch {
    return coarse()
  }
}

/** @public @author ddj 2026年10月27号 @param db Active decision transaction. @param request File or block action. Updates aggregate without losing mixed decisions. @throws Invalid or already-decided block. */
export function changeBlocks(db: DatabaseSync, request: DecideReview): void {
  if (request.scope === 'hunk') {
    const changed = db.prepare("UPDATE review_blocks SET decision=? WHERE file_id=? AND block_id=? AND decision='pending'")
      .run(request.decision, request.id, request.blockId ?? '')
    if (changed.changes !== 1) throw new Error('差异块不存在或已处理')
  } else {
    db.prepare("UPDATE review_blocks SET decision=? WHERE file_id=? AND decision='pending'").run(request.decision, request.id)
  }
  const states = db.prepare('SELECT DISTINCT decision FROM review_blocks WHERE file_id=?').all(request.id) as Row[]
  const decisions = states.map((row) => String(row.decision))
  let aggregate = request.decision as string
  if (decisions.includes('pending')) aggregate = 'pending'
  else if (decisions.length > 1) aggregate = 'mixed'
  else if (decisions.length === 1) aggregate = decisions[0]
  db.prepare('UPDATE review_files SET decision=? WHERE id=?').run(aggregate, request.id)
}

/** @public @author ddj 2026年10月26号 @param cwd Workspace. @param request Frozen identity/revision. @returns Idempotent decision; rejection never guesses a target. */
export function decideReview(cwd: string, request: DecideReview): { revision: number } {
  const db = reviewDb(cwd)
  const encoded = JSON.stringify(request)
  if (!request.operationId || request.operationId.length > 128) throw new Error('operationId 无效')
  db.exec('BEGIN IMMEDIATE')
  try {
    const previous = db.prepare('SELECT request,result FROM review_ops WHERE operation_id=?').get(request.operationId) as Row | undefined
    if (previous) {
      if (previous.request !== encoded) throw new Error('operationId 已用于其他请求')
      if (!previous.result) throw new Error('Undo 尚待写后核对，请重试原操作')
      db.exec('COMMIT')
      return JSON.parse(String(previous.result))
    }
    if (db.prepare("SELECT 1 FROM review_ops WHERE state='prepared' AND json_extract(request,'$.id')=?").get(request.id)) {
      throw new Error('该文件有尚待核对的 Undo，暂不能 Keep')
    }
    if (request.decision !== 'accepted') throw new Error('缺少可信全文证据，禁止拒绝写回')
    const change = db.prepare(`UPDATE review_files SET decision='accepted',revision=revision+1
      WHERE id=? AND seq=? AND revision=? AND current=1 AND decision='pending'`).run(request.id, request.seq, request.revision)
    if (change.changes !== 1) throw new Error('审查版本冲突，请刷新后重试')
    changeBlocks(db, request)
    const result = { revision: request.revision + 1 }
    db.prepare("INSERT INTO review_ops VALUES(?,?,'committed',?,NULL)").run(request.operationId, encoded, JSON.stringify(result))
    db.exec('COMMIT')
    return result
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK')
    throw error
  }
}
