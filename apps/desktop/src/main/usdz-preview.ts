import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { unzipSync, zipSync } from 'fflate'

const run = promisify(execFile)
const MAX_SOURCE_BYTES = 100 * 1024 * 1024
const MAX_EXPANDED_BYTES = 256 * 1024 * 1024
const MAX_PREVIEW_BYTES = 100 * 1024 * 1024
const IMAGE_EXTENSIONS = /\.(?:png|jpe?g|avif|webp)$/i
const SANDBOX_PROFILE = '(version 1) (allow default) (deny network*) (deny file-read* (subpath "/Users")) (deny file-read* (subpath "/Volumes")) (deny file-read* (subpath "/Network"))'

export interface UsdzVariantSet {
  name: string
  options: string[]
  selected: string
}

export interface UsdzPreviewResult {
  archive: Uint8Array
  variants: UsdzVariantSet[]
}

function validateArchive(bytes: Uint8Array): void {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_SOURCE_BYTES) throw new Error('USDZ exceeds preview size limit')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let end = -1
  for (let at = bytes.byteLength - 22; at >= Math.max(0, bytes.byteLength - 65_557); at--) {
    if (view.getUint32(at, true) === 0x06054b50) { end = at; break }
  }
  if (end < 0) throw new Error('Invalid USDZ archive')
  const count = view.getUint16(end + 10, true)
  let at = view.getUint32(end + 16, true)
  if (count > 2048 || at >= end) throw new Error('USDZ archive is too large')
  let total = 0
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || view.getUint32(at, true) !== 0x02014b50) throw new Error('Invalid USDZ archive')
    const expanded = view.getUint32(at + 24, true)
    if (expanded === 0xffffffff) throw new Error('ZIP64 USDZ archives are unsupported')
    total += expanded
    if (total > MAX_EXPANDED_BYTES) throw new Error('USDZ archive exceeds expanded size limit')
    at += 46 + view.getUint16(at + 28, true) + view.getUint16(at + 30, true) + view.getUint16(at + 32, true)
  }
}

/** USD's text form keeps root variant sets at one indentation level. */
export function inspectRootVariants(text: string): { root: string; variants: UsdzVariantSet[] } {
  const root = /\bdefaultPrim\s*=\s*"([A-Za-z_][A-Za-z_0-9]*)"/.exec(text)?.[1]
  if (!root) throw new Error('USDZ has no supported default prim')
  const rootHeaderEnd = text.indexOf('\n{\n')
  const rootHeader = rootHeaderEnd < 0 ? text.slice(0, 8192) : text.slice(0, rootHeaderEnd)
  const variants: UsdzVariantSet[] = []
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const name = /^    variantSet "([^"]+)" = \{$/.exec(lines[i])?.[1]
    if (!name) continue
    const options: string[] = []
    for (i++; i < lines.length && lines[i] !== '    }'; i++) {
      const value = /^        "([^"]+)"(?:\s|$)/.exec(lines[i])?.[1]
      if (value) options.push(value)
    }
    const selected = new RegExp(`\\bstring ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} = "([^"]+)"`).exec(rootHeader)?.[1]
    if (options.length > 0 && /^[A-Za-z_][A-Za-z_0-9]*$/.test(name)) {
      variants.push({ name, options, selected: selected && options.includes(selected) ? selected : options[0] })
    }
  }
  return { root, variants }
}

async function usdcat(input: string, output: string, flatten = false): Promise<void> {
  if (process.platform !== 'darwin') throw new Error('Native USDZ variants are available on macOS only')
  const args = ['-p', SANDBOX_PROFILE, '/usr/bin/usdcat', ...(flatten ? ['--flatten'] : []), input, '-o', output]
  await run('/usr/bin/sandbox-exec', args, { timeout: 30_000, maxBuffer: 1024 * 1024 })
  if ((await stat(output)).size > MAX_EXPANDED_BYTES) throw new Error('Composed USDZ exceeds expanded size limit')
}

