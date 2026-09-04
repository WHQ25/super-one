import { readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

function inlineAsset(html: string, fileName: string, replacement: string): string {
  const escaped = fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return html
    .replace(
      new RegExp(`<script([^>]*?)src=["'](?:\\./|/)?${escaped}["']([^>]*)><\\/script>`),
      (_match, before: string, after: string) => `<script${before}${after}>${replacement}</script>`,
    )
    .replace(
      new RegExp(`<link([^>]*?)href=["'](?:\\./|/)?${escaped}["']([^>]*)>`),
      () => `<style>${replacement}</style>`,
    )
}

/** Turn a Vite build into the exact offline document embedded by the native host. */
export function singleDocumentPlugin(packageDir: string, outDir: string, htmlFile: string) {
  return {
    name: `chat-view-single-document-${outDir}`,
    enforce: 'post' as const,
    async closeBundle() {
      const distDir = resolve(packageDir, outDir)
      const htmlPath = resolve(distDir, htmlFile)
      let html = await readFile(htmlPath, 'utf8')
      const referencedAssets = Array.from(html.matchAll(/(?:src|href)=["'](\.\/assets\/[^"']+)["']/g))
        .map((match) => match[1])
      for (const relativePath of referencedAssets) {
        const fileName = relativePath.replace(/^\.\//, '')
        const source = await readFile(resolve(distDir, fileName), 'utf8')
        html = inlineAsset(html, fileName, source)
      }
      await writeFile(htmlPath, html)
      await rm(resolve(distDir, 'assets'), { recursive: true, force: true })
    },
  }
}
