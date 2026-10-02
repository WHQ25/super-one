import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }))
import { hostFileApp, openHostFileApp, readHostFile, releaseHostFileApp, releaseHostFileApps, writeHostFile } from './host-files'
import { MCP_APP_RESOURCE_WRITE_MAX_BYTES } from '@superone/shared/mcp-app-files'

const ref = { environmentId: 'local', sessionId: 's' }
const app = { binding: { node: 'local', session: 's', server: 'cad', configGeneration: 0, configFingerprint: 'c' }, origin: { providerSessionId: 't' }, resourceUri: 'ui://cad/viewer' }
const dirs: string[] = []
function workspace(): { root: string; file: string; outside: string } {
  const root = mkdtempSync(path.join(tmpdir(), 'host-files-'))
  dirs.push(root)
  mkdirSync(path.join(root, 'project'))
  const file = path.join(root, 'project', 'part.stl')
  writeFileSync(file, 'solid part\nendsolid part\n')
  const outside = path.join(root, 'elsewhere.stl')
  writeFileSync(outside, 'solid other\n')
  return { root, file, outside }
}
afterEach(() => { releaseHostFileApps(ref); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

describe('host file Apps', () => {
  it('gives the View an opaque URI, never the path, and reads text or blob with an etag', async () => {
    const w = workspace()
    const entry = await openHostFileApp({ ref, projectPath: '/p', workspace: [path.join(w.root, 'project')], path: w.file, app })
    expect(entry.app.file).toEqual({ name: 'part.stl', resourceUri: expect.stringMatching(/^host-resource:\/\//) })
    expect(JSON.stringify(entry.app)).not.toContain(w.root)
    const text = await readHostFile(entry, entry.app.file.resourceUri, 'text')
    expect(text.contents[0]).toMatchObject({ text: 'solid part\nendsolid part\n', _meta: { 'openai/resource': { writable: true, etag: expect.any(String) } } })
    const blob = await readHostFile(entry, entry.app.file.resourceUri, 'blob')
    expect(Buffer.from(blob.contents[0]!.blob!, 'base64').toString()).toBe('solid part\nendsolid part\n')
    await expect(readHostFile(entry, 'host-resource://other')).rejects.toMatchObject({ code: 'denied' })
  })

  it('writes atomically with ifMatch, and reports conflicts and oversized content', async () => {
    const w = workspace()
    const entry = await openHostFileApp({ ref, projectPath: '/p', workspace: [path.join(w.root, 'project')], path: w.file, app })
    const uri = entry.app.file.resourceUri
    await expect(writeHostFile(entry, { uri, text: 'x' })).rejects.toMatchObject({ code: 'denied' }) // no writable read yet
    const etag = (await readHostFile(entry, uri)).contents[0]!._meta!['openai/resource'] as { etag: string }
    const saved = await writeHostFile(entry, { uri, text: 'solid edited\n', ifMatch: etag.etag })
    expect(saved).toMatchObject({ outcome: 'saved' })
    expect(readFileSync(w.file, 'utf8')).toBe('solid edited\n')
    await expect(writeHostFile(entry, { uri, text: 'stale', ifMatch: etag.etag })).resolves.toEqual({ outcome: 'conflict', etag: (saved as { etag: string }).etag })
    await expect(writeHostFile(entry, { uri, text: 'x'.repeat(MCP_APP_RESOURCE_WRITE_MAX_BYTES + 1) })).resolves.toEqual({ outcome: 'too-large', maxBytes: MCP_APP_RESOURCE_WRITE_MAX_BYTES })
    await expect(writeHostFile(entry, { uri: 'host-resource://other', text: 'x' })).rejects.toMatchObject({ code: 'denied' })
  })

  it('never makes a file outside the workspace writable', async () => {
    const w = workspace()
    const entry = await openHostFileApp({ ref, projectPath: '/p', workspace: [path.join(w.root, 'project')], path: w.outside, app })
    const read = await readHostFile(entry, entry.app.file.resourceUri)
    expect(read.contents[0]!._meta).toEqual({ 'openai/resource': { etag: expect.any(String), writable: false } })
    await expect(writeHostFile(entry, { uri: entry.app.file.resourceUri, text: 'x' })).rejects.toMatchObject({ code: 'denied' })
    expect(readFileSync(w.outside, 'utf8')).toBe('solid other\n')
  })

  it('is scoped to its session and released with it', async () => {
    const w = workspace()
    const entry = await openHostFileApp({ ref, projectPath: '/p', workspace: [w.root], path: w.file, app })
    expect(hostFileApp({ environmentId: 'local', sessionId: 'other' }, entry.app.appInstanceId)).toBeUndefined()
    expect(hostFileApp(ref, entry.app.appInstanceId)).toBe(entry)
    releaseHostFileApp(entry)
    expect(hostFileApp(ref, entry.app.appInstanceId)).toBeUndefined()
    await expect(openHostFileApp({ ref, projectPath: '/p', workspace: [w.root], path: 'relative.stl', app })).rejects.toMatchObject({ code: 'invalid' })
  })
})
