import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'

// Standalone result WebView. Computation lives in extension.ts.
document.body.style.background = 'transparent'

type Outcome = { previous: number; value: number; by: number } | null

function Card() {
  const [outcome, setOutcome] = useState<Outcome>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const render = (detail: { result?: unknown; error?: unknown }) => {
      if (detail.error) {
        setError(String(detail.error))
        return
      }
      setOutcome(detail.result as Outcome)
    }
    const tool = window.superone.tool
    if (!tool || tool.phase !== 'standalone') return
    const dispose = tool.onDidChange(render)
    const initial = tool.getState()
    if (initial.result !== null || initial.error !== null) render(initial)
    return dispose
  }, [])

  if (error) {
    return (
      <div className="text-destructive border border-border rounded-[var(--radius-card)] p-4 m-2 text-sm">
        Error: {error}
      </div>
    )
  }

  return (
    <div className="bg-card text-card-fg border border-border rounded-[var(--radius-card)] p-5 m-2 flex items-center gap-4">
      <div className="text-3xl font-bold tabular-nums text-primary">
        {outcome ? outcome.value : '…'}
      </div>
      <div className="text-[13px] text-muted-fg">
        {outcome ? (
          <>
            <div>
              {outcome.previous} → {outcome.value}
            </div>
            <div>incremented by {outcome.by}</div>
          </>
        ) : (
          'Waiting for the tool call…'
        )}
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Card />
  </StrictMode>,
)
