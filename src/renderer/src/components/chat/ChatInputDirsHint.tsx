import { Folder } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useActiveSession } from '@/stores/chat'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { shortenPath } from '@/lib/path-utils'

interface ChatInputDirsHintProps {
  isCoding: boolean
}

type DirScope = 'user' | 'project' | 'session'

function basename(p: string): string {
  const trimmed = p.replace(/[/\\]+$/, '')
  const parts = trimmed.split(/[/\\]/)
  return parts[parts.length - 1] || p
}

export function ChatInputDirsHint({ isCoding }: ChatInputDirsHintProps) {
  const { t } = useTranslation()
  const userDirs = useActiveSession((s) => s.userAdditionalDirs)
  const projectDirs = useActiveSession((s) => s.projectAdditionalDirs)
  const sessionDirs = useActiveSession((s) => s.additionalDirs)
  const messagesLen = useActiveSession((s) => s.messages.length)
  const cwd = useActiveSession((s) => s.cwd)
  const homedir = useActiveSession((s) => s.homedir)

  if (messagesLen > 0) return null

  const entries: Array<{ dir: string; scope: DirScope }> = []
  const seen = new Set<string>()
  for (const d of userDirs) if (!seen.has(d)) { seen.add(d); entries.push({ dir: d, scope: 'user' }) }
  for (const d of projectDirs) if (!seen.has(d)) { seen.add(d); entries.push({ dir: d, scope: 'project' }) }
  for (const d of sessionDirs) if (!seen.has(d)) { seen.add(d); entries.push({ dir: d, scope: 'session' }) }

  if (entries.length === 0) return null
  return (
    <TooltipProvider delayDuration={300}>
      <div className={cn(
        'flex items-center gap-1 overflow-x-auto',
        isCoding
          ? 'mx-3 mb-1 rounded-xl border border-border p-1'
          : 'border-t border-border p-1'
      )}>
        <span className="ml-1 mr-0.5 shrink-0 text-[11px] text-muted-foreground/70">{t('chat.additionalDirs.label')}</span>
        {entries.map(({ dir, scope }) => (
          <Tooltip key={dir}>
            <TooltipTrigger asChild>
              <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-muted/40 px-1.5 py-0.5 text-[11px] text-muted-foreground">
                <Folder className="size-3 shrink-0 text-blue-500" />
                <span>{basename(dir)}</span>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="flex flex-col gap-0.5">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{t(`chat.additionalDirs.scopes.${scope}`)}</span>
              <span className="font-mono text-xs">{shortenPath(dir, cwd, homedir)}</span>
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
  )
}
