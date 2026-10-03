import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { McpAppExecutor, type McpAppExecutorPorts, type McpAppResolvedTarget } from './executor-core'
import { mcpAppDownloadName, saveMcpAppDownloads, type McpAppDownloadPorts } from './download-file'
import { MCP_APP_MIME_TYPE, MCP_APP_OUTPUT_MAX_BYTES, type McpAppDownloadContents, type McpAppRequester, type ToolAppAttachment } from '@superone/shared/mcp-apps'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
const signal = () => new AbortController().signal

function ports(overrides: Partial<McpAppDownloadPorts> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-download-'))
  dirs.push(dir)
  const chosen: string[] = []
  const value: McpAppDownloadPorts = {
    choosePath: vi.fn(async (name: string) => { chosen.push(name); return join(dir, name) }),
    read: vi.fn(async uri => ({ contents: [{ uri, mimeType: 'text/csv', text: 'a,b\n1,2' }] })),
    fetch: vi.fn(async () => new Response('%PDF-1.7')),
    ...overrides,
  }
  return { dir, chosen, ports: value }
}

describe('mcpAppDownloadName', () => {
  it('uses the file name of the URI, or a link name that is itself a file name', () => {
    expect(mcpAppDownloadName({ type: 'resource', resource: { uri: 'file:///hex%20bolt.stl', text: '' } })).toBe('hex bolt.stl')
    expect(mcpAppDownloadName({ type: 'resource_link', uri: 'https://api.example.com/reports/q4.pdf?sig=1', name: 'Q4 Report' })).toBe('q4.pdf')
    expect(mcpAppDownloadName({ type: 'resource_link', uri: 'https://example.com/r/1', name: 'summary.csv' })).toBe('summary.csv')
  })

  it('never yields a path, a hidden file or an empty name', () => {
    expect(mcpAppDownloadName({ type: 'resource', resource: { uri: 'file:///..%2F..%2Fetc%2Fpasswd', text: '' } })).toBe('_.._etc_passwd')
    expect(mcpAppDownloadName({ type: 'resource', resource: { uri: 'file:///.bashrc', text: '' } })).toBe('bashrc')
    expect(mcpAppDownloadName({ type: 'resource', resource: { uri: 'file:///', text: '' } })).toBe('download')
  })
})

describe('saveMcpAppDownloads', () => {
  it('writes embedded text and base64 blobs where the user chose', async () => {
    const { dir, chosen, ports: p } = ports()
    const contents: McpAppDownloadContents = [
      { type: 'resource', resource: { uri: 'file:///part.stl', mimeType: 'model/stl', text: 'solid part' } },
      { type: 'resource', resource: { uri: 'file:///thumb.png', mimeType: 'image/png', blob: Buffer.from([0x89, 0x50]).toString('base64') } },
    ]
    await expect(saveMcpAppDownloads(contents, p, signal())).resolves.toEqual({})
    expect(chosen).toEqual(['part.stl', 'thumb.png'])
    expect(readFileSync(join(dir, 'part.stl'), 'utf8')).toBe('solid part')
    expect([...readFileSync(join(dir, 'thumb.png'))]).toEqual([0x89, 0x50])
  })

  it('stops at the first cancel and reports isError, fetching nothing', async () => {
    const { ports: p } = ports({ choosePath: vi.fn(async () => null) })
    await expect(saveMcpAppDownloads([{ type: 'resource_link', uri: 'https://example.com/a.pdf', name: 'A' }, { type: 'resource', resource: { uri: 'file:///b', text: 'b' } }], p, signal()))
      .resolves.toEqual({ isError: true })
    expect(p.choosePath).toHaveBeenCalledTimes(1)
    expect(p.fetch).not.toHaveBeenCalled()
  })

  it('fetches http links without credentials and reads other links from the server', async () => {
    const { dir, ports: p } = ports()
    await saveMcpAppDownloads([{ type: 'resource_link', uri: 'https://example.com/q4.pdf', name: 'Q4' }, { type: 'resource_link', uri: 'cad://export/parts.csv', name: 'Parts' }], p, signal())
    expect(p.fetch).toHaveBeenCalledWith('https://example.com/q4.pdf', expect.objectContaining({ credentials: 'omit' }))
    expect(p.read).toHaveBeenCalledWith('cad://export/parts.csv', expect.any(AbortSignal))
    expect(readFileSync(join(dir, 'q4.pdf'), 'utf8')).toBe('%PDF-1.7')
    expect(readFileSync(join(dir, 'parts.csv'), 'utf8')).toBe('a,b\n1,2')
  })

  it('sends a link with credentials to the server, not the network', async () => {
    const creds = ports()
    await saveMcpAppDownloads([{ type: 'resource_link', uri: 'https://user:pw@example.com/a.txt', name: 'A' }], creds.ports, signal())
    expect(creds.ports.fetch).not.toHaveBeenCalled()
    expect(creds.ports.read).toHaveBeenCalled()
  })
})

