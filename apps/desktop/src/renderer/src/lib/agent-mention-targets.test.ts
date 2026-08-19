import { describe, it, expect, vi } from 'vitest'
import { listAgentMentionTargets } from './agent-mention-targets'

const LOCAL_TARGET = {
  ref: 'codex-base',
  providerId: 'codex-base',
  harnessId: 'codex' as const,
  slug: 'codex',
  aliases: ['gpt'],
  displayName: 'Codex',
  brandKey: 'codex',
  isBase: true,
}

describe('agent mention targets', () => {
  it('uses the desktop list for a local project', async () => {
    const localList = vi.fn().mockResolvedValue([LOCAL_TARGET])
    const remoteCollabProfiles = vi.fn()

    expect(await listAgentMentionTargets('/proj', { localList, remoteCollabProfiles }))
      .toEqual([LOCAL_TARGET])
    expect(remoteCollabProfiles).not.toHaveBeenCalled()
  })

  it("asks the node for a remote project, because that node's agentIds are the ones its launch validates", async () => {
    const localList = vi.fn()
    const remoteCollabProfiles = vi.fn().mockResolvedValue({
      agents: [
        { id: 'codex-base', name: 'Codex (Base)', harnessId: 'codex' },
        { id: 'acp-base', name: 'Others (ACP)', harnessId: 'acp', acpAgentId: 'grok-build' },
      ],
    })

    const targets = await listAgentMentionTargets('remote:conn-1:/srv/app', {
      localList,
      remoteCollabProfiles,
    })

    expect(localList).not.toHaveBeenCalled()
    expect(remoteCollabProfiles).toHaveBeenCalledWith('conn-1')
    expect(targets.map((t) => [t.ref, t.slug, t.displayName])).toEqual([
      ['codex-base', 'codex', 'Codex'],
      ['acp-base:grok-build', 'grok', 'Grok'],
    ])
  })

  it('drops the node\'s bare-harness alias rows so the popup shows each agent once', async () => {
    const remoteCollabProfiles = vi.fn().mockResolvedValue([
      { id: 'claude-base', name: 'Claude (Base)', harnessId: 'claude' },
      // The node aliases every base row under its bare harness id for legacy callers.
      { id: 'claude', name: 'claude', harnessId: 'claude' },
    ])

    const targets = await listAgentMentionTargets('remote:conn-1:/srv/app', {
      remoteCollabProfiles,
    })
    expect(targets.map((t) => t.providerId)).toEqual(['claude-base'])
  })

  it('degrades to an empty list rather than throwing when the node is unreachable', async () => {
    const remoteCollabProfiles = vi.fn().mockRejectedValue(new Error('offline'))
    expect(await listAgentMentionTargets('remote:conn-1:/srv/app', { remoteCollabProfiles }))
      .toEqual([])
  })
})
