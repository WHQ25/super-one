import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'

// renderer.result template. Purely presentational — the agent-visible tool
// result is already finalised; this only renders it inline in the chat block.
const tool = window.superone.tool as Extract<
  NonNullable<typeof window.superone.tool>,
  { phase: 'result' }
>
const result = (tool?.data ?? {}) as {
  summary?: string
  action?: string
  note?: string
  approved?: boolean
  at?: string
}

// Result renderers blend into the chat message — keep the body transparent.
document.body.style.background = 'transparent'

function Receipt() {
  return (
    <div className="text-card-fg border border-border rounded-[var(--radius-card)] p-4 m-2 bg-card flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">✓ Action receipt</span>
        <button
          className="text-xs text-muted-fg hover:text-fg"
          onClick={() => tool.close()}
        >
          Collapse
        </button>
      </div>
      <dl className="text-[13px] grid grid-cols-[80px_1fr] gap-x-3 gap-y-1">
        <dt className="text-muted-fg">Action</dt>
        <dd>{result.action ?? '—'}</dd>
        <dt className="text-muted-fg">Note</dt>
        <dd>{result.note || <span className="text-muted-fg">(none)</span>}</dd>
        <dt className="text-muted-fg">Status</dt>
        <dd>{result.approved ? 'Approved & executed' : 'Cancelled'}</dd>
        <dt className="text-muted-fg">At</dt>
        <dd>{result.at ?? '—'}</dd>
      </dl>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Receipt />
  </StrictMode>,
)
