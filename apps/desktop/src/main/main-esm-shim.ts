/**
 * electron-vite appends `__dirname` and `require` after the last `import` its
 * regex sees. Once `@noble/ciphers` is in the main chunk, a JSDoc example
 * (`import { gcm } from '@noble/ciphers/aes.js'`) is that match, so the shim
 * lands in the comment and esbuild strips it. Startup then throws
 * `ReferenceError: __dirname is not defined` at
 * `registerRendererProtocol(join(__dirname, '../renderer'))`. This runs from
 * `generateBundle`, after that pass, and only adds bindings that are still missing.
 */

// `$` so `const require$1` is not treated as a binding for `require`.
const BINDING = /^(?:const|let|var|function)\s+(?<name>__dirname|__filename|require)(?![\w$])/gm

function bindings(code: string): Set<string> {
  const names = new Set<string>()
  for (const match of code.matchAll(BINDING)) {
    if (match.groups?.name) names.add(match.groups.name)
  }
  return names
}

/** Offset just after the leading import declarations, skipping a hashbang and comments. */
export function leadingImportEnd(code: string): number {
  let i = 0
  const len = code.length
  if (code.startsWith('#!')) {
    const nl = code.indexOf('\n')
    i = nl === -1 ? len : nl + 1
  }
  while (i < len) {
    const ch = code[i]
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i += 1
      continue
    }
    if (code.startsWith('//', i)) {
      const nl = code.indexOf('\n', i)
      i = nl === -1 ? len : nl + 1
      continue
    }
    if (code.startsWith('/*', i)) {
      const end = code.indexOf('*/', i + 2)
      i = end === -1 ? len : end + 2
      continue
    }
    if (!code.startsWith('import', i)) break
    const next = code[i + 'import'.length]
    if (next !== ' ' && next !== '\n' && next !== '\t' && next !== '\r' && next !== '{' && next !== '*' && next !== '"' && next !== "'") {
      break
    }
    let quote: '"' | "'" | '`' | null = null
    let j = i + 'import'.length
    while (j < len) {
      const cur = code[j]
      if (quote) {
        if (cur === '\\') {
          j += 2
          continue
        }
        if (cur === quote) quote = null
        j += 1
        continue
      }
      if (cur === '"' || cur === "'" || cur === '`') {
        quote = cur
        j += 1
        continue
      }
      if (cur === ';') {
        j += 1
        break
      }
      j += 1
    }
    i = j
  }
  return i
}

/**
 * Define `__dirname` and a CommonJS `require` when the chunk uses them and no
 * top-level binding exists yet. An `import` inside a template string is ignored.
 */
export function injectMainEsmShim(code: string): string {
  const needsDirname = /(?<![\w$.])__dirname\b/.test(code)
  const needsFilename = /(?<![\w$.])__filename\b/.test(code)
  // String calls and `require.resolve`. A method named `require` is not a call.
  const needsRequire = /(?<![\w$.])require\s*(?:\(\s*['"`]|\.resolve\s*\()/.test(code)
  if (!needsDirname && !needsFilename && !needsRequire) return code
  const bound = bindings(code)
  const lines: string[] = []
  if ((needsDirname && !bound.has('__dirname')) || (needsFilename && !bound.has('__filename'))) {
    if (needsFilename && !bound.has('__filename')) lines.push('const __filename = import.meta.filename;')
    if (needsDirname && !bound.has('__dirname')) lines.push('const __dirname = import.meta.dirname;')
  }
  if (needsRequire && !bound.has('require')) {
    lines.unshift("import { createRequire as __cjs_createRequire } from 'node:module';")
    lines.push('const require = __cjs_createRequire(import.meta.url);')
  }
  if (lines.length === 0) return code
  const at = leadingImportEnd(code)
  const shim = `${lines.join('\n')}\n`
  return code.slice(0, at) + shim + code.slice(at)
}
