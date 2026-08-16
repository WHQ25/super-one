import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { claudeProjectSlug } from './fork-session'
import { inspectClaudeTranscript } from './transcript-store'

describe('inspectClaudeTranscript', () => {
  let root: string
  let projectsDir: string
  let cwd: string

  const writeTranscript = (id: string, lines: string[]): void => {
    // The CLI slugs the realpath, so a symlinked tmpdir must be resolved too.
    const dir = join(projectsDir, claudeProjectSlug(realpathSync(cwd)))
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${id}.jsonl`), lines.map((l) => `${l}\n`).join(''))
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'transcript-store-'))
    projectsDir = join(root, 'projects')
    cwd = join(root, 'workspace')
    mkdirSync(cwd, { recursive: true })
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('reports missing when no transcript exists for that cwd', () => {
    expect(inspectClaudeTranscript('sid-1', cwd, projectsDir)).toBe('missing')
  })

  it('reports empty for a startup-only transcript so a silent context loss is detectable', () => {
    writeTranscript('sid-1', [
      '{"type":"mode","mode":"default"}',
      '{"type":"permission-mode","permissionMode":"default"}',
      '{"type":"system","subtype":"init"}',
    ])
    expect(inspectClaudeTranscript('sid-1', cwd, projectsDir)).toBe('empty')
  })

  it('reports ok once a conversation row is present', () => {
    writeTranscript('sid-1', [
      '{"type":"mode","mode":"default"}',
      '{"type":"user","message":{"role":"user","content":"hi"}}',
    ])
    expect(inspectClaudeTranscript('sid-1', cwd, projectsDir)).toBe('ok')
  })

  it('reports unknown instead of throwing when the cwd is gone', () => {
    expect(inspectClaudeTranscript('sid-1', join(root, 'missing-cwd'), projectsDir)).toBe('unknown')
  })
})
