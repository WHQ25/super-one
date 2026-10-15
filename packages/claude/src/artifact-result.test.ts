import { describe, expect, it } from 'vitest'
import { artifactResultTitle } from './artifact-result'

// Shapes captured from SDK 0.3.300 `tool_use_result` (Artifact publish, read).
const published = {
  url: 'https://claude.ai/artifact/9aVirDdp2zQm7kXPpRjpfk',
  path: '/private/tmp/scratchpad/artifact-test.html',
  title: 'Artifact Tool Check',
  updated: true,
  version: '1792092654-bb15',
}

describe('artifactResultTitle', () => {
  it('reads the title of a published or read page', () => {
    expect(artifactResultTitle('Artifact', published)).toBe('Artifact Tool Check')
    expect(artifactResultTitle('Artifact', { read: { url: published.url, title: ' Q3 Report ' }, owned: true })).toBe('Q3 Report')
  })

  it('ignores other tools, listings, and untitled results', () => {
    expect(artifactResultTitle('ArtifactData', published)).toBeUndefined()
    expect(artifactResultTitle('Artifact', { artifacts: [{ title: 'A', url: published.url }] })).toBeUndefined()
    expect(artifactResultTitle('Artifact', { url: published.url, title: '  ' })).toBeUndefined()
    expect(artifactResultTitle('Artifact', 'Published …')).toBeUndefined()
  })
})
