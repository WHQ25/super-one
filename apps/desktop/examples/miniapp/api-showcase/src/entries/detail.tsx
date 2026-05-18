import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'

// ui.showPopover template. `superone.popover` carries the initial data and a
// two-way message channel back to the panel that opened it.
const popover = window.superone.popover!
const data = (popover?.data ?? {}) as { title?: string; description?: string }

function Detail() {
  const [fromPanel, setFromPanel] = useState<string>('')

  useEffect(() => {
    popover.onMessage((msg) => {
      setFromPanel(JSON.stringify(msg))
    })
  }, [])

  return (
    <div className="bg-popover text-fg p-4 flex flex-col gap-3">
      <div className="text-sm font-semibold">{data.title ?? 'Popover'}</div>
      <p className="text-[13px] text-muted-fg">{data.description}</p>
      {fromPanel && (
        <div className="text-xs bg-accent text-accent-fg rounded-md px-2 py-1">
          ← panel said: {fromPanel}
        </div>
      )}
      <div className="flex gap-2">
        <button
          className="px-3 py-1.5 rounded-md text-sm bg-primary text-primary-fg hover:opacity-90"
          onClick={() => popover.postMessage({ action: 'confirm', ts: Date.now() })}
        >
          Send to panel
        </button>
        <button
          className="px-3 py-1.5 rounded-md text-sm border border-border bg-bg text-fg hover:bg-accent"
          onClick={() => popover.close()}
        >
          Close
        </button>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Detail />
  </StrictMode>,
)
