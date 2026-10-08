import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bundleViewerScript, writeViewerPage, type BundleBuilder } from './viewer-page'

const script = await bundleViewerScript('pdf-viewer/entry.ts', [{
  // The pdf.js worker as text, for the page to start from a Blob: offline, it has nowhere to fetch it from.
  name: 'inline-pdf-worker',
  setup(builder: BundleBuilder) {
    builder.onResolve({ filter: /^pdfjs-dist\/legacy\/build\/pdf\.worker\.min\.mjs\?source$/ },
      ({ path }) => ({ path: path.slice(0, -'?source'.length), namespace: 'inline-pdf-worker' }))
    builder.onLoad({ filter: /./, namespace: 'inline-pdf-worker' }, async ({ path }) => ({
      contents: `export default ${JSON.stringify(await readFile(fileURLToPath(import.meta.resolve(path)), 'utf8'))}`,
      loader: 'js',
    }))
  },
}, {
  // The packed CMaps as base64 by file name, for CJK text in PDFs that do not embed it.
  name: 'inline-pdf-cmaps',
  setup(builder: BundleBuilder) {
    builder.onResolve({ filter: /^pdfjs-dist\/cmaps\?inline$/ }, () => ({ path: 'cmaps', namespace: 'inline-pdf-cmaps' }))
    builder.onLoad({ filter: /./, namespace: 'inline-pdf-cmaps' }, async () => {
      const directory = dirname(fileURLToPath(import.meta.resolve('pdfjs-dist/package.json')))
      const files = (await readdir(join(directory, 'cmaps'))).filter((name) => name.endsWith('.bcmap'))
      const entries = await Promise.all(files.map(async (name) => [name, (await readFile(join(directory, 'cmaps', name))).toString('base64')]))
      return { contents: `export default ${JSON.stringify(Object.fromEntries(entries))}`, loader: 'js' }
    })
  },
}], 'PDF')
await writeViewerPage({
  output: 'src/generated-pdf-viewer-html.ts',
  exportName: 'PDF_VIEWER_HTML',
  generator: 'scripts/build-pdf-viewer.ts',
  // Pinch-zoom like any document; pages render sharper than the screen so a zoom stays readable.
  viewport: 'width=device-width,initial-scale=1,maximum-scale=5,user-scalable=yes',
  style: 'html,body{margin:0;background:__VIEWER_BACKGROUND__}#pages{display:flex;flex-direction:column;gap:12px;padding:12px}.page{width:100%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.18)}.page canvas{display:block;width:100%;height:100%}#status{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;color:__VIEWER_FOREGROUND__;font:13px system-ui;pointer-events:none}#status:empty{display:none}#counter{position:fixed;right:12px;bottom:calc(12px + env(safe-area-inset-bottom));border-radius:999px;padding:4px 10px;background:__VIEWER_SURFACE__;color:__VIEWER_FOREGROUND__;font:12px system-ui;font-variant-numeric:tabular-nums;opacity:.9}',
  body: '<div id="pages"></div><div id="status">Loading PDF…</div><div id="counter" hidden></div>',
  script,
})
