import { useEffect, useState } from 'react'
import wasmUrl from '@extend-ai/react-pptx/pptx_wasm_bg.wasm?url'
import '@extend-ai/react-pptx/styles.css'
import { ReactPptxViewer, setWasmSource } from '@extend-ai/react-pptx'
import { OfficePreviewStatus } from './office-toolbar'
import { OfficePptxThumbnailRail, type PptxThumbnailRenderer } from './office-pptx-rail'

// Same as the docx viewer: the package's own WASM path is not valid once bundled.
// There is no switch to force the main thread. A string URL keeps parsing in
// `native-parser-worker.js`, which Vite bundles because this module is transformed.
setWasmSource(wasmUrl)

export function OfficePptxView({ buffer, chrome }: { buffer: ArrayBuffer; chrome: boolean }) {
  const [slide, setSlide] = useState(0)
  const [count, setCount] = useState(0)
  const [aspect, setAspect] = useState(16 / 9)
  // The package filmstrip virtualizes against its own scroll offset and was
  // mounting only the last slides. This rail owns the scroll window instead.
  const [thumbnails, setThumbnails] = useState<PptxThumbnailRenderer | null>(null)

  useEffect(() => {
    setSlide(0)
    setCount(0)
    setAspect(16 / 9)
    setThumbnails(null)
  }, [buffer])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1">
        {chrome && count > 0 && (
          <OfficePptxThumbnailRail
            count={count}
            active={slide}
            aspect={aspect}
            renderer={thumbnails}
            onSelect={setSlide}
          />
        )}
        <div className="min-h-0 min-w-0 flex-1">
          <ReactPptxViewer
            source={buffer}
            mode="continuous"
            showToolbar={false}
            showThumbnails={false}
            virtualization
            height="100%"
            className="h-full min-h-0"
            defaultZoom="fit-page"
            slideIndex={slide}
            onSlideChange={setSlide}
            onReady={setThumbnails}
            onLoad={(presentation) => {
              const { widthEmu, heightEmu } = presentation.document.size
              setCount(presentation.document.slides.length)
              if (widthEmu > 0 && heightEmu > 0) setAspect(widthEmu / heightEmu)
            }}
            renderLoading={() => <OfficePreviewStatus phase="loading" />}
            renderError={() => <OfficePreviewStatus phase="failed" />}
          />
        </div>
      </div>
    </div>
  )
}
