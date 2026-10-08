import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { bundleViewerScript, writeViewerPage, type BundleBuilder } from './viewer-page'

const script = await bundleViewerScript('model-viewer/entry.ts', [{
  name: 'inline-draco-decoder',
  setup(builder: BundleBuilder) {
    builder.onResolve({ filter: /^three\/examples\/jsm\/libs\/draco\/gltf\/draco_(?:wasm_wrapper\.js|decoder\.wasm)\?url$/ },
      ({ path }) => ({ path: path.slice(0, -4), namespace: 'inline-draco' }))
    builder.onLoad({ filter: /./, namespace: 'inline-draco' }, async ({ path }) => {
      const mime = path.endsWith('.wasm') ? 'application/wasm' : 'text/javascript'
      const bytes = await readFile(fileURLToPath(import.meta.resolve(path)))
      return { contents: `export default ${JSON.stringify(`data:${mime};base64,${bytes.toString('base64')}`)}`, loader: 'js' }
    })
  },
}], 'model')
await writeViewerPage({
  output: 'src/generated-model-viewer-html.ts',
  exportName: 'MODEL_VIEWER_HTML',
  generator: 'scripts/build-model-viewer.ts',
  viewport: 'width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no',
  style: 'html,body,#stage{width:100%;height:100%;margin:0;overflow:hidden;background:__VIEWER_BACKGROUND__}canvas{display:block;touch-action:none}#status{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;color:__VIEWER_FOREGROUND__;font:13px system-ui;pointer-events:none}#status:empty{display:none}#reset{position:absolute;top:12px;right:12px;border:0;border-radius:8px;padding:8px 11px;background:__VIEWER_SURFACE__;color:__VIEWER_FOREGROUND__;font:13px system-ui}',
  body: '<div id="stage"></div><div id="status">Loading model…</div><button id="reset" hidden>Reset view</button>',
  script,
})
