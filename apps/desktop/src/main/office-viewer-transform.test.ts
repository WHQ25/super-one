import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { patchDocxViewerSource, patchXlsxViewerSource } from './office-viewer-transform'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')

describe('office viewer source patches', () => {
  it('stubs the xlsx worker and paints column and row drags before pointerup', () => {
    const source = readFileSync(resolve(repoRoot, 'node_modules/@extend-ai/react-xlsx/dist/index.js'), 'utf8')
    const patched = patchXlsxViewerSource(source)

    expect(patched.missing).toEqual([])
    expect(patched.code).not.toContain('new Worker(new URL("./xlsx-worker.js"')
    expect(patched.code).toContain('xlsx preview worker is not bundled')
    expect(patched.code).toContain('widths[preview.actualIndex] = preview.size')
    expect(patched.code).toContain('heights[preview.actualIndex] = preview.size')
    expect(patched.code).toContain('resizeGuide.type === "column" ? "100%"')
    expect(patched.code).toContain('resizeGuide.type === "column" ? Math.max(3, 2 * zoomFactor) : "100%"')
    expect(patchXlsxViewerSource(patched.code)).toEqual({ code: patched.code, missing: [] })
  })

  it('stubs the docx import worker', () => {
    const source = readFileSync(resolve(repoRoot, 'node_modules/@extend-ai/react-docx/dist/index.js'), 'utf8')
    const patched = patchDocxViewerSource(source)

    expect(patched.missing).toEqual([])
    expect(patched.code).not.toContain('new Worker(new URL("./docx-import-worker.js"')
    expect(patched.code).toContain('(() => { throw new Error("Unable to start the DOCX import worker") })()')
    expect(patchDocxViewerSource(patched.code)).toEqual({ code: patched.code, missing: [] })
  })
})
