import { useCallback, useMemo, useState } from 'react'
import { ExternalLink, Loader2, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@superone/ui/components/ui/button'
import { Input } from '@superone/ui/components/ui/input'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { cn } from '@superone/ui/lib/utils'
import {
  cloneEndpoints,
  foldOverridesIntoEndpoints,
  isCustomPlatformId,
  type Credential,
  type EndpointOverride,
  type Plan,
  type Platform,
} from '@superone/shared/platform-registry'
import { useSettingsStore } from '@/stores/settings'
import { pruneOverrides } from './CredentialConfig'
import { planTestEndpoints, useEndpointTest } from './test-endpoints'
import { TestConnectionButton, TestConnectionStatus } from './TestConnection'

function KeyTab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        '-mb-px max-w-40 shrink-0 truncate border-b-2 px-2.5 py-1.5 text-xs transition-colors',
        active ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
    </button>
  )
}

/**
 * One form for both "edit the selected key" and "add a new key" — the two differ only in where the
 * secret is persisted and in the footer action, so keeping them separate would duplicate the name
 * conflict check, the test-connection wiring, and the layout.
 */
function KeyForm({
  platformId,
  planId,
  plan,
  platform,
  credential,
  seedFromCredential,
  pendingOverrides,
  takenNames,
  onCancel,
  onCreated,
}: {
  platformId: string
  planId: string
  plan: Plan
  platform?: Platform
  credential?: Credential
  /** When adding a key on a custom platform, clone endpoints from this key (else plan template). */
  seedFromCredential?: Credential
  pendingOverrides: Record<string, EndpointOverride>
  takenNames: string[]
  onCancel: () => void
  onCreated: (id: string) => void
}) {
  const { t } = useTranslation()
  const createCredential = useSettingsStore((s) => s.createCredential)
  const updateCredential = useSettingsStore((s) => s.updateCredential)
  const deleteCredential = useSettingsStore((s) => s.deleteCredential)
  const [name, setName] = useState(credential?.name ?? '')
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const { state: testState, run: runTest } = useEndpointTest()

  const overrides = credential?.overrides ?? pendingOverrides
  const test = useCallback(
    () =>
      void runTest(
        planTestEndpoints(plan, overrides, {
          platform,
          credential: credential ?? { overrides, endpoints: seedFromCredential?.endpoints },
        }),
        secret.trim(),
        credential?.id,
      ),
    [runTest, plan, overrides, secret, credential, platform, seedFromCredential?.endpoints],
  )

  const effectiveName = name.trim() || credential?.name || 'Key'
  // Sibling keys on the same platform, minus this one — renaming onto a sibling's name conflicts.
  const conflict = useMemo(
    () =>
      effectiveName.toLowerCase() !== credential?.name.toLowerCase() &&
      takenNames.some((n) => n.toLowerCase() === effectiveName.toLowerCase()),
    [takenNames, effectiveName, credential?.name],
  )

  const dirty = credential ? effectiveName !== credential.name || !!secret.trim() : !!(name.trim() || secret.trim())

  // A blank secret input means "keep the stored key" — only send `secret` when the user typed one.
  const submit = useCallback(async () => {
    if (conflict || !dirty) return
    setBusy(true)
    try {
      if (credential) {
        await updateCredential(credential.id, {
          name: effectiveName,
          ...(secret.trim() ? { secret: secret.trim() } : {}),
        })
        setSecret('')
      } else {
        const pruned = pruneOverrides(pendingOverrides)
        const isCustom = isCustomPlatformId(platformId)
        const seedEndpoints =
          seedFromCredential?.endpoints?.length
            ? cloneEndpoints(seedFromCredential.endpoints)
            : cloneEndpoints(plan.endpoints)
        const keyEndpoints = isCustom
          ? foldOverridesIntoEndpoints(seedEndpoints, pruned)
          : undefined
        const created = await createCredential({
          platformId,
          planId,
          name: effectiveName,
          secret: secret.trim(),
          ...(isCustom
            ? { endpoints: keyEndpoints }
            : Object.keys(pruned).length > 0
              ? { overrides: pruned }
              : {}),
        })
        onCreated(created.id)
      }
    } finally {
      setBusy(false)
    }
  }, [
    conflict,
    dirty,
    credential,
    effectiveName,
    secret,
    updateCredential,
    pendingOverrides,
    platformId,
    planId,
    plan.endpoints,
    seedFromCredential,
    createCredential,
    onCreated,
  ])

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Input
          className="w-36 shrink-0"
          placeholder={t('resources.providers.keyLabel')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={conflict}
        />
        <Input
          className="min-w-0 flex-1 font-mono"
          type="password"
          placeholder={
            credential
              ? credential.secretEnv
                ? `$${credential.secretEnv}`
                : credential.secret || t('resources.providers.apiKey')
              : t('resources.providers.apiKey')
          }
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
        />
        {credential && (
          <IconButton
            size="sm"
            variant="destructive"
            onClick={() => void deleteCredential(credential.id)}
          >
            <Trash2 />
          </IconButton>
        )}
      </div>
      {conflict && <span className="text-[11px] text-destructive">{t('resources.providers.keyNameConflict')}</span>}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <TestConnectionButton state={testState} onTest={test} disabled={!credential && !secret.trim()} />
          <TestConnectionStatus state={testState} />
        </div>
        <div className="flex items-center gap-2">
          {!credential && (
            <Button variant="ghost" size="sm" onClick={onCancel}>
              {t('common.cancel')}
            </Button>
          )}
          {dirty && (
            <Button size="sm" disabled={busy || conflict} onClick={submit}>
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : credential ? (
                t('common.save')
              ) : (
                t('resources.providers.addKey')
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * API keys as a tab strip: one tab per key plus a trailing "+" tab, so the card's height stays
 * constant no matter how many keys a platform has. The active tab drives `selectedKeyId`, which
 * also scopes the advanced-config and models panels below.
 */
export function CredentialTabs({
  platformId,
  platform,
  plan,
  planCreds,
  takenNames,
  selectedKeyId,
  onSelectKey,
  adding,
  onStartAdd,
  onDoneAdd,
  pendingOverrides,
}: {
  platformId: string
  platform?: Platform
  plan: Plan
  planCreds: Credential[]
  takenNames: string[]
  selectedKeyId: string
  onSelectKey: (id: string) => void
  adding: boolean
  onStartAdd: () => void
  onDoneAdd: () => void
  pendingOverrides: Record<string, EndpointOverride>
}) {
  const { t } = useTranslation()
  const selected = adding ? undefined : planCreds.find((c) => c.id === selectedKeyId)
  // When adding, seed from the previously selected key if any.
  const seedFrom = planCreds.find((c) => c.id === selectedKeyId) ?? planCreds[0]

  const created = useCallback(
    (id: string) => {
      onDoneAdd()
      onSelectKey(id)
    },
    [onDoneAdd, onSelectKey],
  )

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
      <div className="flex items-center gap-3 border-b border-border">
        <span className="shrink-0 text-sm font-semibold">{t('resources.providers.apiKeys')}</span>
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {planCreds.map((c) => (
            <KeyTab
              key={c.id}
              label={c.name.replace(/_/g, ' ')}
              active={!adding && c.id === selected?.id}
              onClick={() => {
                onDoneAdd()
                onSelectKey(c.id)
              }}
            />
          ))}
          <KeyTab label="+" active={adding} onClick={onStartAdd} />
        </div>
        {plan.apiKeyUrl && (
          <button
            type="button"
            className="flex shrink-0 items-center gap-1 pb-1.5 text-[11px] text-primary hover:underline"
            onClick={() => window.app.openExternalLink(plan.apiKeyUrl!)}
          >
            {t('resources.providers.getKey')}
            <ExternalLink className="size-3" />
          </button>
        )}
      </div>
      {adding || !selected ? (
        <KeyForm
          platformId={platformId}
          platform={platform}
          planId={plan.id}
          plan={plan}
          seedFromCredential={seedFrom}
          pendingOverrides={pendingOverrides}
          takenNames={takenNames}
          onCancel={onDoneAdd}
          onCreated={created}
        />
      ) : (
        <KeyForm
          key={selected.id}
          platformId={platformId}
          platform={platform}
          planId={plan.id}
          plan={plan}
          credential={selected}
          pendingOverrides={pendingOverrides}
          takenNames={takenNames}
          onCancel={onDoneAdd}
          onCreated={created}
        />
      )}
    </div>
  )
}
