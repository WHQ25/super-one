import wasmUrl from '@extend-ai/react-xlsx/duke_sheets_wasm_bg.wasm?url'
import { setWasmSource, useXlsxViewerController, XlsxViewer } from '@extend-ai/react-xlsx'
import { OFFICE_PREVIEW_MAX_BYTES } from '@superone/shared/file-preview'
import { useTheme } from '@/hooks/useTheme'
import { OfficePreviewStatus } from './office-toolbar'

setWasmSource(wasmUrl)

export function OfficeXlsxView({ buffer, fileName }: { buffer: ArrayBuffer; fileName: string }) {
  const { dark } = useTheme()
  // `useWorker: true` only falls back for a few DOM parser errors. A worker
  // script that fails to load does not. Its bundle also dynamic-imports the
  // WASM package, which the iife worker build cannot emit, so the constructor
  // is stubbed in the Vite config and the parse stays on the main thread.
  // The grid is still virtualized. The 25 MiB cap bounds the hitch.
  // Cells stay read-only. Header drags still resize; the same Vite transform
  // paints the new column width or row height while the pointer moves.
  const controller = useXlsxViewerController({
    file: buffer,
    fileName,
    readOnly: true,
    allowResizeInReadOnly: true,
    useWorker: false,
    maxFileSizeBytes: OFFICE_PREVIEW_MAX_BYTES,
  })

  return (
    <XlsxViewer
      controller={controller}
      allowResizeInReadOnly
      height="100%"
      isDark={dark}
      showDefaultToolbar={false}
      rounded={false}
      className="h-full min-h-0"
      loadingState={<OfficePreviewStatus phase="loading" />}
      errorState={<OfficePreviewStatus phase="failed" />}
      fileTooLargeState={<OfficePreviewStatus phase="too-large" />}
    />
  )
}
