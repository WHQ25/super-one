import { describe, expect, it } from 'vitest'
import { artifactLinkLabel, resolveArtifactLink } from './artifact-link'

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
