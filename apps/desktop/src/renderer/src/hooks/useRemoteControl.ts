import { useEffect } from 'react'
import { useAppStore } from '@/stores/app'
import { useChatStore } from '@/stores/chat'
import type { RemoteCommand } from '@superone/shared/agent-types'

export function useRemoteControl(): void {
  useEffect(() => {
    return window.app.onRemoteCommand((raw) => {
      const command = raw as RemoteCommand
      dispatchCommand(command)
    })
  }, [])
}

function getActiveSid(): string | null {
  const projectPath = useAppStore.getState().currentFolder
  if (!projectPath) return null
  const project = useChatStore.getState().projectSessions[projectPath]
  return project?._activeSessionId ?? null
}

function dispatchCommand(command: RemoteCommand): void {
  switch (command.type) {
    case 'interrupt': {
      const sid = getActiveSid()
      if (sid) window.agent.interrupt(sid)
      break
    }
    case 'respond_permission': {
      const sid = getActiveSid()
      if (sid) {
        window.agent.respondToPermission(sid, command.requestId, command.decision)
      }
      break
    }
  }
}
