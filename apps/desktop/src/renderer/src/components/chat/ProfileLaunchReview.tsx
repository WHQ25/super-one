import { useTranslation } from 'react-i18next'
import type { HarnessId, SessionAgentLaunchConfig } from '@superone/shared/agent-types'
import { HARNESS_CONTROLS } from '@/harness-ui/controls'
import { profileLaunchSandboxMode } from '@superone/shared/agent-profile-launch'

/** The effective runtime configuration covered by saved Profile consent. */
export function ProfileLaunchReview({ config, harnessId, acpAgentId }: { config: SessionAgentLaunchConfig; harnessId?: HarnessId; acpAgentId?: string }) {
  const { t } = useTranslation()
  const permission = harnessId ? HARNESS_CONTROLS[harnessId].launchPermission?.(config.permissionMode ?? 'default', () => {})?.labelKey : undefined
  const agentField = harnessId ? HARNESS_CONTROLS[harnessId].launchAgentField : undefined
  const fields = {
    ...(agentField ? { [agentField]: acpAgentId ?? t('chat.permission.agentProfile.unresolvedAgent') } : {}),
    model: config.model,
    effort: config.effort,
    permissionMode: config.codexPermissionPreset === 'read-only' ? t('resources.automation.readOnly') : permission ? t(permission) : config.permissionMode ?? 'default',
    sandboxMode: profileLaunchSandboxMode(config, harnessId),
    apiProviderId: config.apiProviderId ?? t('chat.permission.agentProfile.defaultAccount'),
    ...((config.fastMode ?? config.claudeFastMode) !== undefined ? { fastMode: t(`chat.permission.agentProfile.${(config.fastMode ?? config.claudeFastMode) ? 'on' : 'off'}`) } : {}),
    ...(config.options ? Object.fromEntries(Object.entries(config.options).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : String(v)])) : {}),
  }
  return <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
    {Object.entries(fields).filter(([, value]) => value !== undefined).map(([key, value]) => <div key={key} className="contents">
      <dt className="text-muted-foreground">{t(`chat.permission.agentProfile.fields.${key}`, { defaultValue: key })}</dt>
      <dd className="min-w-0 break-words">{value}</dd>
    </div>)}
  </dl>
}
