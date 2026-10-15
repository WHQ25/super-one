import { describe, expect, it } from 'vitest'
import { artifactLinkLabel, parseArtifactList, resolveArtifactLink } from './artifact-link'

describe('artifactLinkLabel', () => {
  it('drops the scheme and a trailing slash so the label fits a tool row', () => {
    expect(artifactLinkLabel('https://claude.ai/public/artifacts/8f2a1c')).toBe('claude.ai/public/artifacts/8f2a1c')
    expect(artifactLinkLabel('https://www.example.com/')).toBe('example.com')
  })

  it('returns unparseable input unchanged', () => {
    expect(artifactLinkLabel('not a url')).toBe('not a url')
  })
})

describe('resolveArtifactLink', () => {
  it('prefers the published URL the result reports over any input url', () => {
    const link = resolveArtifactLink(
      { file_path: '/repo/report.html', url: 'https://claude.ai/public/artifacts/old' },
      JSON.stringify({ url: 'https://claude.ai/public/artifacts/new', path: '/repo/report.html', title: 'Q3 Report' }),
    )
    expect(link).toEqual({ url: 'https://claude.ai/public/artifacts/new', label: 'Q3 Report' })
  })

  it('labels a publish by its URL when the result carries no title', () => {
    const link = resolveArtifactLink({}, JSON.stringify({ url: 'https://claude.ai/public/artifacts/8f2a1c', path: '/x.html' }))
    expect(link?.label).toBe('claude.ai/public/artifacts/8f2a1c')
  })

  it('reads the published URL out of the CLI\'s plain-text publish result', () => {
    const result = 'Published /tmp/scratchpad/artifact-test.html at https://claude.ai/artifact/9aVirDdp2zQm7kXPpRjpfk (Version 1, version id 1792092641-f221) Icon: "flask".\n\nLive subscription: arming in the background.'
    expect(resolveArtifactLink({ action: 'publish', file_path: '/tmp/scratchpad/artifact-test.html' }, result))
      .toEqual({ url: 'https://claude.ai/artifact/9aVirDdp2zQm7kXPpRjpfk', label: 'claude.ai/artifact/9aVirDdp2zQm7kXPpRjpfk' })
  })

  it('names a published page by the title the host carried beside the text', () => {
    const result = 'Published /tmp/a.html at https://claude.ai/artifact/9aV (Version 2, version id 1792092654-bb15)'
    expect(resolveArtifactLink({ file_path: '/tmp/a.html', url: 'https://claude.ai/artifact/9aV' }, result, 'Artifact Tool Check'))
      .toEqual({ url: 'https://claude.ai/artifact/9aV', label: 'Artifact Tool Check' })
  })

  it('ignores URLs a non-publish text result merely mentions', () => {
    const result = '5 published artifacts (most recently opened or updated first):\n- (mine) Q3 — https://claude.ai/artifact/abc — updated 2026-10-15'
    expect(resolveArtifactLink({ action: 'list', limit: 5 }, result)).toBeNull()
  })

  it('links an uploaded asset by file name', () => {
    const link = resolveArtifactLink(
      { action: 'upload_asset', url: 'https://claude.ai/public/artifacts/8f2a1c', file_path: '/repo/cover.png' },
      JSON.stringify({ asset_upload: { id: 'a1', url: 'https://claude.ai/assets/a1', size_bytes: 10, content_type: 'image/png', file_name: 'cover.png' } }),
    )
    expect(link).toEqual({ url: 'https://claude.ai/assets/a1', label: 'cover.png' })
  })

  it('falls back to the artifact named in the input for actions whose result has no url', () => {
    const link = resolveArtifactLink(
      { action: 'delete_asset', url: 'https://claude.ai/public/artifacts/8f2a1c', asset_id: 'a1' },
      JSON.stringify({ asset_delete: { id: 'a1', deleted: true } }),
    )
    expect(link?.url).toBe('https://claude.ai/public/artifacts/8f2a1c')
  })

  it('links from the input alone, so a streaming call is already openable', () => {
    const link = resolveArtifactLink({ action: 'list_assets', url: 'https://claude.ai/public/artifacts/8f2a1c' }, null)
    expect(link?.url).toBe('https://claude.ai/public/artifacts/8f2a1c')
  })

  it('names a read page by its HTML title', () => {
    const result = '[Artifact 45765a9d (version 1792092641-f221) — owned by you, private; raw HTML follows]\n<!doctype html><html><head><title>Tools &amp; Checks</title></head></html>'
    expect(resolveArtifactLink({ action: 'read', url: 'https://claude.ai/artifact/9aV' }, result))
      .toEqual({ url: 'https://claude.ai/artifact/9aV', label: 'Tools & Checks' })
  })

  it('survives a non-JSON result instead of throwing', () => {
    expect(resolveArtifactLink({ url: 'https://claude.ai/public/artifacts/8f2a1c' }, 'Published.')?.url)
      .toBe('https://claude.ai/public/artifacts/8f2a1c')
  })

  it('offers nothing when no url is in reach, and never links a non-http value', () => {
    expect(resolveArtifactLink({ action: 'list' }, JSON.stringify({ artifacts: [] }))).toBeNull()
    expect(resolveArtifactLink({ url: 'javascript:alert(1)' }, null)).toBeNull()
    expect(resolveArtifactLink({}, JSON.stringify({ url: 'file:///etc/passwd' }))).toBeNull()
  })
})

describe('parseArtifactList', () => {
  it('turns the CLI listing into titled links with their update dates, keeping its notes', () => {
    const result = [
      '2 published artifacts (most recently opened or updated first):',
      '- (mine) SuperOne 浅色模式重设计 — https://claude.ai/artifact/BoutUGmzBpPhx6QMbSs4zo — updated 2026-08-20',
      '- (shared) (pinned) Deck — with — dashes — https://claude.ai/artifact/Wey3 — editor — updated 2026-07-27',
      '(More may exist: pass a higher `limit` (up to 100) to list them.)',
    ].join('\n')
    expect(parseArtifactList(result)).toEqual([
      { kind: 'note', text: '2 published artifacts (most recently opened or updated first):' },
      { kind: 'item', item: { url: 'https://claude.ai/artifact/BoutUGmzBpPhx6QMbSs4zo', label: 'SuperOne 浅色模式重设计', updated: '2026-08-20', tags: [] } },
      { kind: 'item', item: { url: 'https://claude.ai/artifact/Wey3', label: 'Deck — with — dashes', updated: '2026-07-27', tags: ['shared', 'pinned', 'editor'] } },
      { kind: 'note', text: '(More may exist: pass a higher `limit` (up to 100) to list them.)' },
    ])
  })

  it('reads the typed JSON output too, labelling an untitled row by its URL', () => {
    expect(parseArtifactList(JSON.stringify({ artifacts: [
      { title: '', url: 'https://claude.ai/artifact/abc', updatedAt: '2026-10-15T19:31:21Z', rel: 'shared', role: 'viewer' },
      { title: 'Bad', url: 'javascript:alert(1)' },
    ] }))).toEqual([
      { kind: 'item', item: { url: 'https://claude.ai/artifact/abc', label: 'claude.ai/artifact/abc', updated: '2026-10-15', tags: ['shared', 'viewer'] } },
    ])
  })

  it('returns null when nothing is a row, so the raw text still shows', () => {
    expect(parseArtifactList('No published artifacts yet.')).toBeNull()
    expect(parseArtifactList(JSON.stringify({ artifacts: [] }))).toBeNull()
  })
})
