import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { getIconForFile, getIconForFolder, DefaultFileIcon, DefaultFolderIcon } from '@react-symbols/icons/utils'
import ts from 'typescript'

// Use the installed desktop package as the authority, including its matching
// behavior. No Symbols React/DOM code is loaded by Metro at runtime.
const sourcePath = import.meta.resolve('@react-symbols/icons/utils').replace(/^file:\/\//, '')
const source = ts.createSourceFile(sourcePath, readFileSync(sourcePath, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
const keys = new Set<string>()
function visit(node: ts.Node) {
  if (ts.isPropertyAssignment(node) && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) || ts.isNumericLiteral(node.name))) {
    keys.add(node.name.text)
  }
  ts.forEachChild(node, visit)
}
visit(source)
if (keys.size < 100) throw new Error('Symbols mapping format changed; inspect the installed package before generating')

const artwork: Record<string, string> = {}
function register(element: Parameters<typeof renderToStaticMarkup>[0]): string {
  const svg = renderToStaticMarkup(element)
  if (!svg.startsWith('<svg')) throw new Error('Expected standalone SVG artwork')
  const id = createHash('sha256').update(svg).digest('hex').slice(0, 16)
  artwork[id] = svg
  return id
}
const defaultFile = register(createElement(DefaultFileIcon))
const defaultFolder = register(createElement(DefaultFolderIcon))
const files: Record<string, string> = {}
const extensions: Record<string, string> = {}
const folders: Record<string, string> = {}
for (const key of [...keys].sort()) {
  const file = register(getIconForFile({ fileName: key, autoAssign: true }))
  const extension = register(getIconForFile({ fileName: `__superone_probe__.${key}`, autoAssign: false }))
  const folder = register(getIconForFolder({ folderName: key }))
  if (file !== defaultFile) files[key.toLowerCase()] = file
  if (extension !== defaultFile) extensions[key.toLowerCase()] = extension
  if (folder !== defaultFolder) folders[key] = folder
}
const output = `${JSON.stringify({ defaultFile, defaultFolder, files, extensions, folders, artwork })}\n`
const target = resolve(import.meta.dirname, '../src/ui/file-icons.generated.json')
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== output) throw new Error('File icons are stale. Run bun scripts/generate-file-icons.ts')
} else {
  writeFileSync(target, output)
}
console.log(`Symbols: ${Object.keys(artwork).length} SVGs, ${Object.keys(files).length} filenames, ${Object.keys(extensions).length} suffixes, ${Object.keys(folders).length} folders`)
