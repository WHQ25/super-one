import { useTranslation } from 'react-i18next'
import { FolderLock } from 'lucide-react'
import type { PermissionRequest } from '@superone/shared/agent-types'
import { PermissionActionButton } from './PermissionActionBar'

export function FolderTrustPrompt({
  request,
  onTrust,
  onReject,
}: {
  request: PermissionRequest
  onTrust: () => void
  onReject: () => void
}) {
  const { t } = useTranslation()
  const cwd = typeof request.input.cwd === 'string' ? request.input.cwd : ''
  const workspace = typeof request.input.workspace === 'string' ? request.input.workspace : ''
  const kinds = Array.isArray(request.input.configKinds)
    ? request.input.configKinds.filter((item): item is string => typeof item === 'string')
    : []

  return (
    <div className="mx-3 mb-1 rounded-lg border border-border bg-background p-3 text-xs">
      <div className="mb-2 flex items-center gap-2 font-medium text-foreground">
        <FolderLock className="size-3.5 shrink-0" />
        {t('chat.acpPermissionModes.folderTrustTitle')}
      </div>
      <p className="mb-2 text-muted-foreground">{t('chat.acpPermissionModes.folderTrustBody')}</p>
      {workspace ? (
        <p className="truncate font-mono" title={workspace}>
          {t('chat.acpPermissionModes.folderTrustWorkspace')}: {workspace}
        </p>
      ) : null}
      {cwd ? (
        <p className="truncate font-mono" title={cwd}>
          {t('chat.acpPermissionModes.folderTrustCwd')}: {cwd}
        </p>
      ) : null}
      <p className="mt-1 text-muted-foreground">
        {kinds.length > 0
          ? `${t('chat.acpPermissionModes.folderTrustKinds')}: ${kinds.join(', ')}`
          : t('chat.acpPermissionModes.folderTrustEmptyKinds')}
      </p>
      <div className="mt-3 flex justify-end gap-2">
        <PermissionActionButton tone="reject" onClick={onReject}>
          {t('chat.acpPermissionModes.folderTrustReject')}
        </PermissionActionButton>
        <PermissionActionButton tone="primary" onClick={onTrust}>
          {t('chat.acpPermissionModes.folderTrustAllow')}
        </PermissionActionButton>
      </div>
    </div>
  )
}
