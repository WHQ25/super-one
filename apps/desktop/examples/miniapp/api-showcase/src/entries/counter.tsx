import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'

// standalone tool template. This single file BOTH registers the handler and
// renders the result UI — the chat tool block IS this iframe (no panel needed).
document.body.style.background = 'transparent'

type Outcome = { previous: number; value: number; by: number } | null

// The handler runs once per tool call; persist across calls via superone.kv
// (each call is a fresh iframe, so in-memory state does not survive).
window.superone.tools.handle('bump_counter', async (args) => {
  const by = typeof args.by === 'number' ? (args.by as number) : 1
  const current = (await window.superone.kv.get<number>('counter')) ?? 0
  const next = current + by
  await window.superone.kv.set('counter', next)
  return {
    previous: current,
    value: next,
    by,
    summary: `${current} → ${next} (+${by})`,
  }
})

// The standalone `superone.tool` shape (phase 'standalone' + result/error) is
// not covered by the generated d.ts union — read it through a narrow cast.
type StandaloneTool = { result: unknown; error: unknown } | undefined

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
    // Live: handler just returned.
    const onResult = (ev: Event) =>
      render((ev as CustomEvent).detail as { result?: unknown; error?: unknown })
    window.addEventListener('superone:tool-result', onResult)
    // Replay: iframe was unmounted (scrolled away) and remounted — the cached
    // result is exposed synchronously, no re-dispatch of the handler.
    const t = window.superone.tool as unknown as StandaloneTool
    if (t && (t.result !== null || t.error !== null)) {
      render({ result: t.result, error: t.error })
    }
    return () => window.removeEventListener('superone:tool-result', onResult)
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
