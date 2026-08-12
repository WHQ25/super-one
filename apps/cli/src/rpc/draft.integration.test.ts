/**
 * draft.* RPC over a real node runtime — the remote half of environment-scoped
 * drafts. Drafts live on the node that owns the project, so these calls are the
 * only durable path for a remote draft.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { startNodeRuntime, type NodeRuntime } from '../runtime'
import { connectAuthedRpc } from '../test/ws-rpc'
import type { DraftRecord } from '@superone/shared/environment'

const dirs: string[] = []
const runtimes: NodeRuntime[] = []

afterEach(async () => {
  while (runtimes.length) {
    const rt = runtimes.pop()
    if (rt) await rt.stop().catch(() => {})
  }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

async function boot() {
  const nodeHome = mkdtempSync(join(tmpdir(), 'draft-node-'))
  const projectDir = mkdtempSync(join(tmpdir(), 'draft-proj-'))
  dirs.push(nodeHome, projectDir)
  const rt = await startNodeRuntime({
    nodeHome,
    bindHost: '127.0.0.1',
    bindPort: 0,
    simulatedHarness: true,
  })
  runtimes.push(rt)
  const client = await connectAuthedRpc(rt)
  return { rt, client, projectDir }
}

const listDrafts = async (
  client: Awaited<ReturnType<typeof connectAuthedRpc>>,
  projectPath?: string,
): Promise<DraftRecord[]> =>
  ((await client.rpc('draft.list', projectPath ? { projectPath } : {})) as { drafts: DraftRecord[] })
    .drafts

describe('draft RPC on a node', () => {
  it('upserts a draft, lists it back, and deletes it', async () => {
    const { client, projectDir } = await boot()

    const saved = (await client.rpc('draft.upsert', {
      id: 'draft-1',
      text: 'look into the pty startup failure\nsecond line',
      projectPath: projectDir,
      harness: 'codex',
      settings: {
        harness: 'codex',
        codexModel: 'gpt-5',
        codexReasoningEffort: 'medium',
        permissionMode: 'default',
        worktreePath: null,
        gitBranch: 'main',
        sandboxEnabled: false,
      },
    })) as { draft: DraftRecord }
    expect(saved.draft.title).toBe('look into the pty startup failure')
    expect(saved.draft.harness).toBe('codex')
    expect(saved.draft.settings.codexModel).toBe('gpt-5')
    expect(saved.draft.settings.gitBranch).toBe('main')

    expect((await listDrafts(client)).map((d) => d.id)).toEqual(['draft-1'])

    await client.rpc('draft.delete', { draftId: 'draft-1' })
    expect(await listDrafts(client)).toEqual([])
  })

  it('re-sending the same draft id updates the row instead of adding one', async () => {
    const { client } = await boot()
    await client.rpc('draft.upsert', { id: 'draft-1', text: 'first' })
    await client.rpc('draft.upsert', { id: 'draft-1', text: 'second' })
    const drafts = await listDrafts(client)
    expect(drafts).toHaveLength(1)
    expect(drafts[0].text).toBe('second')
  })

  it('keeps a draft whose project was never registered, so it survives project removal', async () => {
    const { client } = await boot()
    await client.rpc('draft.upsert', { id: 'draft-1', text: 'orphan', projectPath: '/gone/away' })
    const drafts = await listDrafts(client, '/gone/away')
    expect(drafts).toHaveLength(1)
    expect(drafts[0].projectPath).toBe('/gone/away')
  })

  it('rejects an upsert with no id', async () => {
    const { client } = await boot()
    await expect(client.rpc('draft.upsert', { text: 'x' })).rejects.toThrow(/id is required/)
  })
})
