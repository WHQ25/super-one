import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { injectMainEsmShim, leadingImportEnd } from './main-esm-shim'

function parses(code: string): void {
  const dir = mkdtempSync(join(tmpdir(), 'esm-shim-'))
  const file = join(dir, 'chunk.mjs')
  writeFileSync(file, code)
  execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' })
}

describe('injectMainEsmShim', () => {
  it('defines __dirname after the leading imports and before it is used', () => {
    const code = "import { join } from 'node:path';\nexport const root = join(__dirname, '../renderer')\n"
    const next = injectMainEsmShim(code)
    expect(next.indexOf('const __dirname = import.meta.dirname;')).toBeGreaterThan(code.indexOf("from 'node:path'"))
    expect(next.indexOf('const __dirname')).toBeLessThan(next.indexOf('join(__dirname'))
    parses(next)
  })

  it('does not treat an import inside a template as the end of the preamble', () => {
    const code = [
      "import { join } from 'node:path';",
      'const template = `',
      "import react from 'vite'",
      '`;',
      'export const root = join(__dirname, "renderer")',
      '',
    ].join('\n')
    const next = injectMainEsmShim(code)
    expect(leadingImportEnd(code)).toBe(code.indexOf('const template'))
    expect(next.indexOf('const __dirname')).toBeLessThan(next.indexOf('const template'))
    expect(next.indexOf("import react from 'vite'")).toBeGreaterThan(next.indexOf('const template'))
    parses(next)
  })

  it('keeps a multi-line import intact', () => {
    const code = "import {\n  join,\n} from 'node:path';\nexport const root = join(__dirname, '.')\n"
    const next = injectMainEsmShim(code)
    expect(next.startsWith("import {\n  join,\n} from 'node:path';\nconst __dirname")).toBe(true)
    parses(next)
  })

  it('adds require for a bare call and ignores a method named require', () => {
    const code = "import electron from 'electron';\nconst app = require('electron')\nthis.require(id)\n"
    const next = injectMainEsmShim(code)
    expect(next).toContain("import { createRequire as __cjs_createRequire } from 'node:module';")
    expect(next).toContain('const require = __cjs_createRequire(import.meta.url);')
    expect(next).not.toContain('const __dirname')
    parses(next)
    expect(injectMainEsmShim("export const rec = this.require(id)\n")).toBe("export const rec = this.require(id)\n")
    expect(injectMainEsmShim("export const api = { require(id) { return id } }\n")).toBe(
      "export const api = { require(id) { return id } }\n",
    )
  })

  it('still defines require when the chunk already has require$1', () => {
    const code = [
      "import { createRequire } from 'node:module';",
      'const require$1 = createRequire(import.meta.url);',
      'export const electron = require("electron")',
      '',
    ].join('\n')
    const next = injectMainEsmShim(code)
    expect(next).toContain('const require = __cjs_createRequire(import.meta.url);')
    expect(next.indexOf('const require =')).toBeLessThan(next.indexOf('require("electron")'))
    parses(next)
  })

  it('leaves a chunk alone when the bindings already exist', () => {
    const code = [
      "import { createRequire } from 'node:module';",
      'const __dirname = import.meta.dirname;',
      'const require = createRequire(import.meta.url);',
      'export const root = require(__dirname)',
      '',
    ].join('\n')
    expect(injectMainEsmShim(code)).toBe(code)
  })
})
