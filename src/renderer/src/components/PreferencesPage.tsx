import { useEffect, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import { ProjectSelector } from '@/components/coding/ProjectSelector'
import { useAppStore } from '@/stores/app'
import { useChatStore, invalidateDefaultPermissionModeCache } from '@/stores/chat'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { modes as permissionModes } from '@/components/chat/PermissionModeSelector'
import { PermissionModeList } from '@/components/chat/PermissionModeList'
import { sandboxModes } from '@/components/chat/SandboxModeSelector'
import { checkAutoModePlanEligibility } from '@/lib/auto-mode-eligibility'
import type { PermissionMode, SandboxMode } from '../../../shared/agent-types'

export function PreferencesPage() {
  const currentFolder = useAppStore((s) => s.currentFolder)
  const availableOutputStyles = useChatStore((s) => s.availableOutputStyles)
  const account = useChatStore((s) => s.account)
  const autoPlanEligibility = checkAutoModePlanEligibility(account)

  const [outputStyle, setOutputStyle] = useState('')
  const [defaultPermissionMode, setDefaultPermissionMode] = useState<PermissionMode | ''>('')
  const [defaultSandboxMode, setDefaultSandboxMode] = useState<SandboxMode | ''>('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [permOpen, setPermOpen] = useState(false)
  const [sandboxOpen, setSandboxOpen] = useState(false)

  useEffect(() => {
    let mounted = true
    setLoading(true)
    Promise.all([
      currentFolder ? window.app.getProjectPreferences(currentFolder) : Promise.resolve(null),
      window.app.getUserPreferences(),
    ]).then(([projectPrefs, userPrefs]) => {
      if (!mounted) return
      if (projectPrefs) setOutputStyle(projectPrefs.outputStyle)
      setDefaultPermissionMode(userPrefs.defaultPermissionMode as PermissionMode || '')
      setDefaultSandboxMode(userPrefs.defaultSandboxMode as SandboxMode || '')
    }).finally(() => { if (mounted) setLoading(false) })
    return () => { mounted = false }
  }, [currentFolder])

  async function handleOutputStyleSelect(style: string) {
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

  async function handlePermissionModeSelect(mode: PermissionMode) {
    if (saving) return
    setSaving(true)
    try {
      const result = await window.app.saveUserPreferences({ defaultPermissionMode: mode })
      setDefaultPermissionMode(result.defaultPermissionMode as PermissionMode || '')
      invalidateDefaultPermissionModeCache()
      toast.success('Default permission mode updated')
    } finally {
      setSaving(false)
      setPermOpen(false)
    }
  }

  async function handleSandboxModeSelect(mode: SandboxMode) {
    if (saving) return
    setSaving(true)
    try {
      const result = await window.app.saveUserPreferences({ defaultSandboxMode: mode })
      setDefaultSandboxMode(result.defaultSandboxMode as SandboxMode || '')
      toast.success('Default sandbox mode updated')
    } finally {
      setSaving(false)
      setSandboxOpen(false)
    }
  }

  const disabled = loading || saving
  const activePermMode = defaultPermissionMode || 'default'
  const activeSandboxMode = defaultSandboxMode || 'on'
  const currentPerm = permissionModes.find((m) => m.id === activePermMode) ?? permissionModes[0]
  const currentSandbox = sandboxModes.find((m) => m.id === activeSandboxMode) ?? sandboxModes[1]

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Preferences</h2>
          <p className="text-sm text-muted-foreground">Configure Claude Code behavior</p>
        </div>
        <ProjectSelector mode="switch" />
      </div>

      <div className="space-y-4">
        <div className="rounded-lg border border-border">
          <div className="border-b border-border px-4 py-2">
            <p className="text-xs font-medium text-muted-foreground">Project Settings</p>
          </div>
          <div className="flex items-center justify-between gap-4 p-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">Output Style</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Controls how Claude formats responses — tone, structure, and level of detail.
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
                <DropdownMenuItem onClick={() => handleOutputStyleSelect('')} className="flex items-center justify-between">
                  <span>Default</span>
                  {!outputStyle && <Check className="size-4 text-muted-foreground" />}
                </DropdownMenuItem>
                {availableOutputStyles.filter((s) => s.toLowerCase() !== 'default').map((style) => (
                  <DropdownMenuItem key={style} onClick={() => handleOutputStyleSelect(style)} className="flex items-center justify-between">
                    <span>{style}</span>
                    {outputStyle === style && <Check className="size-4 text-muted-foreground" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="rounded-lg border border-border">
          <div className="border-b border-border px-4 py-2">
            <p className="text-xs font-medium text-muted-foreground">User Settings</p>
          </div>
          <div className="flex items-center justify-between gap-4 border-b border-border p-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">Permission Mode</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Default permission mode when starting a new session.
              </p>
            </div>
            <Popover open={permOpen} onOpenChange={setPermOpen}>
              <PopoverTrigger asChild>
                <button
                  disabled={disabled}
                  className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${currentPerm.color} ${currentPerm.hoverBg}`}
                >
                  {currentPerm.icon}
                  <span>{currentPerm.label}</span>
                  <ChevronDown className={`size-3 transition-transform duration-200 ${permOpen ? 'rotate-180' : ''}`} />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" side="bottom" className="w-52 border-border bg-card p-1">
                <PermissionModeList
                  activeMode={activePermMode}
                  autoEligibility={autoPlanEligibility}
                  onSelect={handlePermissionModeSelect}
                />
              </PopoverContent>
            </Popover>
          </div>
          <div className="flex items-center justify-between gap-4 p-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">Sandbox</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Default sandbox mode when starting a new session.
              </p>
            </div>
            <Popover open={sandboxOpen} onOpenChange={setSandboxOpen}>
              <PopoverTrigger asChild>
                <button
                  disabled={disabled}
                  className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${currentSandbox.color} ${currentSandbox.hoverBg}`}
                >
                  {currentSandbox.icon}
                  <span>{currentSandbox.label}</span>
                  <ChevronDown className={`size-3 transition-transform duration-200 ${sandboxOpen ? 'rotate-180' : ''}`} />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" side="bottom" className="w-56 border-border bg-card p-1">
                <div className="px-2 py-1.5 text-xs text-muted-foreground">Sandbox Mode</div>
                {sandboxModes.map((mode) => (
                  <button
                    key={mode.id}
                    onClick={() => handleSandboxModeSelect(mode.id)}
                    className={`w-full rounded px-2 py-1.5 text-left text-xs transition-colors ${
                      mode.id === activeSandboxMode
                        ? 'bg-muted text-foreground'
                        : 'text-foreground hover:bg-muted/50'
                    }`}
                  >
                    <div className={`flex items-center gap-1.5 font-medium ${mode.color}`}>
                      {mode.icon}
                      {mode.label}
                    </div>
                    <div className="mt-0.5 text-[10px] text-muted-foreground">{mode.description}</div>
                  </button>
                ))}
              </PopoverContent>
            </Popover>
          </div>
        </div>
      </div>
    </div>
  )
}
