import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { SUPERONE_SHARED_MODULES } from './build'

const tempDirs: string[] = []
const BUILD_HELPER_PATH = resolve(__dirname, './build.ts')
const SAMPLE_ENTRY = resolve(__dirname, '../../deepseek/src/fixtures/sample-ui-plugin/src/client.tsx')

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('@superone/plugin-sdk build helper', () => {
  it('rewrites shared modules to __SUPERONE_SHARED__ while bundling lucide-react icons inline', async () => {
    const outdir = await mkdtemp(join(tmpdir(), 'superone-plugin-build-'))
    tempDirs.push(outdir)

    execFileSync(
      'bun',
      [
        '-e',
        `import { buildPluginClient } from ${JSON.stringify(BUILD_HELPER_PATH)}; const r = await buildPluginClient({ entrypoints: [${JSON.stringify(SAMPLE_ENTRY)}], outdir: ${JSON.stringify(outdir)} }); if (!r.success) { console.error(r.logs); process.exit(1); }`,
      ],
      { stdio: 'pipe', env: { ...process.env, NODE_ENV: 'production' } },
    )

    const built = await readFile(join(outdir, 'client.js'), 'utf8')

    expect(built).toContain('__SUPERONE_SHARED__')
    expect(built).toContain('"react"')
    expect(built).toContain('"react/jsx-runtime"')
    expect(built).toContain('"@superone/plugin-sdk"')
    expect(built).toContain('"@superone/ui/components/ui/button"')
    expect(built).toContain('"@superone/ui/components/ui/badge"')
    expect(built).not.toContain('"lucide-react"')
    expect(SUPERONE_SHARED_MODULES).toContain('@superone/client-kernel')
    expect(SUPERONE_SHARED_MODULES).toContain('@superone/client-kernel/react')
    expect(SUPERONE_SHARED_MODULES).not.toContain('lucide-react')
  })
})
