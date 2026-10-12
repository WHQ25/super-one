import { useActiveSession } from '@/stores/chat'
import { HARNESS_CONTROLS } from '@/harness-ui/controls'

export function ModelSelector({ onCloseAutoFocus }: { onCloseAutoFocus?: (e: Event) => void } = {}) {
  const harness = useActiveSession((s) => s.sessionProvider ?? s.preferredProvider)
  const { ModelControl } = HARNESS_CONTROLS[harness]
  return <ModelControl onCloseAutoFocus={onCloseAutoFocus} />
}
