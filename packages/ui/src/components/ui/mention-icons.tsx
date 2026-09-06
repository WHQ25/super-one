import { Bot, Bug, Folder, Globe, LayoutDashboard, MessageSquare, MousePointer2, Users } from 'lucide-react'

/** Static mention identities shared by desktop chips and the mobile transcript. */
export function staticMentionIcon(kind: string) {
  if (kind === 'agent') return <Bot className="text-purple-600 dark:text-purple-400" />
  if (kind === 'directory') return <Folder className="text-blue-600 dark:text-blue-400" />
  if (kind === 'session') return <MessageSquare className="text-foreground" />
  if (kind === 'collab') return <Users className="text-violet-600 dark:text-violet-400" />
  // Match Settings / ComputerUseToolBlock branding (pointer, not monitor).
  if (kind === 'computer') return <MousePointer2 className="text-emerald-600 dark:text-emerald-400" />
  if (kind === 'browser') return <Globe className="text-sky-600 dark:text-sky-400" />
  if (kind === 'widget') return <LayoutDashboard className="text-amber-600 dark:text-amber-400" />
  if (kind === 'debug') return <Bug className="text-rose-600 dark:text-rose-400" />
  return null
}

