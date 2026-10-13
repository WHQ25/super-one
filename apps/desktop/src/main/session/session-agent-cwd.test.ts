import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, ChatMessage, SendMessageRequest, SessionInfo } from '@superone/shared/agent-types'
import { Session } from './session'
import type { SessionBackend } from './types'

vi.mock('../logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } }))

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'agent-cwd-')))
  dirs.push(root)
  const project = join(root, 'repo')
  const worktree = join(project, '.claude/worktrees/probe')
  mkdirSync(join(worktree, 'src'), { recursive: true })
  mkdirSync(join(project, 'apps/desktop'), { recursive: true })
  // A linked worktree's root holds a `.git` file pointing into the main repository.
  writeFileSync(join(worktree, '.git'), `gitdir: ${join(project, '.git/worktrees/probe')}\n`)
  let emit!: (event: AgentEvent) => void
  const backend = {
    kind: 'claude', start: vi.fn(async () => {}), send: vi.fn(async (_request: SendMessageRequest) => {}),
    onEvent: (listener: typeof emit) => { emit = listener; return () => {} },
    onProviderSessionId: () => () => {}, onPermissionModeApplied: () => () => {},
  }
  const message: ChatMessage = { id: 'a1', role: 'assistant', status: 'complete', content: [], createdAt: '2026-10-12T00:00:00.000Z', providerId: 'claude' }
  const onStateChange = vi.fn()
  const session = new Session({ id: 'session', projectPath: project, cwd: project,
    providerId: 'claude', harnessId: 'claude', providerConfig: {}, backend: backend as unknown as SessionBackend,
    initialMessages: [message], onStateChange })
  const out: AgentEvent[] = []
  session.on((event) => out.push(event))
  const changes = () => out.filter((e) => e.type === 'working_directory_changed')
  return { root, project, worktree, session, backend, onStateChange, changes, emit: (event: AgentEvent) => emit(event) }
}

const init = (cwd: string): AgentEvent => ({ type: 'session_init', session: { sessionId: 'p1', cwd } as SessionInfo })

describe('Session follows a working directory the agent moved', () => {
  it('adopts an entered worktree without rebuilding the runtime', () => {
    const { worktree, session, backend, onStateChange, changes, emit } = fixture()
    emit({ type: 'working_directory_changed', cwd: worktree, gitBranch: 'worktree-probe' })

    expect(changes()).toEqual([expect.objectContaining({ cwd: worktree, worktreePath: worktree, gitBranch: 'worktree-probe' })])
    expect(session.snapshot).toMatchObject({ cwd: worktree, isWorktree: true, worktreePath: worktree, gitBranch: 'worktree-probe' })
    expect(onStateChange).toHaveBeenLastCalledWith(expect.objectContaining({ worktreePath: worktree, gitBranch: 'worktree-probe' }))
    expect(backend.start).not.toHaveBeenCalled()
  })

  it('returns to the project root when the reported path is a symlinked spelling of it', () => {
    const { root, project, worktree, session, changes, emit } = fixture()
    const alias = join(root, 'alias')
    symlinkSync(project, alias)
    emit({ type: 'working_directory_changed', cwd: worktree, gitBranch: 'worktree-probe' })
    emit({ type: 'working_directory_changed', cwd: alias })

    expect(changes().at(-1)).toMatchObject({ cwd: project, worktreePath: null, gitBranch: null })
    expect(session.snapshot).toMatchObject({ cwd: project, isWorktree: false, worktreePath: null, gitBranch: null })
  })

  it('reconciles from a turn init only when the CLI is somewhere else', () => {
    const { project, worktree, session, changes, emit } = fixture()
    emit(init(project))
    expect(changes()).toEqual([])

    emit(init(worktree))
    expect(changes()).toEqual([expect.objectContaining({ cwd: worktree, worktreePath: worktree, gitBranch: null })])
    expect(session.snapshot.cwd).toBe(worktree)
  })

  it('stays in its checkout when the CLI only changed into a subdirectory', () => {
    const { project, worktree, session, changes, emit } = fixture()
    // Bash `cd` moves the CLI's cwd, which the next turn's init reports.
    emit(init(join(project, 'apps/desktop')))
    expect(changes()).toEqual([])
    expect(session.snapshot).toMatchObject({ cwd: project, isWorktree: false })

    emit({ type: 'working_directory_changed', cwd: worktree, gitBranch: 'worktree-probe' })
    emit(init(join(worktree, 'src')))
    expect(changes()).toHaveLength(1)
    expect(session.snapshot).toMatchObject({ cwd: worktree, worktreePath: worktree, gitBranch: 'worktree-probe' })
  })
})
