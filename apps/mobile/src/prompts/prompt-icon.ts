import { Bot, CalendarClock, FilePenLine, FileText, Globe, MessageCircle, Monitor, Plug, Settings2, ShieldAlert, Smartphone, Terminal, Trash2, Video, type LucideIcon } from 'lucide-react-native'
import type { PermissionRequest } from '@superone/shared/agent-types'
import type { PendingPrompt } from '../pending-prompt-state'

const kindIcons: Record<NonNullable<PermissionRequest['requestKind']>, LucideIcon> = {
  mcp_elicitation: Plug, video_gen_confirm: Video, config_confirm: Settings2,
  session_agents_confirm: Bot, computer_use_grant: Monitor, session_cleanup_confirm: Trash2,
  automation_confirm: CalendarClock, webmcp_trust_confirm: Globe, device_control_confirm: Smartphone,
}

export function permissionPromptIcon(request: PermissionRequest): LucideIcon {
  if (request.requestKind) return kindIcons[request.requestKind]
  if (request.toolName === 'Bash') return Terminal
  if (request.toolName === 'SandboxNetworkAccess') return ShieldAlert
  if (/Edit|Write/.test(request.toolName)) return FilePenLine
  if (request.toolName === 'Read') return FileText
  return Plug
}

/** The glyph the sheet header and the collapsed strip share for one prompt. */
export function pendingPromptIcon(prompt: PendingPrompt): LucideIcon {
  switch (prompt.kind) {
    case 'permission': return permissionPromptIcon(prompt.request)
    case 'question': return MessageCircle
    case 'plan': return FilePenLine
  }
}
