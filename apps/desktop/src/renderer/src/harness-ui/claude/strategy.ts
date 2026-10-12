import { applyDefaultModel } from '@/stores/chat-store/helpers/agent-defaults'
import { neutralSelection } from '../neutral-selection'
import type { HarnessStrategy } from '../strategy'

export const claudeStrategy: HarnessStrategy = {
  selection: neutralSelection,
  queuePolicy: 'always',
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
        ...(enabledSkills?.length ? { enabledSkills } : {}),
        ...(disabledSkills ? { disabledSkills } : {}),
      },
    }
  },
  draftSettings: (session) => ({ ultracode: session.ultracode }),
}
