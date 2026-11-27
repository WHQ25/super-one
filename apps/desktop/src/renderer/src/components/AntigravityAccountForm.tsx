import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@superone/ui/components/ui/button'
import { Input } from '@superone/ui/components/ui/input'
import { Label } from '@superone/ui/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@superone/ui/components/ui/select'
import type { AntigravityAuthMethod } from '@superone/shared/antigravity-auth'

export interface AntigravityAccountFormValues {
  label: string
  authMethod: AntigravityAuthMethod
  apiKey: string
  gcpProject: string
  gcpLocation: string
}

export function AntigravityAccountForm({
  initialLabel = '',
  initialAuthMethod = 'oauth-personal',
  initialGcpProject = '',
  initialGcpLocation = 'us-central1',
  hasApiKey = false,
  disabled = false,
  submitLabel,
  onClearApiKey,
  onSubmit,
  onCancel,
}: {
  initialLabel?: string
  initialAuthMethod?: AntigravityAuthMethod
  initialGcpProject?: string
  initialGcpLocation?: string
  hasApiKey?: boolean
  disabled?: boolean
  submitLabel: string
  onClearApiKey?: () => void
  onSubmit: (values: AntigravityAccountFormValues) => void | Promise<void>
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const labelId = useId()
  const apiKeyId = useId()
  const gcpProjectId = useId()
  const gcpLocationId = useId()

  const [label, setLabel] = useState(initialLabel)
  const [authMethod, setAuthMethod] = useState<AntigravityAuthMethod>(initialAuthMethod)
  const [apiKey, setApiKey] = useState('')
  const [gcpProject, setGcpProject] = useState(initialGcpProject)
  const [gcpLocation, setGcpLocation] = useState(initialGcpLocation || 'us-central1')

  const needsApiKey = authMethod === 'gemini-api-key' || authMethod === 'agent-platform'
  const needsGcpConfig = authMethod === 'oauth-business' || authMethod === 'agent-platform'

  return (
    <form
      className="flex flex-col gap-3 rounded-lg border border-border/70 bg-muted/20 p-3"
      onSubmit={(event) => {
        event.preventDefault()
        void onSubmit({
          label: label.trim(),
          authMethod,
          apiKey: apiKey.trim(),
          gcpProject: gcpProject.trim(),
          gcpLocation: gcpLocation.trim() || 'us-central1',
        })
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={labelId} className="text-xs">
            {t('antigravityAuth.accountLabel')}
          </Label>
          <Input
            id={labelId}
            className="h-8 bg-background"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder={t('antigravityAuth.accountLabelPlaceholder')}
            spellCheck={false}
            disabled={disabled}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">{t('antigravityAuth.methodLabel')}</Label>
          <Select
            value={authMethod}
            onValueChange={(value) => setAuthMethod(value as AntigravityAuthMethod)}
            disabled={disabled}
          >
            <SelectTrigger size="sm" className="h-8 w-full bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="oauth-personal">{t('antigravityAuth.methods.oauthPersonal')}</SelectItem>
              <SelectItem value="oauth-business">{t('antigravityAuth.methods.oauthBusiness')}</SelectItem>
              <SelectItem value="gemini-api-key">{t('antigravityAuth.methods.geminiApiKey')}</SelectItem>
              <SelectItem value="agent-platform">{t('antigravityAuth.methods.agentPlatform')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {needsApiKey && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor={apiKeyId} className="text-xs">
              {t('antigravityAuth.apiKeyLabel')}
            </Label>
            {hasApiKey && (
              <span className="text-xs text-success">{t('antigravityAuth.apiKeySaved')}</span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Input
              id={apiKeyId}
              type="password"
              className="h-8 min-w-0 flex-1 basis-48 bg-background"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={t('antigravityAuth.apiKeyPlaceholder')}
              autoComplete="off"
              spellCheck={false}
              disabled={disabled}
            />
            {hasApiKey && onClearApiKey && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8"
                disabled={disabled}
                onClick={onClearApiKey}
              >
                {t('antigravityAuth.clearApiKey')}
              </Button>
            )}
          </div>
        </div>
      )}

      {needsGcpConfig && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={gcpProjectId} className="text-xs">
              {t('antigravityAuth.gcpProjectLabel')}
            </Label>
            <Input
              id={gcpProjectId}
              className="h-8 bg-background"
              value={gcpProject}
              onChange={(event) => setGcpProject(event.target.value)}
              placeholder={t('antigravityAuth.gcpProjectPlaceholder')}
              spellCheck={false}
              disabled={disabled}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={gcpLocationId} className="text-xs">
              {t('antigravityAuth.gcpLocationLabel')}
            </Label>
            <Input
              id={gcpLocationId}
              className="h-8 bg-background"
              value={gcpLocation}
              onChange={(event) => setGcpLocation(event.target.value)}
              placeholder={t('antigravityAuth.gcpLocationPlaceholder')}
              spellCheck={false}
              disabled={disabled}
            />
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" className="h-7" disabled={disabled} onClick={onCancel}>
          {t('antigravityAuth.cancel')}
        </Button>
        <Button type="submit" size="sm" className="h-7" disabled={disabled}>
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}
