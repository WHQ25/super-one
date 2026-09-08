import { expect, test } from 'vitest'
import { additionalDirsFromEvents } from './additional-dirs-events'

const SCOPE = { projectPath: '/work/super-one', sessionId: 'session-1', projectDirs: ['/work/shared'] }

test('a change to another project is not this project', () => {
  const report = additionalDirsFromEvents([{
    type: 'additional_dirs_changed', projectPath: '/work/other',
    workspaceDirs: ['/somewhere/else'], sessionAdditionalDirs: [], additionalDirectories: [],
  }], SCOPE)

  expect(report).toEqual({})
})

test('the project half repaints from any change to it', () => {
  const report = additionalDirsFromEvents([{
    type: 'additional_dirs_changed', projectPath: '/work/super-one',
    workspaceDirs: ['/work/shared', '/work/schemas'], sessionAdditionalDirs: [], additionalDirectories: [],
  }], SCOPE)

  expect(report.projectDirs).toEqual(['/work/shared', '/work/schemas'])
})

test('another session’s dirs never repaint this one', () => {
  // A project-scoped write reports whichever session the desktop has active.
  // Trusting it would show this device folders that belong to someone else.
  const report = additionalDirsFromEvents([{
    type: 'additional_dirs_changed', projectPath: '/work/super-one', sessionId: 'session-9',
    workspaceDirs: ['/work/shared'], sessionAdditionalDirs: ['/scratch/theirs'], additionalDirectories: [],
  }], SCOPE)

  expect(report.sessionDirs).toBeUndefined()
  expect(report.projectDirs).toEqual(['/work/shared'])
})

test('an event naming this session is the one that repaints it', () => {
  const report = additionalDirsFromEvents([{
    type: 'additional_dirs_changed', projectPath: '/work/super-one', sessionId: 'session-1',
    workspaceDirs: ['/work/shared'], sessionAdditionalDirs: ['/scratch/mine'], additionalDirectories: [],
  }], SCOPE)

  expect(report.sessionDirs).toEqual(['/scratch/mine'])
})

test('opening a session reports the effective set, so the project half is subtracted', () => {
  const report = additionalDirsFromEvents([{
    type: 'init_ready', additionalDirectories: ['/work/shared', '/scratch/mine'],
  }], SCOPE)

  expect(report.sessionDirs).toEqual(['/scratch/mine'])
})

test('a session running with nothing of its own reads as empty, not as unknown', () => {
  const report = additionalDirsFromEvents([{
    type: 'init_ready', additionalDirectories: ['/work/shared'],
  }], SCOPE)

  expect(report.sessionDirs).toEqual([])
})

test('a malformed frame is skipped rather than clearing what is known', () => {
  const report = additionalDirsFromEvents(
    [null, 'nonsense', { type: 'init_ready' }, { type: 'additional_dirs_changed', projectPath: '/work/super-one' }],
    SCOPE,
  )

  expect(report).toEqual({})
})
