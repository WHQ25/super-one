import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SessionAgentLaunchProposal } from '@superone/shared/agent-types'
import { openNodeDatabase, type NodeDatabase } from '../db/database'
import { prepareLaunchStart, recordApprovedLaunch } from './start'
import { CollaborationStore } from './store'

let db: NodeDatabase
let store: CollaborationStore

beforeEach(() => {
  db = openNodeDatabase(':memory:')
  store = new CollaborationStore(db)
})

afterEach(() => {
  db.close()
})

const spawnLaunch: SessionAgentLaunchProposal = {
  launchId: 'reviewer',
  mode: 'spawn',
  agentId: 'claude-base',
  summary: 'Review the diff.',
  name: 'Ada',
  role: 'Reviewer',
  config: { cwd: '/repo' },
}

const linkLaunch: SessionAgentLaunchProposal = {
  launchId: 'sync',
  mode: 'link',
  agentId: '',
  sessionId: 'peer',
  summary: 'Agree on the API.',
  name: 'Peer',
  role: 'Peer',
  config: {},
}

describe('recordApprovedLaunch', () => {
  it('stores the approved labels without a task or secret', () => {
    const { grantId, approved } = recordApprovedLaunch(store, 'parent', spawnLaunch, spawnLaunch.config)
    expect(approved).toMatchObject({ launchId: 'reviewer', mode: 'spawn', title: 'Ada - Reviewer', reused: false })
    expect(approved).not.toHaveProperty('credential')
    expect(store.grantById(grantId)).toMatchObject({ task: '', task_sent: 0 })
  })

  it('re-points an existing link at the new launchId', () => {
    const first = recordApprovedLaunch(store, 'parent', linkLaunch, {})
    const second = recordApprovedLaunch(store, 'parent', { ...linkLaunch, launchId: 'sync-2' }, {})
    expect(second).toMatchObject({ grantId: first.grantId, approved: { reused: true, sessionId: 'peer' } })
    expect(store.grantForLaunch('parent', 'sync-2')?.grant_id).toBe(first.grantId)
  })
})

describe('prepareLaunchStart', () => {
  it('records the brief on first start and keeps it on retry', () => {
    const { grantId } = recordApprovedLaunch(store, 'parent', spawnLaunch, spawnLaunch.config)
    expect(() => prepareLaunchStart(store, 'parent', { launchId: 'reviewer' })).toThrow(/requires a non-empty task/)

    expect(prepareLaunchStart(store, 'parent', { launchId: 'reviewer', task: ' Check auth. ' }).task).toBe('Check auth.')
    expect(prepareLaunchStart(store, 'parent', { launchId: 'reviewer', task: 'Other' }).task).toBe('Check auth.')
    expect(prepareLaunchStart(store, 'parent', { launchId: 'reviewer' }).task).toBe('Check auth.')
    expect(store.grantById(grantId)?.task).toBe('Check auth.')
  })

  it('scopes launchIds to the requesting session', () => {
    recordApprovedLaunch(store, 'parent', spawnLaunch, spawnLaunch.config)
    expect(() => prepareLaunchStart(store, 'other', { launchId: 'reviewer', task: 't' })).toThrow(/No approved launch "reviewer"/)
    expect(() => prepareLaunchStart(store, 'parent', { task: 't' })).toThrow(/launchId is required/)
  })

  it('lets a link start without an opening message', () => {
    recordApprovedLaunch(store, 'parent', linkLaunch, {})
    expect(prepareLaunchStart(store, 'parent', { launchId: 'sync' })).toMatchObject({ kind: 'link', task: '' })
  })
})
