import { useEffect, useState } from 'react'
import wasmUrl from '@extend-ai/react-docx/docx_wasm_bg.wasm?url'
import { parseDocxForViewer, ReactDocxViewer, setWasmSource, type ParsedDocxDocument } from '@extend-ai/react-docx'
import { OfficePreviewStatus } from './office-toolbar'

// The package's default WASM URL breaks once the module is bundled. A string
// URL is worker-compatible, so both the worker and the main-thread fallback can fetch it.
setWasmSource(wasmUrl)

function isDocxWorkerStartError(err: unknown): boolean {
  return err instanceof Error
    && err.name !== 'AbortError'
    && /requires a Web Worker|Unable to start the DOCX import worker|DOCX import worker failed|unreadable response|Failed to start DOCX import worker/i.test(err.message)
}

async function parseDocx(buffer: ArrayBuffer, fileName: string, signal: AbortSignal): Promise<ParsedDocxDocument> {
  const shared = { loadEmbeddedFonts: 'defer' as const, fileName, signal, transferBuffer: false }
  try {
    return await parseDocxForViewer(buffer, { ...shared, useWorker: 'required' })
  } catch (err) {
    // `useWorker: 'required'` does not fall back. The production bundle stubs
    // this worker (its graph cannot be an iife worker), so the throw matches
    // here and the parse retries on the main thread. A corrupt package stays
    // a failure.
    if (signal.aborted || !isDocxWorkerStartError(err)) throw err
    return await parseDocxForViewer(buffer, { ...shared, useWorker: false })
  }
}

export function OfficeDocxView({ buffer, fileName }: { buffer: ArrayBuffer; fileName: string }) {
  const [doc, setDoc] = useState<ParsedDocxDocument | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const ac = new AbortController()
    let parsed: ParsedDocxDocument | null = null
    let cancelled = false
    setDoc(null)
    setFailed(false)
    void parseDocx(buffer, fileName, ac.signal).then((next) => {
      if (cancelled) { next.dispose(); return }
      parsed = next
      setDoc(next)
    }).catch((err: unknown) => {
      if (cancelled || ac.signal.aborted || (err instanceof Error && err.name === 'AbortError')) return
      setFailed(true)
    })
    return () => {
      cancelled = true
      ac.abort()
      const current = parsed
      parsed = null
      // Drop the viewer before dispose. A timeout lets that render commit;
      // disposing inside this cleanup still has it mounted.
      setDoc((currentDoc) => (currentDoc === current ? null : currentDoc))
      setTimeout(() => current?.dispose(), 0)
    }
  }, [buffer, fileName])

  if (failed) return <OfficePreviewStatus phase="failed" />
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        {doc ? (
          <ReactDocxViewer document={doc} defaultZoom="fit-width" loadEmbeddedFonts className="min-h-full" />
        ) : (
          <OfficePreviewStatus phase="loading" />
        )}
      </div>
    </div>
  )
}
