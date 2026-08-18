import { useEffect } from 'react'
import { useActiveSession, useChatStore } from '@/stores/chat'
import { PermissionModePopover } from './PermissionModePopover'
import { DEEPSEEK_PERMISSION_MODES } from './deepseekPermissionModes'

export function DeepseekPermissionSelector({ compact = false }: { compact?: boolean }) {
  const permissionMode = useActiveSession((state) => state.permissionMode)
  const setPermissionMode = useChatStore((state) => state.setPermissionMode)

  useEffect(() => {
    if (!DEEPSEEK_PERMISSION_MODES.includes(permissionMode)) setPermissionMode('default')
  }, [permissionMode, setPermissionMode])

  return (
    <PermissionModePopover
      activeMode={permissionMode}
      availableModes={DEEPSEEK_PERMISSION_MODES}
      compact={compact}
      onSelect={setPermissionMode}
    />
  )
}
