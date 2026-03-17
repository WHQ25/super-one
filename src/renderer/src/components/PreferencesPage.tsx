import { useEffect, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import { ProjectSelector } from '@/components/coding/ProjectSelector'
import { useAppStore } from '@/stores/app'
import { useChatStore } from '@/stores/chat'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export function PreferencesPage() {
  const currentFolder = useAppStore((s) => s.currentFolder)
  const availableOutputStyles = useChatStore((s) => s.availableOutputStyles)

  const [outputStyle, setOutputStyle] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!currentFolder) { setLoading(false); return }
    let mounted = true
    setLoading(true)
    void window.app.getProjectPreferences(currentFolder).then((p) => {
      if (mounted) setOutputStyle(p.outputStyle)
    }).finally(() => { if (mounted) setLoading(false) })
    return () => { mounted = false }
  }, [currentFolder])

  async function handleSelect(style: string) {
    if (!currentFolder || saving) return
    setSaving(true)
    try {
      const result = await window.app.saveProjectPreferences(currentFolder, { outputStyle: style })
      setOutputStyle(result.outputStyle)
      toast.success('Output style updated')
    } finally {
      setSaving(false)
    }
  }

  const disabled = loading || saving

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Preferences</h2>
          <p className="text-sm text-muted-foreground">Configure Claude Code behavior</p>
        </div>
        <ProjectSelector mode="switch" />
      </div>

      <div className="rounded-lg border border-border">
        <div className="flex items-center justify-between gap-4 p-4">
          <div className="min-w-0">
            <p className="text-sm font-medium">Output Style</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Controls how Claude formats responses — tone, structure, and level of detail. Stored in .claude/settings.local.json.
            </p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                disabled={disabled || !currentFolder}
                className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="truncate">{outputStyle || 'Default'}</span>
                <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={() => handleSelect('')} className="flex items-center justify-between">
                <span>Default</span>
                {!outputStyle && <Check className="size-4 text-muted-foreground" />}
              </DropdownMenuItem>
              {availableOutputStyles.filter((s) => s.toLowerCase() !== 'default').map((style) => (
                <DropdownMenuItem key={style} onClick={() => handleSelect(style)} className="flex items-center justify-between">
                  <span>{style}</span>
                  {outputStyle === style && <Check className="size-4 text-muted-foreground" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  )
}
