import { boundedToolAppAttachment, MCP_APP_DATA_MAX_BYTES } from './mcp-apps'
import { describe, expect, it } from 'vitest'
import { mcpAppIcon, mcpAppPresentation, mcpAppResourceMeta, mcpAppResourceModes, safeMcpAppImage } from './mcp-apps-metadata'

describe('MCP App presentation metadata', () => {
  it('uses tool title then annotation title then name', () => {
    expect(mcpAppPresentation({ name: 'cad.library', title: 'Library', annotations: { title: 'Old' } }).toolTitle).toBe('Library')
    expect(mcpAppPresentation({ name: 'cad.library', annotations: { title: 'Old' } }).toolTitle).toBe('Old')
    expect(mcpAppPresentation({ name: 'cad.library', title: '' }).toolTitle).toBe('cad.library')
  })
  it('selects safe images and matching themes without interpreting SVG markup', () => {
    const svg = 'data:image/svg+xml,%3Csvg/%3E'
    expect(mcpAppIcon([{ src: 'javascript:alert(1)' }, { src: svg }])).toBe(svg)
    expect(mcpAppIcon([{ src: 'https://example.com/light.png', theme: 'light' }, { src: 'https://example.com/dark.png', theme: 'dark' }], 'dark')).toBe('https://example.com/dark.png')
    for (const src of ['file:///secret', 'http://example.com/icon', 'data:text/html,<svg>', '<svg onload="alert(1)">', 'https://user:pass@example.com/a']) expect(safeMcpAppImage(src)).toBeUndefined()
  })
  it('keeps OpenAI resource metadata beside stable UI fields', () => {
    const meta = mcpAppResourceMeta({ ui: { prefersBorder: true }, 'openai/ui': { preferredDisplayMode: 'fullscreen', availableDisplayModes: ['inline', 'fullscreen'] } })
    expect(meta.prefersBorder).toBe(true)
    expect(mcpAppResourceModes(meta)).toEqual(['inline', 'fullscreen'])
    expect(mcpAppResourceModes({ 'openai/ui': { preferredDisplayMode: 'inline' } })).toEqual(['inline'])
    expect(mcpAppResourceModes({})).toBeUndefined()
  })
})

it('drops oversized icons and persists only the winning image for each theme', () => {
  const big = 'data:image/png;base64,' + 'a'.repeat(33 * 1024)
  const presentation = mcpAppPresentation({ name: 'library', icons: [{ src: big }, { src: 'https://example.com/light.png', theme: 'light' }, { src: 'https://example.com/dark.png', theme: 'dark' }, { src: 'https://example.com/unused.png' }] })
  expect(presentation).toEqual({ toolTitle: 'library', icons: [{ src: 'https://example.com/light.png', theme: 'light' }, { src: 'https://example.com/dark.png', theme: 'dark' }] })
  const app = boundedToolAppAttachment({ appInstanceId: 'v', binding: { node: 'local', session: 's', server: 'cad', configGeneration: 0, configFingerprint: 'x' }, resourceUri: 'ui://cad', status: 'result', toolResult: { content: [{ type: 'text', text: 'x'.repeat(MCP_APP_DATA_MAX_BYTES - 100) }] }, presentation: { toolTitle: 'library', serverIcons: [{ src: big }] } })
  expect(app.status).toBe('result')
  expect(app.presentation).toEqual({ toolTitle: 'library' })
})
