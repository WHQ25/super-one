/** @vitest-environment jsdom */

import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/stores/app'
import { MentionPopup } from './MentionPopup'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

const ROOT = '/work/app'

describe('MentionPopup file fallback', () => {
  beforeEach(() => {
    useAppStore.setState({ currentFolder: ROOT, _worktrees: {} })
  })

  it('searches the whole query when a browsed directory is missing', async () => {
    const listDirectory = vi.fn(async () => [])
    const searchMentions = vi.fn(async () => [
      { kind: 'file' as const, path: 'docs/features/composer.md', isDirectory: false, matchIndices: [5, 6, 7, 8], score: 0 },
    ])
    Object.assign(window.environment, {
      listDirectory,
      searchMentions,
      searchSessionsByTitle: vi.fn(async () => []),
    })
    Object.assign(window.app, {
      getGitMentionCapabilities: vi.fn(async () => ({ repo: 'not-repo', github: false })),
    })

    const { container } = render(
      <MentionPopup
        query="feat/"
        selectedIndex={0}
        onSelect={() => {}}
        onSetSelectedIndex={() => {}}
        onClose={() => {}}
      />,
    )

    await waitFor(() => expect(searchMentions).toHaveBeenCalled())
    expect(listDirectory).toHaveBeenCalledWith(ROOT, 'feat/')
    expect(searchMentions.mock.calls[0]?.slice(0, 2)).toEqual([ROOT, 'feat/'])
    expect(searchMentions.mock.calls[0]).toHaveLength(4)
    await waitFor(() => expect(container.textContent).toContain('docs/features/composer.md'))
  })

  it('keeps a real directory listing and does not search files', async () => {
    const listDirectory = vi.fn(async () => [{ name: 'nested.ts', isDirectory: false }])
    const searchMentions = vi.fn(async () => [])
    Object.assign(window.environment, {
      listDirectory,
      searchMentions,
      searchSessionsByTitle: vi.fn(async () => []),
    })
    Object.assign(window.app, {
      getGitMentionCapabilities: vi.fn(async () => ({ repo: 'not-repo', github: false })),
    })

    const { container } = render(
      <MentionPopup
        query="src/"
        selectedIndex={0}
        onSelect={() => {}}
        onSetSelectedIndex={() => {}}
        onClose={() => {}}
      />,
    )

    await waitFor(() => expect(container.textContent).toContain('nested.ts'))
    expect(searchMentions).not.toHaveBeenCalled()
  })

  it('retries an empty scoped search and keeps the fallback path whole', async () => {
    const searchMentions = vi.fn(async (_root: string, _needle: string, _agents: unknown, _dirs: unknown, scope?: string) => {
      if (scope) return []
      return [{ kind: 'file' as const, path: 'notes/src-nope.md', isDirectory: false, matchIndices: [], score: 0 }]
    })
    Object.assign(window.environment, {
      listDirectory: vi.fn(async () => []),
      searchMentions,
      searchSessionsByTitle: vi.fn(async () => []),
    })
    Object.assign(window.app, {
      getGitMentionCapabilities: vi.fn(async () => ({ repo: 'not-repo', github: false })),
    })

    const { container } = render(
      <MentionPopup
        query="src/nope"
        selectedIndex={0}
        onSelect={() => {}}
        onSetSelectedIndex={() => {}}
        onClose={() => {}}
      />,
    )

    await waitFor(() => expect(container.textContent).toContain('notes/src-nope.md'))
    expect(searchMentions.mock.calls.map((call) => [call[1], call[4]])).toEqual([
      ['nope', 'src/'],
      ['src/nope', undefined],
    ])
  })
})
