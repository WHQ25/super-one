import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'

// renderer.intercept template. Only `superone.tool` (phase 'intercept') is
// exposed here. The template MUST call submit() or cancel() exactly once.
const tool = window.superone.tool as Extract<
  NonNullable<typeof window.superone.tool>,
  { phase: 'intercept' }
>
const agentInput = (tool?.data ?? {}) as { action?: string; detail?: string }

function ConfirmCard() {
  const [note, setNote] = useState(agentInput.detail ?? '')
  const [done, setDone] = useState<null | 'submit' | 'cancel'>(null)

  if (done) {
    return (
      <div className="p-3 text-sm text-muted-fg">
        {done === 'submit' ? 'Confirmed — running…' : 'Cancelled.'}
      </div>
    )
  }

  return (
    <div className="bg-card text-card-fg border border-border rounded-[var(--radius-card)] p-4 m-2 flex flex-col gap-3">
      <div className="text-[13px] uppercase tracking-wide text-muted-fg">
        Confirm action
      </div>
      <div className="text-base font-medium">{agentInput.action || '(no action)'}</div>
      <label className="text-xs text-muted-fg flex flex-col gap-1">
        Note (editable — merged into the tool input)
        <input
          className="bg-bg border border-border rounded-md px-2.5 py-1.5 text-sm text-fg outline-none focus:border-primary"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Add an optional note…"
        />
      </label>
      <div className="flex gap-2 justify-end">
        <button
          className="px-3 py-1.5 rounded-md text-sm border border-border bg-bg text-fg hover:bg-accent"
          onClick={() => {
            setDone('cancel')
            tool.cancel('user_rejected')
          }}
        >
          Cancel
        </button>
        <button
          className="px-3 py-1.5 rounded-md text-sm bg-primary text-primary-fg hover:opacity-90"
          onClick={() => {
            setDone('submit')
            // shallow-merge: these keys are merged onto the agent input,
            // then dispatched to the MiniApp Host's confirm_action handler.
            tool.submit({ approved: true, note })
          }}
        >
          Approve
        </button>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfirmCard />
  </StrictMode>,
)
