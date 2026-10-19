import { describe, expect, it } from 'vitest'
import { previewerLoadRoot } from './previewer-load-root'

const SESSION = 'remote:conn-1:/home/node/proj'

describe('previewer load root on a remote desktop session', () => {
  it('reads a desktop-node host path through the pane remote key', () => {
    expect(previewerLoadRoot('/home/node/proj', SESSION, SESSION)).toBe(SESSION)
  })

  it('keeps a payload root that is already a remote key', () => {
    const built = 'remote:conn-1:/home/node/proj'
    expect(previewerLoadRoot(built, 'remote:other:/elsewhere', null)).toBe(built)
  })

  it('keeps a host path while the pane itself is local', () => {
    expect(previewerLoadRoot('/repo', '/repo', '/repo')).toBe('/repo')
    expect(previewerLoadRoot('/repo', null, 'remote:conn-1:/elsewhere')).toBe('/repo')
  })

  it('uses the active worktree when the payload root lies under it', () => {
    const worktree = 'remote:conn-1:/home/node/proj/wt'
    expect(previewerLoadRoot('/home/node/proj/wt', SESSION, worktree)).toBe(worktree)
  })

  it('keeps the project key when the worktree is a subdirectory of the payload root', () => {
    const worktree = 'remote:conn-1:/home/node/proj/wt'
    expect(previewerLoadRoot('/home/node/proj', SESSION, worktree)).toBe(SESSION)
  })

  it('ignores a worktree on another connection', () => {
    expect(previewerLoadRoot('/home/node/proj', SESSION, 'remote:other:/home/node/proj')).toBe(SESSION)
  })

  it('still picks this connection when the payload root sits outside the project', () => {
    const worktree = 'remote:conn-1:/home/node/proj/wt'
    expect(previewerLoadRoot('/var/shots', SESSION, worktree)).toBe(worktree)
    expect(previewerLoadRoot('/var/shots', SESSION, null)).toBe(SESSION)
  })
})
