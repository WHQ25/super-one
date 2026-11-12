/**
 * Source patches for the pinned @extend-ai viewers.
 *
 * The xlsx and docx workers are stubbed because Vite's iife worker build cannot
 * code-split them. xlsx then parses on the main thread (`useWorker: false`).
 * docx catches the stub and retries on the main thread.
 *
 * Canvas mode paints column and row sizes from `displayActualColWidths` /
 * `displayActualRowHeights`. During a drag the library only stores the next
 * size on a ref and draws a few-pixel tick in the header; the grid updates on
 * pointerup. Folding that ref into the width memos makes the sheet follow the
 * pointer. `resizeGuide` is already a dependency that changes on each move, so
 * the memos recompute without a second state update. The selection overlay
 * measures the same arrays, so its own preview delta stays zero.
 */

const XLSX_WORKER = 'new Worker(new URL("./xlsx-worker.js", import.meta.url), { type: "module" })'
const XLSX_WORKER_STUB = '(() => { throw new Error("xlsx preview worker is not bundled") })()'

const XLSX_AXIS_SIZES = `  const displayActualColWidths = React4.useMemo(
    () => actualColWidths.map((width) => width * zoomFactor),
    [actualColWidths, zoomFactor]
  );
  const displayActualRowHeights = React4.useMemo(
    () => actualRowHeights.map((height) => height * zoomFactor),
    [actualRowHeights, zoomFactor]
  );`

const XLSX_AXIS_SIZES_PATCHED = `  const displayActualColWidths = React4.useMemo(
    () => {
      const widths = actualColWidths.map((width) => width * zoomFactor);
      const preview = columnPreviewRef.current;
      if (preview && preview.actualIndex >= 0 && preview.actualIndex < widths.length) widths[preview.actualIndex] = preview.size;
      return widths;
    },
    [actualColWidths, zoomFactor, resizeGuide]
  );
  const displayActualRowHeights = React4.useMemo(
    () => {
      const heights = actualRowHeights.map((height) => height * zoomFactor);
      const preview = rowPreviewRef.current;
      if (preview && preview.actualIndex >= 0 && preview.actualIndex < heights.length) heights[preview.actualIndex] = preview.size;
      return heights;
    },
    [actualRowHeights, zoomFactor, resizeGuide]
  );`

const XLSX_RESIZE_GUIDE = `height: resizeGuide.type === "column" ? Math.max(12, 14 * zoomFactor) : Math.max(3, 2 * zoomFactor),
                  left: resizeGuide.type === "column" ? resizeGuide.position - Math.max(2, 1.5 * zoomFactor) : Math.max(3, 4 * zoomFactor),
                  pointerEvents: "none",
                  position: "absolute",
                  top: resizeGuide.type === "column" ? Math.max(2 * zoomFactor, displayHeaderHeight - Math.max(14, 16 * zoomFactor)) : resizeGuide.position - Math.max(2, 1.5 * zoomFactor),
                  width: resizeGuide.type === "column" ? Math.max(3, 2 * zoomFactor) : Math.max(12, 14 * zoomFactor),`

const XLSX_RESIZE_GUIDE_PATCHED = `height: resizeGuide.type === "column" ? "100%" : Math.max(3, 2 * zoomFactor),
                  left: resizeGuide.type === "column" ? resizeGuide.position - Math.max(2, 1.5 * zoomFactor) : 0,
                  pointerEvents: "none",
                  position: "absolute",
                  top: resizeGuide.type === "column" ? 0 : resizeGuide.position - Math.max(2, 1.5 * zoomFactor),
                  width: resizeGuide.type === "column" ? Math.max(3, 2 * zoomFactor) : "100%",`

const DOCX_WORKER = /new Worker\(new URL\("\.\/docx-import-worker\.js", import\.meta\.url\), \{[^}]*\}\)/
const DOCX_WORKER_STUB = '(() => { throw new Error("Unable to start the DOCX import worker") })()'

export interface OfficeViewerPatch {
  code: string
  /** Needles that were neither found nor already applied. */
  missing: string[]
}

function replaceOnce(code: string, needle: string, replacement: string, already: string, name: string, missing: string[]): string {
  const at = code.indexOf(needle)
  if (at === -1) {
    if (!code.includes(already)) missing.push(name)
    return code
  }
  if (code.indexOf(needle, at + 1) !== -1) {
    missing.push(`${name}-ambiguous`)
    return code
  }
  return code.slice(0, at) + replacement + code.slice(at + needle.length)
}

export function patchXlsxViewerSource(code: string): OfficeViewerPatch {
  const missing: string[] = []
  let next = replaceOnce(code, XLSX_WORKER, XLSX_WORKER_STUB, 'xlsx preview worker is not bundled', 'xlsx-worker', missing)
  next = replaceOnce(next, XLSX_AXIS_SIZES, XLSX_AXIS_SIZES_PATCHED, 'widths[preview.actualIndex] = preview.size', 'xlsx-axis-sizes', missing)
  next = replaceOnce(next, XLSX_RESIZE_GUIDE, XLSX_RESIZE_GUIDE_PATCHED, 'resizeGuide.type === "column" ? "100%"', 'xlsx-resize-guide', missing)
  return { code: next, missing }
}

export function patchDocxViewerSource(code: string): OfficeViewerPatch {
  if (code.includes(DOCX_WORKER_STUB)) return { code, missing: [] }
  if (!DOCX_WORKER.test(code)) return { code, missing: ['docx-worker'] }
  return { code: code.replace(DOCX_WORKER, DOCX_WORKER_STUB), missing: [] }
}
