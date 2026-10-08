import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

/**
 * The phone link crypto (noble via relay-client) must stay out of the eager
 * main chunk: electron-vite's ESM shim mistakes a noble JSDoc `import` for the
 * last static import and the built main then throws on `__dirname`. The
 * startup-imported modules may reference it only as types or `import()`.
 */
it('keeps the phone link crypto out of startup-imported modules', () => {
  for (const file of ['../remote-control-service.ts', '../lan-server.ts', '../relay-file-uploader.ts']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8')
    const valueImports = source.match(/^import\s+(?!type\b)[^\n]*from\s+'(@superone\/relay-client[^']*|\.\/remote\/phone-link-host|\.\/phone-link-host)'/gm) ?? []
    expect(valueImports, file).toEqual([])
  }
})
