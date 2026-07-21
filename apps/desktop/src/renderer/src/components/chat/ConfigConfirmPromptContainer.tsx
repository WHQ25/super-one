import { useChatStore } from '@/stores/chat'
import { CONFIG_APPLY_FIELD, type PermissionRequest } from '@superone/shared/agent-types'
import { ConfigConfirmPrompt } from './ConfigConfirmPrompt'

/**
 * Bridges a `config_confirm` PermissionRequest to the self-contained
 * ConfigConfirmPrompt, wiring Confirm/Reject to the shared PERMISSION_RESPONSE
 * channel via the chat store's respondToPermission.
 *
 * Response packing (flat content record, mirrors the video-gen confirm flow):
 * - confirm → allow=true,  formAnswers={ configJson: JSON.stringify(editedValues) }
 * - reject  → allow=false, formAnswers={ feedback }
 */
export function ConfigConfirmPromptContainer({ request }: { request: PermissionRequest }) {
  const respondToPermission = useChatStore((s) => s.respondToPermission)
  const payload = request.configConfirm
  if (!payload) return null

  const handleConfirm = (values: Record<string, string | number | boolean | null>): void => {
    void respondToPermission(
      request.requestId,
      true,
      undefined,
      undefined,
      undefined,
      undefined,
      { [CONFIG_APPLY_FIELD]: JSON.stringify(values) },
    )
  }

  const handleReject = (feedback: string): void => {
    void respondToPermission(
      request.requestId,
      false,
      undefined,
      undefined,
      undefined,
      undefined,
      { feedback },
    )
  }

  return <ConfigConfirmPrompt payload={payload} onConfirm={handleConfirm} onReject={handleReject} />
}
