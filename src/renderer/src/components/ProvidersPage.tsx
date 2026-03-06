import { type ReactNode, useEffect, useState, useCallback, useMemo } from 'react'
import { Check, Globe, Plus, Server } from 'lucide-react'
import { Anthropic, OpenRouter, Zhipu, Kimi, Minimax, Volcengine, Bailian, Bedrock, Google, DeepSeek, Doubao, KwaiKAT, LongCat, ModelScope, Nvidia, SiliconCloud, XiaomiMiMo, OpenAI } from '@lobehub/icons'
import { useSettingsStore } from '@/stores/settings'
import { useAppStore } from '@/stores/app'
import { Button } from '@/components/ui/button'
import type { IconType } from '@lobehub/icons'
import type { ApiProvider, AgentType, CreateProviderRequest, UpdateProviderRequest } from '../../../shared/agent-types'
import { ProviderDialog } from './ProviderDialog'

interface BrandEntry {
  Mono: IconType
  Color?: IconType
  Text: IconType
}

const BRANDS: Record<string, BrandEntry> = {
  anthropic: { Mono: Anthropic, Text: Anthropic.Text },
  openrouter: { Mono: OpenRouter, Text: OpenRouter.Text },
  zhipu: { Mono: Zhipu, Color: Zhipu.Color, Text: Zhipu.Text },
  kimi: { Mono: Kimi, Color: Kimi.Color, Text: Kimi.Text },
  minimax: { Mono: Minimax, Color: Minimax.Color, Text: Minimax.Text },
  volcengine: { Mono: Volcengine, Color: Volcengine.Color, Text: Volcengine.Text },
  bailian: { Mono: Bailian, Color: Bailian.Color, Text: Bailian.Text },
  bedrock: { Mono: Bedrock, Color: Bedrock.Color, Text: Bedrock.Text },
  google: { Mono: Google, Color: Google.Color, Text: Google.Brand },
  deepseek: { Mono: DeepSeek, Color: DeepSeek.Color, Text: DeepSeek.Text },
  doubao: { Mono: Doubao, Color: Doubao.Color, Text: Doubao.Text },
  kwaikat: { Mono: KwaiKAT, Text: KwaiKAT.Text },
  longcat: { Mono: LongCat, Color: LongCat.Color, Text: LongCat.Text },
  modelscope: { Mono: ModelScope, Color: ModelScope.Color, Text: ModelScope.Text },
  nvidia: { Mono: Nvidia, Color: Nvidia.Color, Text: Nvidia.Text },
  siliconcloud: { Mono: SiliconCloud, Color: SiliconCloud.Color, Text: SiliconCloud.Text },
  xiaomimimo: { Mono: XiaomiMiMo, Text: XiaomiMiMo.Text },
  openai: { Mono: OpenAI, Text: OpenAI.Text },
}

const PRESET_PROVIDER_KEY: Record<string, string> = {
  'anthropic-official': 'anthropic',
  'openrouter': 'openrouter',
  'glm-cn': 'zhipu',
  'glm-global': 'zhipu',
  'kimi': 'kimi',
  'minimax-cn': 'minimax',
  'minimax-global': 'minimax',
  'volcengine': 'volcengine',
  'bailian': 'bailian',
  'bedrock': 'bedrock',
  'vertex': 'google',
  'deepseek': 'deepseek',
  'doubao-seed': 'doubao',
  'xiaomi-mimo': 'xiaomimimo',
  'longcat': 'longcat',
  'kat-coder': 'kwaikat',
  'modelscope': 'modelscope',
  'siliconflow': 'siliconcloud',
  'nvidia-nim': 'nvidia',
  'codex-official': 'openai',
  'dmxapi': '',
  'packycode': '',
  'custom-api': '',
}

