import { Button } from '@/components/ui/button'
import { useChatStore } from '@/stores/chat'
import { ToolIcon } from './ToolIcon'
import { getToolDisplay } from './tool-display'

export function PermissionPrompt() {
  const pendingPermission = useChatStore((s) => s.pendingPermission)
  const respondToPermission = useChatStore((s) => s.respondToPermission)
  const cwd = useChatStore((s) => s.cwd)
  const homedir = useChatStore((s) => s.homedir)

  if (!pendingPermission) return null

  const { requestId, toolName, input, decisionReason, blockedPath, allowAlwaysAllow } = pendingPermission
  const display = getToolDisplay(toolName, input, cwd, homedir)

  return (
    <div className="mx-3 mb-2 rounded-lg border border-neutral-600 bg-neutral-700/60 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs">
        <ToolIcon icon={display.icon} className="size-3.5 shrink-0 text-neutral-400" />
        <span className="font-medium text-neutral-200">{toolName}</span>
      </div>
      {display.summary && (
        <p className="mb-2 truncate text-xs text-neutral-400">{display.summary}</p>
      )}
      {blockedPath && (
        <p className="mb-2 truncate text-xs text-amber-400">Blocked path: {blockedPath}</p>
      )}
      {decisionReason && (
        <p className="mb-2 text-xs text-neutral-500">{decisionReason}</p>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          className="h-7 cursor-pointer bg-green-700 px-3 text-xs text-white hover:bg-green-600"
          onClick={() => respondToPermission(requestId, true)}
        >
          Allow
        </Button>
        {allowAlwaysAllow && (
          <Button
            size="sm"
            className="h-7 cursor-pointer bg-amber-600 px-3 text-xs text-white hover:bg-amber-500"
            onClick={() => respondToPermission(requestId, true, true)}
          >
            Always Allow
          </Button>
        )}
        <Button
          size="sm"
          className="h-7 cursor-pointer bg-red-700 px-3 text-xs text-white hover:bg-red-600"
          onClick={() => respondToPermission(requestId, false)}
        >
          Deny
        </Button>
      </div>
    </div>
  )
}
