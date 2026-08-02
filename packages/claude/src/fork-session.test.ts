import { mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtempSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { claudeProjectSlug, forkClaudeTranscript } from './fork-session'

describe('claudeProjectSlug', () => {
  it('slugifies like the SDK project dir', () => {
    expect(claudeProjectSlug('/Users/me/app')).toBe('-Users-me-app')
  })
})

describe('forkClaudeTranscript', () => {
  it('calls SDK fork and relocates jsonl into target cwd slug dir', async () => {
    const root = mkdtempSync(join(tmpdir(), 'claude-fork-'))
    const projectsDir = join(root, 'projects')
    const sourceSlug = 'source-slug'
    mkdirSync(join(projectsDir, sourceSlug), { recursive: true })
    const newId = 'forked-sdk-id'
    writeFileSync(join(projectsDir, sourceSlug, `${newId}.jsonl`), '{"ok":1}\n')

    const targetCwd = mkdtempSync(join(tmpdir(), 'claude-cwd-'))
    const forkSessionFn = vi.fn(async () => ({ sessionId: newId }))

    const id = await forkClaudeTranscript({
      providerSessionId: 'src-session',
      targetCwd,
      projectsDir,
      forkSessionFn,
      upToMessageId: 'msg-1',
    })

    expect(id).toBe(newId)
    expect(forkSessionFn).toHaveBeenCalledWith('src-session', { upToMessageId: 'msg-1' })
    // Implementation realpathSync's cwd before slug (macOS /var vs /private/var).
    const dest = join(projectsDir, claudeProjectSlug(realpathSync(targetCwd)), `${newId}.jsonl`)
    expect(existsSync(dest)).toBe(true)
    expect(readFileSync(dest, 'utf8')).toContain('ok')
    expect(existsSync(join(projectsDir, sourceSlug, `${newId}.jsonl`))).toBe(false)
  })

  it('skips move when already in dest dir', async () => {
    const root = mkdtempSync(join(tmpdir(), 'claude-fork2-'))
    const projectsDir = join(root, 'projects')
    const targetCwd = mkdtempSync(join(tmpdir(), 'claude-cwd2-'))
    const slug = claudeProjectSlug(realpathSync(targetCwd))
    mkdirSync(join(projectsDir, slug), { recursive: true })
    const newId = 'same-dir'
    writeFileSync(join(projectsDir, slug, `${newId}.jsonl`), 'x\n')

    const id = await forkClaudeTranscript({
      providerSessionId: 'src',
      targetCwd,
      projectsDir,
      forkSessionFn: async () => ({ sessionId: newId }),
    })
    expect(id).toBe(newId)
    expect(existsSync(join(projectsDir, slug, `${newId}.jsonl`))).toBe(true)
  })
})