function resolveProviderKey(provider: ApiProvider): string | null {
  const configs = JSON.parse(provider.agent_configs || '{}')
  const claudeUrl = (configs.claude?.base_url ?? '').toLowerCase()
  const codexUrl = (configs.codex?.base_url ?? '').toLowerCase()
  const url = claudeUrl || codexUrl
  const name = provider.name.toLowerCase()
  if (url.includes('anthropic.com') || name.includes('anthropic')) return 'anthropic'
  if (url.includes('openrouter') || name.includes('openrouter')) return 'openrouter'
  if (url.includes('bigmodel.cn') || url.includes('z.ai') || name.includes('glm') || name.includes('zhipu')) return 'zhipu'
  if (url.includes('kimi') || name.includes('kimi')) return 'kimi'
  if (url.includes('minimax') || name.includes('minimax')) return 'minimax'
  if (url.includes('volces.com') || url.includes('volcengine') || name.includes('volcengine') || name.includes('ark')) return 'volcengine'
  if (url.includes('dashscope') || url.includes('bailian') || name.includes('bailian')) return 'bailian'
  if (provider.provider_type === 'bedrock' || name.includes('bedrock')) return 'bedrock'
  if (provider.provider_type === 'vertex' || name.includes('vertex')) return 'google'
  if (url.includes('deepseek') || name.includes('deepseek')) return 'deepseek'
  if (url.includes('doubao') || name.includes('doubao')) return 'doubao'
  if (url.includes('xiaomimimo') || name.includes('mimo')) return 'xiaomimimo'
  if (url.includes('longcat') || name.includes('longcat')) return 'longcat'
  if (url.includes('streamlake') || name.includes('kat')) return 'kwaikat'
  if (url.includes('modelscope') || name.includes('modelscope')) return 'modelscope'
  if (url.includes('siliconflow') || name.includes('siliconflow')) return 'siliconcloud'
  if (url.includes('nvidia') || name.includes('nvidia')) return 'nvidia'
  if (url.includes('dmxapi') || name.includes('dmxapi')) return null
  if (url.includes('packy') || name.includes('packy')) return null
  return null
}

export function ProviderLabel({ presetKey, provider, fallback, size = 44 }: { presetKey?: string; provider?: ApiProvider; fallback?: string; size?: number }): ReactNode {
  const key = presetKey ? PRESET_PROVIDER_KEY[presetKey] : provider ? resolveProviderKey(provider) : null
  const brand = key ? BRANDS[key] : null
  if (brand) {
    const IconComp = brand.Color ?? brand.Mono
    return (
      <span className="inline-flex items-center gap-1.5">
        <IconComp size={size} />
        <brand.Text size={size * 0.75} />
      </span>
    )
  }
  return <span className="flex items-center gap-2 text-sm font-medium"><Globe className="size-5 text-muted-foreground" />{fallback}</span>
}

function ConnectButton({ isActive, onClick, label }: { isActive: boolean; onClick: () => void; label?: string }) {
  return (
    <Button
      variant="outline"
      size="sm"
      className={`h-7 shrink-0 text-xs ${isActive ? 'border-green-500/40 text-green-600 hover:bg-green-50 hover:text-green-600 dark:text-green-400 dark:hover:bg-green-950' : ''}`}
      onClick={(e) => { e.stopPropagation(); if (!isActive) onClick() }}
    >
      {label && <span className="mr-1 text-[10px] text-muted-foreground">{label}</span>}
      {isActive ? 'Connected' : 'Connect'} {isActive && <Check className="size-3.5" />}
    </Button>
  )
}

