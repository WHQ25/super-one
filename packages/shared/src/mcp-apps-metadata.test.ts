import { boundedToolAppAttachment, MCP_APP_DATA_MAX_BYTES } from './mcp-apps'
import { describe, expect, it } from 'vitest'
import { mcpAppHeaderTitle, mcpAppServerTitle, mcpAppIcon, mcpAppMonochromeSvg, mcpAppPresentation, mcpAppResourceMeta, mcpAppResourceModes, safeMcpAppImage } from './mcp-apps-metadata'

describe('MCP App presentation metadata', () => {
  it('shows identical resolved server/tool titles once on both host surfaces', () => {
    expect(mcpAppHeaderTitle('Bits & Bolts', 'Bits & Bolts')).toBe('Bits & Bolts')
    expect(mcpAppHeaderTitle('Bits & Bolts', ' Browse library ')).toBe('Bits & Bolts ·  Browse library ')
  })
  it('resolves the server source label with a binding fallback', () => {
    const binding = { server: 'bits-and-bolts' } as never
    expect(mcpAppServerTitle({ binding, presentation: { toolTitle: 'Library', serverTitle: 'Bits & Bolts' } })).toBe('Bits & Bolts')
    expect(mcpAppServerTitle({ binding, presentation: { toolTitle: 'Library', serverTitle: ' ' } })).toBe('bits-and-bolts')
    expect(mcpAppServerTitle({ binding })).toBe('bits-and-bolts')
  })
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

it('omits oversized initial results, preserves host state and rejects oversized inputs independently', () => {
  const base = { appInstanceId: 'v', binding: { node: 'local', session: 's', server: 'cad', configGeneration: 0, configFingerprint: 'x' }, resourceUri: 'ui://cad', status: 'result' as const, resource: { hash: 'a'.repeat(64), meta: {} }, presentation: { toolTitle: 'Library' }, modelContext: null }
  const result = { content: [{ type: 'text', text: 'x'.repeat(MCP_APP_DATA_MAX_BYTES) }] }
  const bounded = boundedToolAppAttachment({ ...base, toolInput: {}, toolResult: result })
  expect(bounded).toMatchObject({ ...base, toolResult: undefined, toolInput: {}, toolResultOmitted: { bytes: new TextEncoder().encode(JSON.stringify(result)).byteLength, reason: 'size_limit' } })
  expect(bounded.error).toBeUndefined()
  expect(boundedToolAppAttachment({ ...base, toolResult: { content: [{ type: 'text', text: 'raw fallback' }] }, toolResultOmitted: bounded.toolResultOmitted }).toolResult).toBeUndefined()
  expect(boundedToolAppAttachment({ ...base, toolInput: { x: 'x'.repeat(MCP_APP_DATA_MAX_BYTES) } })).toMatchObject({ status: 'error', error: { code: 'invalid' } })
})

describe('mcpAppMonochromeSvg', () => {
  const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${body}</svg>`
  const encoded = (body: string) => `data:image/svg+xml,${encodeURIComponent(svg(body))}`

  it('accepts one neutral hard-coded colour, currentColor and the default fill, in either encoding', () => {
    expect(mcpAppMonochromeSvg(encoded('<path fill="none" stroke="#27272a" d="M0 0"/>'))).toContain('#27272a')
    expect(mcpAppMonochromeSvg(encoded('<path fill="white"/>'))).toBeDefined()
    expect(mcpAppMonochromeSvg(encoded('<path style="fill:rgb(40,40,46)"/>'))).toBeDefined()
    expect(mcpAppMonochromeSvg(encoded('<path style="fill:currentColor" d="M0 0"/><path stroke="currentColor"/>'))).toBeDefined()
    expect(mcpAppMonochromeSvg(encoded('<path d="M0 0"/>'))).toBeDefined()
    expect(mcpAppMonochromeSvg(`data:image/svg+xml;base64,${btoa(svg('<path fill="#000"/>'))}`)).toBeDefined()
  })

  it('leaves brand-coloured, multi-colour, embedded raster, non-SVG and malformed icons alone', () => {
    expect(mcpAppMonochromeSvg(encoded('<path fill="#0ea5e9"/>'))).toBeUndefined()
    expect(mcpAppMonochromeSvg(encoded('<path fill="hsl(200 80% 50%)"/>'))).toBeUndefined()
    expect(mcpAppMonochromeSvg(encoded('<path fill="#7c3aed"/><path stroke="#fff"/>'))).toBeUndefined()
    expect(mcpAppMonochromeSvg(encoded('<image href="data:image/png;base64,AAAA"/>'))).toBeUndefined()
    expect(mcpAppMonochromeSvg('data:image/png;base64,AAAA')).toBeUndefined()
    expect(mcpAppMonochromeSvg('https://example.com/icon.svg')).toBeUndefined()
    expect(mcpAppMonochromeSvg('data:image/svg+xml,%E0%A4%A')).toBeUndefined()
  })
})
