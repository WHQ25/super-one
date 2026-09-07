import { describe, expect, it } from 'vitest'
import { browseItems, filterBrowseItems, requestDirectory } from './mention-browse'

function fakeClient(reply: unknown) {
  const sent: Record<string, unknown>[] = []
  return {
    sent,
    client: {
      request: async (command: unknown) => {
        sent.push(command as Record<string, unknown>)
        return reply
      },
    },
  }
}

const entries = [
  { name: 'src', isDirectory: true },
  { name: 'node_modules', isDirectory: true },
  { name: 'README.md', isDirectory: false },
]

describe('browseItems', () => {
  it('keeps rows navigable by prefixing the directory they came from', () => {
    expect(browseItems([{ name: 'ui', isDirectory: true }], 'src/')).toEqual([
      { kind: 'dir-entry', path: 'src/ui', isDirectory: true, label: 'ui' },
    ])
  })
})

describe('requestDirectory', () => {
  it('asks the host to apply gitignore and resolves the path against the root', async () => {
    const { client, sent } = fakeClient({ items: entries, appliedIgnoreMode: 'gitignore' })
    await requestDirectory(client, '/work/app', 'src/')
    expect(sent[0]).toMatchObject({ type: 'list_directory', path: '/work/app/src', ignoreMode: 'gitignore', showHidden: true })
  })

  it('trusts a host that says it filtered', async () => {
    const { client } = fakeClient({ items: entries, appliedIgnoreMode: 'gitignore' })
    const { items } = await requestDirectory(client, '/work/app', '')
    expect(items.map((item) => item.path)).toEqual(['src', 'node_modules', 'README.md'])
  })

  it('applies the fixed exclusions itself when the host is too old to have filtered', async () => {
    // No `appliedIgnoreMode` means the reply is unfiltered, and a phone has no
    // keyboard to scroll past a dependency tree.
    const { client } = fakeClient({ items: entries })
    const { items } = await requestDirectory(client, '/work/app', '')
    expect(items.map((item) => item.path)).toEqual(['src', 'README.md'])
  })

  it('reports a directory it could not read instead of showing it as empty', async () => {
    const { client } = fakeClient({ error: 'ENOENT' })
    expect(await requestDirectory(client, '/work/app', 'gone/')).toEqual({ items: [], error: 'ENOENT' })
  })

  it('survives a reply with no items at all', async () => {
    const { client } = fakeClient({})
    expect(await requestDirectory(client, '/work/app', '')).toEqual({ items: [] })
  })
})

describe('filterBrowseItems', () => {
  const items = browseItems(entries, 'src/')

  it('matches on the visible name, not the prefixed path', () => {
    // `src/` is in every path; matching it would return the whole listing.
    expect(filterBrowseItems(items, 'src').map((item) => item.label)).toEqual(['src'])
  })

  it('keeps everything for an empty needle', () => {
    expect(filterBrowseItems(items, '  ')).toHaveLength(3)
  })
})
