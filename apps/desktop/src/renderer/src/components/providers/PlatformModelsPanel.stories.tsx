import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useState, type ReactNode } from 'react'
import { BUILTIN_PLATFORMS, findPlan, findPlatform } from '@superone/shared/platform-registry'
import type { Credential, Platform } from '@superone/shared/platform-registry'
import type { CatalogModel, ModelCatalog } from '@superone/shared/model-catalog-types'
import { mockIpc } from '../../../../../.storybook/mock-ipc'
import { useSettingsStore } from '@/stores/settings'
import { PlatformModelsPanel } from './PlatformModelsPanel'

/**
 * The model list for one plan, with the catalog and the key answered from fixtures. Toggling a
 * row writes to an in-memory credential, so enabling a model is reproducible without a real key.
 */
const model = (providerId: string, id: string, name: string, extra: Partial<CatalogModel> = {}): CatalogModel => ({
  id,
  name,
  providerId,
  inputModalities: ['text'],
  outputModalities: ['text'],
  reasoning: true,
  toolCall: true,
  attachment: false,
  contextWindow: 262144,
  ...extra,
})

const CATALOG: ModelCatalog = {
  generatedAt: '2026-09-24T00:00:00.000Z',
  source: 'cache',
  providers: [
    {
      id: 'xiaomi',
      name: 'Xiaomi',
      env: [],
      npm: '@ai-sdk/anthropic',
      doc: '',
      models: [
        model('xiaomi', 'mimo-v2.6-pro', 'MiMo-V2.6-Pro', { contextWindow: 1048576, releaseDate: '2026-09-22', cost: { input: 0.435, output: 0.87 } }),
        model('xiaomi', 'mimo-v2.6-flash', 'MiMo-V2.6-Flash', { releaseDate: '2026-09-22' }),
        model('xiaomi', 'mimo-v2.5-pro', 'MiMo-V2.5-Pro', { contextWindow: 1048576, releaseDate: '2026-04-22' }),
        model('xiaomi', 'mimo-v2-pro', 'MiMo-V2-Pro', { releaseDate: '2025-12-01', status: 'deprecated' }),
      ],
    },
    {
      id: 'moonshotai',
      name: 'Moonshot AI',
      env: [],
      npm: '@ai-sdk/anthropic',
      doc: '',
      models: [model('moonshotai', 'k3', 'Kimi K3', { releaseDate: '2026-08-01' }), model('moonshotai', 'kimi-k2.6', 'Kimi K2.6')],
    },
  ],
}

let credentials: Credential[] = []
mockIpc('app', 'getModelCatalog', async () => CATALOG)
mockIpc('app', 'refreshModelCatalog', async () => CATALOG)
mockIpc('app', 'listPlatforms', async () => BUILTIN_PLATFORMS)
mockIpc('app', 'listCredentials', async () => credentials)
mockIpc('app', 'listBindings', async () => [])
mockIpc('app', 'updateCredential', async (id: unknown, patch: unknown) => {
  credentials = credentials.map((c) => (c.id === id ? { ...c, ...(patch as Partial<Credential>) } : c))
})

function key(platformId: string, planId: string, overrides?: Credential['overrides']): Credential {
  return { id: `${platformId}-${planId}`, platformId, planId, name: 'Key', secret: '***abcdef', notes: '', sortOrder: 0, overrides }
}

function Frame({ creds, width = 640, children }: { creds: Credential[]; width?: number; children: ReactNode }) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    credentials = creds
    useSettingsStore.setState({ providerScope: 'local', platforms: BUILTIN_PLATFORMS, credentials: creds })
    setReady(true)
  }, [creds])
  return ready ? <div className="rounded-lg border border-border p-4" style={{ width }}>{children}</div> : null
}

function Panel({ platformId, planId, creds, width }: { platformId: string; planId: string; creds: Credential[]; width?: number }) {
  const platform: Platform = findPlatform(BUILTIN_PLATFORMS, platformId)!
  return (
    <Frame creds={creds} width={width}>
      <PlatformModelsPanel platform={platform} plan={findPlan(platform, planId)!} selectedKeyId={creds[0]?.id} />
    </Frame>
  )
}

const meta: Meta<typeof Panel> = {
  title: 'Providers/PlatformModelsPanel',
  component: Panel,
  parameters: { layout: 'centered' },
}
export default meta
type Story = StoryObj<typeof Panel>

/** Issue #66: every catalog model on the Xiaomi API plan can be switched on; the preset model is locked on. */
export const XiaomiApi: Story = {
  args: { platformId: 'xiaomi', planId: 'api', creds: [key('xiaomi', 'api')] },
}

export const XiaomiApiWithEnabledModel: Story = {
  args: {
    platformId: 'xiaomi',
    planId: 'api',
    creds: [key('xiaomi', 'api', { anthropic: { models: [{ id: 'mimo-v2.6-flash', name: 'MiMo-V2.6-Flash', tasks: ['chat'] }] } })],
  },
}

/** A curated plan lists its own pool — including ids the catalog does not know — not the whole provider. */
export const KimiCuratedPool: Story = {
  args: { platformId: 'kimi', planId: 'plus', creds: [key('kimi', 'plus')] },
}

/** Without a key the list is read-only: no switches. */
export const NoKey: Story = {
  args: { platformId: 'xiaomi', planId: 'api', creds: [] },
}

/** A platform models.dev does not cover shows the empty entry; models are added by hand. */
export const NoCatalogEntry: Story = {
  args: { platformId: 'kat-coder', planId: 'api', creds: [key('kat-coder', 'api')] },
}

export const Narrow: Story = {
  args: { platformId: 'xiaomi', planId: 'api', creds: [key('xiaomi', 'api')], width: 480 },
}
