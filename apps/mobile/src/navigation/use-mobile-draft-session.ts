import type { HarnessId, ImageAttachment, SandboxInfo, SandboxMode } from '@superone/shared/agent-types'
import type { Project } from '../project-types'
import type { NewSessionWorktreeSelection } from '../worktree-state'
import { composerFromRemoteDraft, draftWorktreeSettings, worktreeFromDraft } from '../remote-draft-codec'
import { EMPTY_COMPOSER_DRAFT } from '../composer-draft-state'
import { useRemoteDrafts } from './use-remote-drafts'
import type { useHarnessSelection } from './use-harness-selection'

/** Adapts the shared draft record to the existing mobile session pickers. The
 * shell owns navigation; this hook owns which settings travel with a draft. */
export function useMobileDraftSession(opts: Omit<Parameters<typeof useRemoteDrafts>[0], 'settings' | 'apply' | 'onRevoked' | 'projectPath'> & {
  project: Project | null
  projects: Project[]
  selection: ReturnType<typeof useHarnessSelection>
  worktree: NewSessionWorktreeSelection
  sandbox: SandboxInfo | null
  sessionDirs: string[]
  restoreSessionDirs(dirs: string[]): void
  setWorktree(value: NewSessionWorktreeSelection): void
  setSandbox(value: SandboxMode): void
  setAttachments(attachments: ImageAttachment[]): void
  setHarness(harness: HarnessId): void
  applyText(text: string): void
  openProject(project: Project): Promise<void>
  loadSettings(provider: HarnessId, project: Project): Promise<void>
  leaveSession(): void
  showDraft(title: string): void
  showWorkspace(): void
}) {
  const { selection: s } = opts
  return useRemoteDrafts({
    ...opts, projectPath: opts.project?.path,
    settings: {
      harness: s.selectedProvider, model: s.selectedModel, effort: s.selectedEffort,
      modelUserChosen: !!s.selectedModel, effortUserChosen: !!s.selectedEffort,
      codexModel: s.selectedProvider === 'codex' ? s.selectedModel : null,
      codexReasoningEffort: s.selectedProvider === 'codex' ? s.selectedEffort : null,
      codexServiceTier: s.serviceTier,
      codexPermissionPreset: s.selectedProvider === 'codex' ? s.permissionMode : null,
      permissionMode: s.permissionMode, acpAgentId: s.selectedAcpAgentId,
      openCodeAgentId: s.selectedAgentId, selectedAcpModeId: s.selectedModeId, apiProviderId: s.selectedProviderId,
      sandboxEnabled: opts.sandbox?.enabled, sandboxAutoAllowBash: opts.sandbox?.autoAllowBash,
      additionalDirs: opts.sessionDirs, ...draftWorktreeSettings(opts.worktree),
    },
    apply: async (row) => {
      if (!row.projectPath) throw new Error('This draft has no project')
      opts.leaveSession()
      const target = opts.projects.find((p) => p.path === row.projectPath)
        ?? { path: row.projectPath, name: row.projectPath.split(/[\\/]/).filter(Boolean).pop() ?? row.projectPath }
      await opts.openProject(target)
      const provider = row.settings.harness ?? row.harness ?? 'claude'
      s.resetForProvider(provider, row.settings.acpAgentId)
      await opts.loadSettings(provider, target)
      s.restoreDraft({ harness: row.harness, model: row.model, permissionMode: row.permissionMode, ...row.settings })
      opts.setHarness(provider)
      opts.setWorktree(worktreeFromDraft(row.settings))
      if (row.settings.sandboxEnabled !== undefined) opts.setSandbox(row.settings.sandboxEnabled ? row.settings.sandboxAutoAllowBash ? 'auto' : 'on' : 'off')
      opts.restoreSessionDirs(row.settings.additionalDirs ?? [])
      const restored = composerFromRemoteDraft(row)
      opts.composer.replaceWith(restored)
      opts.applyText(restored.text)
      opts.setAttachments(restored.attachments)
      opts.showDraft(row.title || 'Draft')
    },
    onRevoked: () => {
      opts.composer.replaceWith(EMPTY_COMPOSER_DRAFT)
      opts.setAttachments([])
      opts.applyText('')
      opts.showWorkspace()
    },
  })
}