function ProviderRow({
  provider,
  currentAgent,
  onEdit,
  onActivate,
}: {
  provider: ApiProvider
  currentAgent: AgentType
  onEdit: () => void
  onActivate: () => void
}) {
  const configs = JSON.parse(provider.agent_configs || '{}')
  const url = configs[currentAgent]?.base_url || ''
  const isActive = currentAgent === 'claude' ? provider.is_active_claude === 1 : provider.is_active_codex === 1

  return (
    <div className="flex cursor-pointer items-center justify-between rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:bg-muted/50" onClick={onEdit}>
      <div className="flex items-center gap-3 overflow-hidden">
        <ProviderLabel provider={provider} fallback={provider.name} size={28} />
        {url && (
          <span className="truncate text-xs text-muted-foreground">{url}</span>
        )}
      </div>
      <ConnectButton isActive={isActive} onClick={onActivate} />
    </div>
  )
}

export function ProvidersPage() {
  const { providers, fetchProviders, createProvider, updateProvider, deleteProvider, activateProvider, deactivateAllProviders } = useSettingsStore()
  const settingsProvider = useAppStore((s) => s.settingsProvider) as AgentType

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingProvider, setEditingProvider] = useState<ApiProvider | null>(null)

  useEffect(() => {
    fetchProviders()
  }, [fetchProviders])

  const filteredProviders = useMemo(() =>
    providers.filter((p) => {
      const agents: string[] = JSON.parse(p.supported_agents || '["claude"]')
      return agents.includes(settingsProvider)
    }),
  [providers, settingsProvider])

  const handleAdd = useCallback(() => {
    setEditingProvider(null)
    setDialogOpen(true)
  }, [])

  const handleEdit = useCallback((provider: ApiProvider) => {
    setEditingProvider(provider)
    setDialogOpen(true)
  }, [])

  const handleSave = useCallback(async (data: CreateProviderRequest | (UpdateProviderRequest & { id: string })) => {
    if ('id' in data) {
      const { id, ...rest } = data
      await updateProvider(id, rest)
    } else {
      await createProvider(data)
    }
  }, [createProvider, updateProvider])

  const handleDelete = useCallback(async (id: string) => {
    await deleteProvider(id)
  }, [deleteProvider])

  const handleActivate = useCallback(async (id: string) => {
    await activateProvider(id, settingsProvider)
  }, [activateProvider, settingsProvider])

  const activeProvider = filteredProviders.find((p) =>
    settingsProvider === 'claude' ? p.is_active_claude === 1 : p.is_active_codex === 1
  )

  const defaultLabel = settingsProvider === 'codex' ? 'Codex (Default)' : 'Claude Code (Default)'
  const defaultDesc = settingsProvider === 'codex'
    ? 'Uses Codex session auth (ChatGPT login or API key)'
    : 'Uses system environment / Claude CLI auth'

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Providers</h2>
          <p className="text-sm text-muted-foreground">
            {settingsProvider === 'codex'
              ? 'Configure third-party OpenAI-compatible API providers for Codex'
              : 'Configure third-party Anthropic-compatible API providers'}
          </p>
        </div>
        <Button size="sm" onClick={handleAdd}>
          <Plus className="size-4" />
          Add Provider
        </Button>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3">
          <div className="flex items-center gap-3">
            <Server className="size-4 text-muted-foreground" />
            <div>
              <span className="text-sm font-medium">{defaultLabel}</span>
              <p className="text-xs text-muted-foreground">{defaultDesc}</p>
            </div>
          </div>
          <ConnectButton
            isActive={!activeProvider}
            onClick={() => deactivateAllProviders(settingsProvider)}
          />
        </div>

        {filteredProviders.map((p) => (
          <ProviderRow
            key={p.id}
            provider={p}
            currentAgent={settingsProvider}
            onEdit={() => handleEdit(p)}
            onActivate={() => handleActivate(p.id)}
          />
        ))}

        {filteredProviders.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-6 text-center">
            <p className="text-sm text-muted-foreground">No third-party providers configured</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Click "Add Provider" to connect a third-party API
            </p>
          </div>
        )}
      </div>

      <ProviderDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editProvider={editingProvider}
        onSave={handleSave}
        onDelete={handleDelete}
        agentFilter={settingsProvider}
      />
    </div>
  )
}
