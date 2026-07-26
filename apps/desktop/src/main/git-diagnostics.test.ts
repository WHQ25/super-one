import { beforeEach, describe, expect, it, vi } from 'vitest'

const warn = vi.fn()
vi.mock('./logger', () => ({ default: { info: vi.fn(), warn, debug: vi.fn(), error: vi.fn() } }))

const { describeGitError, logGitFailure, logSlowGit } = await import('./git-diagnostics')

describe('git status bar diagnostics', () => {
  beforeEach(() => {
    warn.mockClear()
    vi.useRealTimers()
  })

  it('surfaces git stderr and the failing argv so a log line is actionable', () => {
    const err = Object.assign(new Error('Command failed: git status'), {
      code: 128,
      stderr: 'fatal: detected dubious ownership in repository at /repo\n',
      gitArgs: ['status', '--porcelain', '-uall'],
    })
    const described = describeGitError(err)
    expect(described).toContain('args="git status --porcelain -uall"')
    expect(described).toContain('code=128')
    expect(described).toContain('dubious ownership')
  })

  it('marks a killed read as a timeout rather than a plain failure', () => {
    const err = Object.assign(new Error('git status timed out after 20000ms in /repo'), {
      gitArgs: ['status'],
      gitTimedOut: true,
      signal: 'SIGTERM',
    })
    expect(describeGitError(err)).toContain('timedOut=true')
  })

  it('flags a folder that is a repo, because that is the case that blanks the bar', () => {
    logGitFailure('GIT_INFO', '/repo', new Error('boom'), true)
    expect(warn.mock.calls[0].join(' ')).toContain('.git exists')
  })

  it('throttles repeated failures so a 5s poll cannot flood the log', () => {
    logGitFailure('GIT_INFO', '/repo-throttled', new Error('boom'))
    logGitFailure('GIT_INFO', '/repo-throttled', new Error('boom'))
    logGitFailure('GIT_INFO', '/repo-throttled', new Error('boom'))
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('throttles each folder and scope independently', () => {
    logGitFailure('GIT_INFO', '/a', new Error('boom'))
    logGitFailure('GIT_INFO', '/b', new Error('boom'))
    logGitFailure('WORKTREE_INFO', '/a', new Error('boom'))
    logSlowGit('GIT_INFO', '/a', 4200)
    expect(warn).toHaveBeenCalledTimes(4)
  })
})
