import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPluginProtocolHandler } from './plugin-protocol'

let pluginRoot: string

beforeEach(async () => {
  pluginRoot = await realpath(await mkdtemp(join(tmpdir(), 'dsh-proto-')))
})

afterEach(async () => {
  await rm(pluginRoot, { recursive: true, force: true })
})

async function seedPlugin(
  id: string,
  pkgName: string,
  files: Record<string, string>,
  disabled = false,
): Promise<string> {
  const pkgDir = join(pluginRoot, 'node_modules', ...pkgName.split('/'))
  await mkdir(pkgDir, { recursive: true })
  await writeFile(join(pkgDir, 'package.json'), JSON.stringify({ name: pkgName, version: '1.0.0' }))
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(pkgDir, ...rel.split('/'))
    await mkdir(join(abs, '..'), { recursive: true })
    await writeFile(abs, content, 'utf8')
  }
  await writeFile(
    join(pluginRoot, 'registry.json'),
    JSON.stringify({
      version: 1,
      plugins: [{ id, name: pkgName, version: '1.0.0', ...(disabled ? { disabled: true } : {}) }],
    }),
  )
  return pkgDir
}

describe('superone-plugin:// protocol handler', () => {
  it('serves JS and CSS assets for scoped packages with exact MIME, CORS, and no-store', async () => {
    await seedPlugin('@acme/dsh-ui', '@acme/dsh-ui', {
      'dist/client.js': 'export const ok = true;\n',
      'dist/client.css': '.x { color: red; }\n',
    })
    const handler = createPluginProtocolHandler(() => pluginRoot, { devRendererUrl: () => undefined })

    const jsRes = await handler(
      new Request('superone-plugin://pkg/%40acme%2Fdsh-ui/dist/client.js?v=1.0.0-123', {
        headers: { origin: 'superone-renderer://app' },
      }),
    )
    expect(jsRes.status).toBe(200)
    expect(jsRes.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
    expect(jsRes.headers.get('access-control-allow-origin')).toBe('superone-renderer://app')
    expect(jsRes.headers.get('cache-control')).toBe('no-store')
    expect(await jsRes.text()).toBe('export const ok = true;\n')

    const cssRes = await handler(
      new Request('superone-plugin://pkg/%40acme%2Fdsh-ui/dist/client.css', {
        headers: { referer: 'superone-renderer://app/index.html' },
      }),
    )
    expect(cssRes.status).toBe(200)
    expect(cssRes.headers.get('content-type')).toBe('text/css; charset=utf-8')
  })

  it('allows dev ELECTRON_RENDERER_URL origin and rejects miniapp/mcp-app/opaque origins', async () => {
    await seedPlugin('sample', 'sample', { 'dist/client.js': 'export {}\n' })
    const handler = createPluginProtocolHandler(() => pluginRoot, {
      devRendererUrl: () => 'http://localhost:5173',
    })

    const devOk = await handler(
      new Request('superone-plugin://pkg/sample/dist/client.js', {
        headers: { origin: 'http://localhost:5173' },
      }),
    )
    expect(devOk.status).toBe(200)
    expect(devOk.headers.get('access-control-allow-origin')).toBe('http://localhost:5173')

    for (const badHeaders of [
      { origin: 'superone-app://my-app' },
      { origin: 'superone-mcp-app://abc' },
      { origin: 'null' },
      { origin: 'https://evil.example' },
      {},
    ]) {
      const denied = await handler(
        new Request('superone-plugin://pkg/sample/dist/client.js', { headers: badHeaders }),
      )
      expect(denied.status).toBe(403)
    }
  })

  it('returns 404 for disabled plugins, traversal, disallowed extensions, and escaping symlinks', async () => {
    const pkgDir = await seedPlugin('sample', 'sample', {
      'dist/client.js': 'export {}\n',
      'src/secret.ts': 'export const secret = 1\n',
    })
    const outside = await realpath(await mkdtemp(join(tmpdir(), 'dsh-outside-')))
    try {
      await writeFile(join(outside, 'leak.js'), 'leak\n')
      await symlink(join(outside, 'leak.js'), join(pkgDir, 'dist', 'leak.js'))

      const handler = createPluginProtocolHandler(() => pluginRoot, { devRendererUrl: () => undefined })
      const req = (path: string) =>
        handler(new Request(path, { headers: { origin: 'superone-renderer://app' } }))

      expect((await req('superone-plugin://pkg/sample/dist/..%2F..%2Fregistry.json')).status).toBe(404)
      expect((await req('superone-plugin://pkg/sample/src/secret.ts')).status).toBe(404)
      expect((await req('superone-plugin://pkg/sample/dist/leak.js')).status).toBe(404)
      expect((await req('superone-plugin://other/sample/dist/client.js')).status).toBe(404)

      await seedPlugin('sample', 'sample', { 'dist/client.js': 'export {}\n' }, true)
      expect((await req('superone-plugin://pkg/sample/dist/client.js')).status).toBe(404)
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })

  it('supports symlinked local dev package directory', async () => {
    const devDir = await realpath(await mkdtemp(join(tmpdir(), 'dsh-dev-pkg-')))
    try {
      await mkdir(join(devDir, 'dist'), { recursive: true })
      await writeFile(join(devDir, 'package.json'), JSON.stringify({ name: 'dev-pkg', version: '0.1.0' }))
      await writeFile(join(devDir, 'dist', 'client.js'), 'export const dev = 1;\n')
      await mkdir(join(pluginRoot, 'node_modules'), { recursive: true })
      await symlink(devDir, join(pluginRoot, 'node_modules', 'dev-pkg'))
      await writeFile(
        join(pluginRoot, 'registry.json'),
        JSON.stringify({ version: 1, plugins: [{ id: 'dev-pkg', name: 'dev-pkg', version: '0.1.0' }] }),
      )

      const handler = createPluginProtocolHandler(() => pluginRoot, { devRendererUrl: () => undefined })
      const res = await handler(
        new Request('superone-plugin://pkg/dev-pkg/dist/client.js', {
          headers: { origin: 'superone-renderer://app' },
        }),
      )
      expect(res.status).toBe(200)
      expect(await res.text()).toBe('export const dev = 1;\n')
    } finally {
      await rm(devDir, { recursive: true, force: true })
    }
  })
})
