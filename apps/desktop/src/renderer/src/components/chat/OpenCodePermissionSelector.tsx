import { useEffect } from 'react'
import { useActiveSession, useChatStore } from '@/stores/chat'
import { PermissionModePopover } from './PermissionModePopover'
import { OPENCODE_PERMISSION_MODES } from './opencodePermissionModes'

export function OpenCodePermissionSelector({ compact = false }: { compact?: boolean }) {
  const permissionMode = useActiveSession((state) => state.permissionMode)
  const setPermissionMode = useChatStore((state) => state.setPermissionMode)

  useEffect(() => {
    if (!OPENCODE_PERMISSION_MODES.includes(permissionMode)) setPermissionMode('default')
  }, [permissionMode, setPermissionMode])

  return (
    <PermissionModePopover
      activeMode={permissionMode}
      availableModes={OPENCODE_PERMISSION_MODES}
      compact={compact}
      onSelect={setPermissionMode}
    />
  )
}
