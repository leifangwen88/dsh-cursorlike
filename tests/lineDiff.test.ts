import { describe, expect, it } from 'vitest'
import { diffTextHunks, diffTextLines } from '../src/shared/lineDiff.js'
import { reviewBlocks } from '../src/shared/reviewRegions.js'

/** @private @author ddj 2026年10月29号 @param text File body with trailing newline. @returns OfficialDiff shell for block parsing. */
function diffOf(before: string, after: string) {
  const hunks = diffTextHunks(before, after)
  if (hunks === null) throw new Error('unexpected fallback')
  return { kind: 'text' as const, path: 'a.ts', display: 'a.ts', before: before !== '', after: after !== '', hunks, coarse: false }
}

describe('cumulative line diff', () => {
  it('turns two separate edits into cumulative hunks', () => {
    const before = 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk\nl\n'
    const after = 'a\nB\nc\nd\ne\nf\ng\nh\ni\nJ\nk\nl\n'
    const hunks = diffTextHunks(before, after)
    expect(hunks).not.toBeNull()
    expect(hunks).toHaveLength(2)
    const lines = hunks!.flatMap((hunk) => hunk.lines)
    expect(lines).toEqual(expect.arrayContaining(['-b', '+B', '-j', '+J']))
    expect(reviewBlocks(diffOf(before, after))).toHaveLength(2)
  })

  it('splits distant edits into separate hunks with context', () => {
    const before = Array.from({ length: 30 }, (_, index) => 'line' + index).join('\n') + '\n'
    const lines = before.trimEnd().split('\n')
    lines[1] = 'changed2'
    lines[28] = 'changed29'
    const after = lines.join('\n') + '\n'
    const hunks = diffTextHunks(before, after)
    expect(hunks).toHaveLength(2)
    expect(hunks![0].oldStart).toBe(1)
    expect(hunks![1].oldStart).toBeGreaterThan(20)
  })

  it('represents a created file as all inserted lines against an empty baseline', () => {
    const hunks = diffTextHunks('', 'x\ny\n')
    expect(hunks).toHaveLength(1)
    expect(hunks![0]).toMatchObject({ oldStart: 1, oldLines: 0, newStart: 1, newLines: 2 })
    expect(hunks![0].lines).toEqual(['+x', '+y'])
  })

  it('keeps BOM/CRLF normalization stable and returns no hunks for identical text', () => {
    expect(diffTextLines('\uFEFFa\r\nb\r\n')).toEqual(['a', 'b'])
    expect(diffTextHunks('a\nb\n', 'a\nb\n')).toEqual([])
    expect(diffTextHunks('a\r\nb\r\n', 'a\nb\n')).toEqual([])
  })

  it('falls back instead of blocking on pathological sizes', () => {
    const huge = Array.from({ length: 20001 }, (_, index) => String(index)).join('\n')
    expect(diffTextHunks(huge, huge + '\nchanged')).toBeNull()
  })

  it('round-trips random edits by replaying the produced hunks', () => {
    let seed = 7
    const random = (): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % 1000 / 1000 }
    for (let round = 0; round < 60; round++) {
      const base = Array.from({ length: 40 }, (_, index) => 'l' + index)
      const next = [...base]
      for (let edit = 0; edit < 4; edit++) {
        const at = Math.floor(random() * next.length)
        const kind = Math.floor(random() * 3)
        if (kind === 0) next[at] = 'x' + round + '_' + edit
        else if (kind === 1) next.splice(at, 1)
        else next.splice(at, 0, 'i' + round + '_' + edit)
      }
      const before = base.join('\n') + '\n'
      const after = next.join('\n') + '\n'
      const hunks = diffTextHunks(before, after)
      expect(hunks).not.toBeNull()
      const lines = diffTextLines(before)
      let delta = 0
      for (const hunk of hunks!) {
        const at = hunk.oldStart - 1 + delta
        const replacement = hunk.lines.filter((line) => line[0] === ' ' || line[0] === '+').map((line) => line.slice(1))
        lines.splice(at, hunk.oldLines, ...replacement)
        delta += hunk.newLines - hunk.oldLines
      }
      expect(lines).toEqual(diffTextLines(after))
    }
  })
})
