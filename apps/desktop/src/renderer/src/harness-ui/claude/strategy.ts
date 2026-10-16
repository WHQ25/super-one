import { parseRemoteProjectKey } from '@/lib/remote-project-key'
import { applyDefaultModel, resolveDefaultClaudeEffort, resolveDefaultClaudeModel } from '@/stores/chat-store/helpers/agent-defaults'
import { buildSlashCommands } from '@/stores/chat-store/helpers/chat-helpers'
import { getProject, projectClaudeModels, updateProjectState } from '@/stores/chat-store/helpers/store-helpers'
import { neutralSelection } from '../neutral-selection'
import type { HarnessStrategy } from '../strategy'

export const claudeStrategy: HarnessStrategy = {
  selection: neutralSelection,
  queuePolicy: 'always',
  slash: { hostCommands: ['clear', 'provider', 'mcp', 'workflows', 'side'] },
  seed: (session, { claudeModels }) => applyDefaultModel(session, claudeModels),
  missingDefaults: (session, _project, claudeModels) => {
    if (session.selectedModel) return {}
    const draft = { ...session }
    applyDefaultModel(draft, claudeModels)
    return { selectedModel: draft.selectedModel, selectedEffort: draft.selectedEffort }
  },
  prewarmHint: (session) => ({ model: session.selectedModel || undefined, effort: session.selectedEffort }),
  turnSettings: ({ state, project, session }) => {
    // Desktop disabled-skills filter → Claude SDK skills allow-list (a node discovers the rest).
    const disabledSkills = state.disabledSkills?.length ? state.disabledSkills : undefined
    const known = disabledSkills ? [...project.slashCommands, ...project._projectSkills].filter((c) => c.isSkill).map((c) => c.name) : []
    const enabledSkills = disabledSkills && known.length ? known.filter((name) => !disabledSkills.includes(name)) : undefined
    return {
      portable: {
        ultracode: session.ultracode,
        claudeFastMode: session.claudeFastMode,
        ...(enabledSkills?.length ? { enabledSkills } : {}),
        ...(disabledSkills ? { disabledSkills } : {}),
      },
    }
  },
  draftSettings: (session) => ({ ultracode: session.ultracode, claudeFastMode: session.claudeFastMode }),
  resetFields: (state, projectPath) => {
    const defaultModel = resolveDefaultClaudeModel(projectClaudeModels(state, projectPath))
    return {
      selectedModel: defaultModel?.id ?? '',
      selectedEffort: resolveDefaultClaudeEffort(defaultModel),
      modelUserChosen: false,
      effortUserChosen: false,
    }
  },
  onSelect: ({ set, get, projectPath, session, patch, isCurrent }) => {
    const isRemote = !!parseRemoteProjectKey(projectPath)
    if (!isRemote) {
      set((s) => {
        const claude = s.harnessResources.claude
        if (!claude) return {}
        const project = getProject(s, projectPath)
        return updateProjectState(s, projectPath, () => ({
          slashCommands: buildSlashCommands(
            claude.slashCommands,
            claude.skills,
            claude.commands,
            project._projectSkills,
            project._projectCommands,
            new Set(s.disabledSkills),
          ),
        }))
      })
    }
    const afterModels = () => {
      if (!isCurrent()) return
      const current = session()
      const claudeModels = projectClaudeModels(get(), projectPath)
      if (claudeModels.length === 0) return
      if (current.selectedModel && claudeModels.some((m) => m.id === current.selectedModel)) return
      const defaultModel = resolveDefaultClaudeModel(claudeModels)
      if (!defaultModel) return
      patch({
        selectedModel: defaultModel.id,
        selectedEffort: resolveDefaultClaudeEffort(defaultModel),
        modelUserChosen: false,
        effortUserChosen: false,
      })
    }
    if (isRemote) void get().refreshClaudeResources(false).then(afterModels)
    else void get().initializeHarness('claude').then(afterModels)
  },
}
