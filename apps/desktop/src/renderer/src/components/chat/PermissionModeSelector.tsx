import { useChatStore, useActiveSession, selectClaudeModels, selectClaudeAccount, useScopedSessionActions } from '@/stores/chat'
import { useMemo } from 'react'
import { eligibilityFromStore } from '@/lib/auto-mode-eligibility'
import { modes, PERMISSION_MODES } from './PermissionModeList'
import { PermissionModePopover } from './PermissionModePopover'

export { modes, PERMISSION_MODES }

interface PermissionModeSelectorProps {
  compact?: boolean
}

export function PermissionModeSelector({ compact = false }: PermissionModeSelectorProps) {
  const permissionMode = useActiveSession((s) => s.permissionMode)
  const selectedModel = useActiveSession((s) => s.selectedModel)
  const { setPermissionMode } = useScopedSessionActions()
  const account = useChatStore(selectClaudeAccount)
  const availableModels = useChatStore(selectClaudeModels)

  const autoEligibility = useMemo(
    () => eligibilityFromStore(account, availableModels.find((m) => m.id === selectedModel)),
    [account, selectedModel, availableModels],
  )

  return (
    <PermissionModePopover
      activeMode={permissionMode}
      availableModes={modes.map((mode) => mode.id)}
      autoEligibility={autoEligibility}
      compact={compact}
      onSelect={setPermissionMode}
    />
  )
}
