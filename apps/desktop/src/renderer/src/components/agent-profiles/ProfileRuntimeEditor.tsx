import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentProfileConfirmEditor, AgentProfileDraft, HarnessId, PermissionMode } from '@superone/shared/agent-types'
import { launchDefaultsFromConfig } from '@superone/shared/agent-profile'
import { agentProfileOptionRows, agentProfileOptionsForModel, isModelBoundOption, setAgentProfileOptionRow, type AgentProfileOptionKey } from '@superone/shared/agent-profile-options'
import { HARNESS_CONTROLS } from '@/harness-ui/controls'
import type { LaunchModelPatch } from '@/harness-ui/launch-model'
import { LaunchSettingsBar } from '../chat/launch-settings-bar'

const P = 'chat.permission.agentProfile'

/** The same runtime controls in the agent confirmation and human settings editor. */
export function ProfileRuntimeEditor({ harnessId, acpAgentId, editor, draft, onChange, catalogMode = 'local' }: {
  harnessId: HarnessId
  acpAgentId?: string
  editor: AgentProfileConfirmEditor
  draft: AgentProfileDraft
  onChange: (patch: Partial<AgentProfileDraft>) => void
  catalogMode?: 'local' | 'profile'
}) {
  const { t } = useTranslation()
  const { agent, catalog } = editor
  const defaults = agent?.defaultConfig
  const { LaunchModelControl } = HARNESS_CONTROLS[harnessId]
  // An unset field shows what a launch would start with; it stays unset until the user picks.
  const model = draft.model ?? defaults?.model
  const optionDefaults = useMemo(() => launchDefaultsFromConfig(defaults).options, [defaults])
  const optionParams = useMemo(
    () => agentProfileOptionRows(harnessId, catalog, model, draft.options, optionDefaults, {
      field: (key) => t(`${P}.fields.${key}`),
      userDefault: t(`${P}.userDefault`),
      on: t(`${P}.on`),
      off: t(`${P}.off`),
    }),
    [harnessId, catalog, model, draft.options, optionDefaults, t],
  )

  const changeModel = (patch: LaunchModelPatch) => {
    const next: Partial<AgentProfileDraft> = {}
    if (patch.model && patch.model !== draft.model) {
      next.model = patch.model
      next.options = agentProfileOptionsForModel(harnessId, catalog, patch.model, draft.options)
    }
    if (patch.effort) next.effort = patch.effort
    if (Object.keys(next).length) onChange(next)
  }

  const changeOption = (rowId: string, value: string) => {
    // A model-bound option is only valid for the model it was picked on, so that model is pinned too.
    const key = rowId.split('.')[0] as AgentProfileOptionKey
    onChange({
      options: setAgentProfileOptionRow(draft.options, rowId, value),
      ...(!draft.model && model && isModelBoundOption(key) ? { model } : {}),
    })
  }

  return (
    <LaunchSettingsBar
      harnessId={harnessId}
      settings={{ permissionMode: draft.permissionMode ?? defaults?.permissionMode }}
      offerSandbox={false}
      onChange={(patch) => {
        if (patch.permissionMode) onChange({ permissionMode: patch.permissionMode as PermissionMode })
      }}
    >
      <LaunchModelControl
        profile={agent}
        catalog={catalogMode}
        acpAgentId={acpAgentId ?? null}
        apiProviderId={defaults?.apiProviderId}
        hideApiProvider
        model={model}
        effort={draft.effort ?? defaults?.effort}
        optionParams={optionParams}
        onOptionParamChange={changeOption}
        onChange={changeModel}
      />
    </LaunchSettingsBar>
  )
}
