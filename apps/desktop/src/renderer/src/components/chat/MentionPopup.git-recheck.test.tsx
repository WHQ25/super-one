/** @vitest-environment jsdom */

import { render, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/stores/app'
import { useChatStore } from '@/stores/chat'
import { MentionPopup } from './MentionPopup'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

describe('disabled @gh recheck', () => {
  it('probes again from the row and enables GitHub when gh answers', async () => {
    const root = `/work/gh-recheck-${Math.random().toString(16).slice(2)}`
    useAppStore.setState({ currentFolder: root, _worktrees: {} })
    useChatStore.setState({ activeProject: root })
    const getGitMentionCapabilities = vi.fn(async (_folder: string, refresh?: boolean) => (
      refresh ? { repo: 'ready' as const, github: true } : { repo: 'ready' as const, github: false }
    ))
    Object.assign(window.environment, {
      listDirectory: vi.fn(async () => []),
      searchMentions: vi.fn(async () => []),
      searchSessionsByTitle: vi.fn(async () => []),
      getMentionCatalog: vi.fn(async () => ({ capabilityIds: [], apps: [], environments: [] })),
      listRemoteCollabProfiles: vi.fn(async () => []),
    })
    Object.assign(window.app, {
      getGitMentionCapabilities,
      listGitMentionRefs: vi.fn(async () => ({ ok: true, refs: [] })),
      getAppSettings: vi.fn(async () => ({ cdpEnabled: false, computerUseEnabled: false })),
      listComputerUseInstalledApps: vi.fn(async () => []),
    })

    const view = render(
      <MentionPopup query="g" selectedIndex={0} onSelect={() => {}} onSetSelectedIndex={() => {}} onClose={() => {}} />,
    )
    const recheck = await view.findByRole('button', { name: 'chat.mentionPopup.recheckCapabilities' })
    expect(getGitMentionCapabilities).toHaveBeenCalledWith(root)
    await userEvent.setup().click(recheck)
    await waitFor(() => expect(view.queryByRole('button', { name: 'chat.mentionPopup.recheckCapabilities' })).toBeNull())
    expect(getGitMentionCapabilities).toHaveBeenCalledWith(root, true)
    expect(view.getByRole('button', { name: /capabilityGh/ })).toBeEnabled()
  })
})