const APP: ToolAppAttachment = { appInstanceId: 'view', binding: { node: 'local', session: 's', server: 'cad', configGeneration: 0, configFingerprint: 'c' },
  origin: { providerSessionId: 'thread' }, resourceUri: 'ui://cad/viewer', status: 'result' }
const CONTENTS: McpAppDownloadContents = [{ type: 'resource_link', uri: 'cad://export/parts.csv', name: 'Parts' }]

describe('MCP App host executor: downloadFile', () => {
  function setup() {
    const target: McpAppResolvedTarget = { ref: { environmentId: 'local', sessionId: 's' }, node: 'local', projectPath: '/project', messageId: 'm', app: APP }
    const provider = vi.fn<McpAppExecutorPorts['provider']>(async (_target, operation) => operation.operation === 'readResource'
      ? { ok: true, value: { contents: [{ uri: operation.uri, mimeType: 'text/csv', text: 'a,b' }] } }
      : { ok: true, value: { mode: 'native', resourceRead: true, toolCall: true } })
    const downloadFile = vi.fn<NonNullable<McpAppExecutorPorts['downloadFile']>>(async (_target, contents, read, abort) => { if (contents[0].type === 'resource_link') await read(contents[0].uri, abort); return {} })
    const executor = new McpAppExecutor({ resolve: vi.fn(async () => target), persist: vi.fn(), sendMessage: vi.fn(), provider, downloadFile })
    executor.observeLive(target.ref, APP)
    const run = (contents: unknown, requester: McpAppRequester = { kind: 'desktop' }) =>
      executor.execute({ sessionKey: 'local:s', appInstanceId: 'view', messageId: 'm', operation: 'downloadFile', contents } as never, requester, signal())
    return { executor, provider, downloadFile, run, target }
  }

  it('reads linked server resources through the View binding as transient reads', async () => {
    const s = setup()
    await expect(s.run(CONTENTS)).resolves.toEqual({ ok: true, value: {} })
    expect(s.provider).toHaveBeenCalledWith(s.target, { operation: 'readResource', uri: 'cad://export/parts.csv', transient: true }, expect.any(AbortSignal))
  })

  it('refuses the phone, empty or oversized batches and malformed items', async () => {
    const s = setup()
    s.executor.observeLive(s.target.ref, APP, { kind: 'mobile', deviceId: 'phone' })
    await expect(s.run(CONTENTS, { kind: 'mobile', deviceId: 'phone' })).resolves.toMatchObject({ ok: false, error: { code: 'denied' } })
    await expect(s.run([])).resolves.toMatchObject({ ok: false, error: { code: 'invalid' } })
    await expect(s.run(Array(9).fill(CONTENTS[0]))).resolves.toMatchObject({ ok: false, error: { code: 'invalid' } })
    await expect(s.run([{ type: 'text', text: 'not a resource' }])).resolves.toMatchObject({ ok: false })
    await expect(s.run([{ type: 'resource', resource: { uri: 'file:///v.html', mimeType: MCP_APP_MIME_TYPE } }])).resolves.toMatchObject({ ok: false })
    expect(s.downloadFile).not.toHaveBeenCalled()
  })

  it('does not bound embedded bytes by the transient View cap', async () => {
    const s = setup()
    const text = 'x'.repeat(MCP_APP_OUTPUT_MAX_BYTES + 1024)
    await expect(s.run([{ type: 'resource', resource: { uri: 'file:///big.txt', text } }])).resolves.toEqual({ ok: true, value: {} })
    expect(s.downloadFile).toHaveBeenCalledTimes(1)
  })
})
