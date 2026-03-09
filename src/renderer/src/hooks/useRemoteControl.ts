import { useEffect } from 'react'
import { useAppStore } from '@/stores/app'
import { useChatStore } from '@/stores/chat'
import type { RemoteCommand } from '../../../shared/agent-types'

export function useRemoteControl(): void {
  useEffect(() => {
    return window.app.onRemoteCommand((raw) => {
      const command = raw as RemoteCommand
      dispatchCommand(command)
    })
  }, [])
}

function dispatchCommand(command: RemoteCommand): void {
  switch (command.type) {
    case 'send_message':
      useChatStore.getState().sendMessage(command.content)
      break
    case 'interrupt': {
      const projectPath = useAppStore.getState().currentFolder
      if (projectPath) window.agent.interrupt(projectPath)
      break
    }
    case 'respond_permission': {
      const projectPath = useAppStore.getState().currentFolder
      if (projectPath) {
        window.agent.respondToPermission(projectPath, command.requestId, command.decision)
      }
      break
    }
  }
}