function checkedSelections(variants: UsdzVariantSet[], selections: Record<string, string>): Record<string, string> {
  const selected: Record<string, string> = {}
  for (const [name, value] of Object.entries(selections)) {
    const set = variants.find((variant) => variant.name === name)
    if (!set || !set.options.includes(value)) throw new Error(`Unsupported USDZ variant: ${name}=${value}`)
    selected[name] = value
  }
  return selected
}

function wrapper(root: string, source: string, selections: Record<string, string>): string {
  const values = Object.entries(selections).map(([name, value]) => `        string ${name} = ${JSON.stringify(value)}`).join('\n')
  return `#usda 1.0\n(\n    defaultPrim = "${root}"\n    subLayers = [@${source}@]\n)\nover "${root}" (\n    variants = {\n${values}\n    }\n) {}\n`
}

/** Work around a USDAParser scope bug for MaterialX metadata in Apple exports. */
export function normalizeUsdaForThree(text: string): string {
  // Three treats this namespaced metadata opener as a dictionary entry and misses
  // its closing ')'. The MaterialX output is not used by Three's surface shader.
  return text.replace(/^([ \t]*token )outputs:mtlx:surface([ \t]+\()[ \t]*$/gm, '$1outputs_mtlx_surface$2')
}

function makePreview(flat: string, source: string, original: Uint8Array): Uint8Array {
  const entries = unzipSync(original)
  const packed: Record<string, Uint8Array> = {}
  let total = 0
  const reference = new RegExp(`@${source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\[([^\\]]+)\\]@`, 'g')
  const resolved = flat.replace(reference, (_all, internal: string) => {
    const data = entries[internal]
    if (!data || !IMAGE_EXTENSIONS.test(internal) || internal.startsWith('/') || internal.split('/').includes('..')) {
      throw new Error(`Unsupported USDZ texture: ${internal}`)
    }
    if (!packed[internal]) { packed[internal] = data; total += data.byteLength }
    return `@${internal}@`
  })
  const text = normalizeUsdaForThree(resolved)
  for (const match of text.matchAll(/@([^@\n]+)@/g)) {
    if (!packed[match[1]]) throw new Error('USDZ contains an unresolved external asset')
  }
  const stage = new TextEncoder().encode(text)
  total += stage.byteLength
  if (total > MAX_PREVIEW_BYTES) throw new Error('Composed USDZ exceeds preview size limit')
  const archive = zipSync({ 'preview.usda': stage, ...packed }, { level: 0 })
  if (archive.byteLength > MAX_PREVIEW_BYTES) throw new Error('Composed USDZ exceeds preview size limit')
  return archive
}

/** Compose the selected root variants without discarding the original stage. */
export async function composeUsdzPreview(input: Uint8Array, selections: Record<string, string> = {}): Promise<UsdzPreviewResult> {
  if (!(input instanceof Uint8Array)) throw new Error('USDZ data must be bytes')
  validateArchive(input)
  const dir = await mkdtemp(join(tmpdir(), 'superone-usdz-'))
  try {
    const source = join(dir, 'source.usdz')
    const rootUsda = join(dir, 'root.usda')
    const flatUsda = join(dir, 'preview.usda')
    await writeFile(source, input)
    await usdcat(source, rootUsda)
    const { root, variants } = inspectRootVariants(await readFile(rootUsda, 'utf8'))
    const selected = checkedSelections(variants, selections)
    const stageInput = Object.keys(selected).length ? join(dir, 'selection.usda') : source
    if (stageInput !== source) await writeFile(stageInput, wrapper(root, source, selected))
    await usdcat(stageInput, flatUsda, true)
    const archive = makePreview(await readFile(flatUsda, 'utf8'), source, input)
    return {
      archive,
      variants: variants.map((set) => ({ ...set, selected: selected[set.name] ?? set.selected })),
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
