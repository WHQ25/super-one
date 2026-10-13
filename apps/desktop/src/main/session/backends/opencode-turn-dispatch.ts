import { waitForOpenCodeTurn } from '@superone/opencode/turn-settlement'
import type { SendMessageRequest } from '@superone/shared/agent-types'
import type { OpenCodeDispatchResult } from '../../opencode/opencode-command'

/** Remember explicit picks so later omitted turns use the same selection. */
export function rememberOpenCodeTurnSelection(request: SendMessageRequest, selection: Pick<SendMessageRequest, 'model' | 'effort'> | null): SendMessageRequest {
  const turn = { ...request, model: request.model ?? selection?.model, effort: request.effort ?? selection?.effort }
  if (selection) { selection.model = turn.model; selection.effort = turn.effort }
  return turn
}

/** Preserve local/V1 admission timing while native V2 terminals can beat HTTP. */
export async function settleOpenCodeDispatch(admission: Promise<OpenCodeDispatchResult>, finished: Promise<void>, host: {
  native: boolean
  isCurrent(): boolean
  syncSettings(): void
  onLocal(content: string): void
}) {
  let synced = false
  const sync = () => {
    if (synced || !host.isCurrent()) return
    synced = true
    host.syncSettings()
  }
  const dispatch = admission.then(result => {
    if (!host.isCurrent()) return
    sync()
    if (result.kind === 'local') host.onLocal(result.content)
  })
  if (host.native) await waitForOpenCodeTurn(dispatch, finished)
  else { await dispatch; await finished }
  sync()
}
