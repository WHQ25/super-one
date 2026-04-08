import { useState, useMemo, useEffect } from 'react'
import { Globe, HardDrive, FolderOpen, Package, ArrowUpCircle, Link, Check, Wrench } from 'lucide-react'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useMiniAppStore } from '@/stores/miniapp'
import { useAppStore } from '@/stores/app'
import { cn } from '@/lib/utils'
import type { MiniAppFsEntry } from '../../../../shared/miniapp-types'

type InstallTarget = 'personal' | 'project'
type ReviewTab = 'permissions' | 'tools'

function ApprovalCheck({ checked }: { checked: boolean }) {
  return (
    <div className={cn('flex size-4 shrink-0 items-center justify-center rounded border transition-colors', checked ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-muted-foreground/30')}>
      {checked && <Check className="size-3" />}
    </div>
  )
}

function formatFsLabel(entry: MiniAppFsEntry): { label: string; detail: string } {
  switch (entry.scope) {
    case 'project':
      return { label: 'Project', detail: entry.path === '.' ? 'Root directory' : entry.path! }
    case 'user':
      return { label: 'Home', detail: `~/${entry.path}` }
    case 'app':
      return { label: 'App', detail: 'Own data storage' }
  }
}

interface Props {
  onInstalled: (name: string, upgraded: boolean) => void
  onError: (message: string) => void
}

export function InstallPermissionDialog({ onInstalled, onError }: Props) {
  const pendingInstall = useMiniAppStore((s) => s.pendingInstall)
  const confirmInstall = useMiniAppStore((s) => s.confirmInstall)
  const cancelInstall = useMiniAppStore((s) => s.cancelInstall)
  const currentFolder = useAppStore((s) => s.currentFolder)
  const [approved, setApproved] = useState<Set<string>>(new Set())
  const [installTarget, setInstallTarget] = useState<InstallTarget>('personal')
  const [activeTab, setActiveTab] = useState<ReviewTab>('permissions')
  useEffect(() => { setApproved(new Set()); setInstallTarget('personal'); setActiveTab('permissions') }, [pendingInstall])

  const manifest = pendingInstall?.manifest
  const existingVersion = pendingInstall?.existingVersion
  const fsEntries = manifest?.permissions?.fs ?? []
  const networkEntries = manifest?.permissions?.network ?? []
  const tools = manifest?.tools ?? []
  const hasPermissions = fsEntries.length > 0 || networkEntries.length > 0
  const hasTools = tools.length > 0
  const isUpgrade = !!existingVersion && existingVersion !== manifest?.version

  const permissionKeys = useMemo(() => [
    ...fsEntries.map((_, i) => `fs:${i}`),
    ...networkEntries.map((e) => `net:${e.domain}`),
  ], [fsEntries, networkEntries])

  const toolKeys = useMemo(() => tools.map((_, i) => `tool:${i}`), [tools])
  const allPermissionsApproved = !hasPermissions || permissionKeys.every((k) => approved.has(k))

  const preapprovedToolNames = useMemo(() => {
    return tools.filter((_, i) => approved.has(`tool:${i}`)).map((t) => t.name)
  }, [tools, approved])

  const toggleApproval = (key: string) => {
    setApproved((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const toggleAllKeys = (keys: string[]) => {
    setApproved((prev) => {
      const next = new Set(prev)
      const allChecked = keys.every((k) => next.has(k))
      for (const k of keys) allChecked ? next.delete(k) : next.add(k)
      return next
    })
  }

  if (!pendingInstall || !manifest) return null

  const handleConfirm = async () => {
    try {
      const installDir = installTarget === 'project' && currentFolder
        ? `${currentFolder}/.superone/apps`
        : undefined
      const result = await confirmInstall(installDir, preapprovedToolNames.length > 0 ? preapprovedToolNames : undefined)
      onInstalled(result.entry.manifest.name, result.upgraded)
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Install failed')
    }
  }

  const handleCancel = () => {
    cancelInstall()
  }

  const folderName = currentFolder?.split('/').pop()
  const showTabs = hasPermissions && hasTools

  return (
    <Dialog open onOpenChange={(open) => { if (!open) handleCancel() }}>
      <DialogContent showCloseButton={false} className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isUpgrade ? (
              <ArrowUpCircle className="size-5 text-orange-500" />
            ) : (
              <Package className="size-5 text-orange-500" />
            )}
            {isUpgrade ? 'Upgrade Mini App' : 'Install Mini App'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border bg-muted/30 p-3">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <div className="min-w-0">
                <span className="font-medium">{manifest.name}</span>
                {manifest.author && <span className="ml-1 text-muted-foreground">by {manifest.author.name}</span>}
              </div>
              {manifest.version && <span className="shrink-0 text-xs text-muted-foreground">v{manifest.version}</span>}
            </div>
            {manifest.description && (
              <div className="mt-0.5 text-xs text-muted-foreground">{manifest.description}</div>
            )}
            {manifest.author?.url && (
              <a href={manifest.author.url} target="_blank" rel="noopener noreferrer" className="mt-1 flex items-center gap-1.5 text-xs text-blue-500 hover:underline">
                <Link className="size-3 shrink-0" />
                <span className="truncate">{manifest.author.url}</span>
              </a>
            )}
            {isUpgrade && (
              <div className="mt-1.5 text-xs text-orange-500">{existingVersion} → {manifest.version}</div>
            )}
          </div>

          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Install to</div>
            <div className="flex gap-2">
              <button
                onClick={() => setInstallTarget('personal')}
                className="flex flex-1 items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-medium">Personal</div>
                  <div className="text-xs text-muted-foreground">All projects</div>
                </div>
                <ApprovalCheck checked={installTarget === 'personal'} />
              </button>
              <button
                onClick={() => currentFolder && setInstallTarget('project')}
                disabled={!currentFolder}
                className={cn(
                  'flex flex-1 items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50',
                  !currentFolder && 'cursor-not-allowed opacity-40',
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="font-medium">Project</div>
                  <div className="truncate text-xs text-muted-foreground">{folderName ?? 'No project open'}</div>
                </div>
                <ApprovalCheck checked={installTarget === 'project'} />
              </button>
            </div>
          </div>

          {(hasPermissions || hasTools) && (
            showTabs ? (
              <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ReviewTab)}>
                <TabsList className="w-full">
                  <TabsTrigger value="permissions" className="flex-1">Permissions</TabsTrigger>
                  <TabsTrigger value="tools" className="flex-1">Tools</TabsTrigger>
                </TabsList>
                <TabsContent value="permissions" className="mt-3">
                  <PermissionsSection
                    fsEntries={fsEntries}
                    networkEntries={networkEntries}
                    permissionKeys={permissionKeys}
                    approved={approved}
                    allApproved={allPermissionsApproved}
                    onToggle={toggleApproval}
                    onToggleAll={() => toggleAllKeys(permissionKeys)}
                  />
                </TabsContent>
                <TabsContent value="tools" className="mt-3">
                  <ToolsSection
                    tools={tools}
                    toolKeys={toolKeys}
                    approved={approved}
                    onToggle={toggleApproval}
                    onToggleAll={() => toggleAllKeys(toolKeys)}
                  />
                </TabsContent>
              </Tabs>
            ) : hasPermissions ? (
              <PermissionsSection
                fsEntries={fsEntries}
                networkEntries={networkEntries}
                permissionKeys={permissionKeys}
                approved={approved}
                allApproved={allPermissionsApproved}
                onToggle={toggleApproval}
                onToggleAll={() => toggleAllKeys(permissionKeys)}
              />
            ) : (
              <ToolsSection
                tools={tools}
                toolKeys={toolKeys}
                approved={approved}
                onToggle={toggleApproval}
                onToggleAll={() => toggleAllKeys(toolKeys)}
              />
            )
          )}

          {!hasPermissions && !hasTools && (
            <div className="text-center text-sm text-muted-foreground py-2">
              This app requires no special permissions.
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>Cancel</Button>
          <Button onClick={handleConfirm} disabled={!allPermissionsApproved}>
            {isUpgrade ? 'Upgrade' : 'Install'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PermissionsSection({
  fsEntries,
  networkEntries,
  permissionKeys,
  approved,
  allApproved,
  onToggle,
  onToggleAll,
}: {
  fsEntries: MiniAppFsEntry[]
  networkEntries: { domain: string; reason: string }[]
  permissionKeys: string[]
  approved: Set<string>
  allApproved: boolean
  onToggle: (key: string) => void
  onToggleAll: () => void
}) {
  return (
    <div className="space-y-3">
      <div>
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Permissions</div>
        <div className="mt-0.5 text-xs text-muted-foreground">Review and approve each permission to continue.</div>
      </div>

      <button onClick={onToggleAll} className="flex w-full items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
        <ApprovalCheck checked={allApproved} />
        Allow all permissions
      </button>

      <div className="max-h-80 space-y-1.5 overflow-y-auto">
        {fsEntries.map((entry, i) => {
          const key = permissionKeys[i]
          const isApproved = approved.has(key)
          const { label, detail } = formatFsLabel(entry)
          const accessLabel = entry.scope === 'app' ? 'Read & Write' : entry.access === 'read' ? 'Read only' : 'Read & Write'
          return (
            <button key={key} onClick={() => onToggle(key)} className="flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left transition-colors hover:bg-muted/50">
              {entry.scope === 'project' ? (
                <FolderOpen className="size-5 shrink-0 text-muted-foreground" />
              ) : (
                <HardDrive className="size-5 shrink-0 text-muted-foreground" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-sm">
                  <span className="font-medium">{label}</span>
                  <span className="text-muted-foreground">{detail}</span>
                  <span className={cn('inline-flex h-4 shrink-0 items-center rounded px-1 text-[10px] leading-none', entry.access === 'read' ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400' : 'bg-orange-500/10 text-orange-600 dark:text-orange-400')}>{accessLabel}</span>
                </div>
                <div className="text-xs text-muted-foreground">{entry.reason}</div>
              </div>
              <ApprovalCheck checked={isApproved} />
            </button>
          )
        })}
        {networkEntries.map((entry) => {
          const key = `net:${entry.domain}`
          const isApproved = approved.has(key)
          return (
            <button key={key} onClick={() => onToggle(key)} className="flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left transition-colors hover:bg-muted/50">
              <Globe className="size-5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-mono">{entry.domain}</div>
                <div className="text-xs text-muted-foreground">{entry.reason}</div>
              </div>
              <ApprovalCheck checked={isApproved} />
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ToolsSection({
  tools,
  toolKeys,
  approved,
  onToggle,
  onToggleAll,
}: {
  tools: { name: string; description: string }[]
  toolKeys: string[]
  approved: Set<string>
  onToggle: (key: string) => void
  onToggleAll: () => void
}) {
  const allToolsApproved = toolKeys.every((k) => approved.has(k))

  return (
    <div className="space-y-3">
      <div>
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Tool Preapproval</div>
        <div className="mt-0.5 text-xs text-muted-foreground">Pre-approve tools to skip permission prompts when the agent uses them. You can change this later in Settings.</div>
      </div>

      <button onClick={onToggleAll} className="flex w-full items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
        <ApprovalCheck checked={allToolsApproved} />
        Pre-approve all tools
      </button>

      <div className="max-h-80 space-y-1.5 overflow-y-auto">
        {tools.map((tool, i) => {
          const key = toolKeys[i]
          const isApproved = approved.has(key)
          return (
            <button key={key} onClick={() => onToggle(key)} className="flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left transition-colors hover:bg-muted/50">
              <Wrench className="size-5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-mono">{tool.name}</div>
                <div className="text-xs text-muted-foreground">{tool.description}</div>
              </div>
              <ApprovalCheck checked={isApproved} />
            </button>
          )
        })}
      </div>
    </div>
  )
}
