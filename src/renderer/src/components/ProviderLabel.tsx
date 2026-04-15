import type { ReactNode } from 'react'
import { Globe } from 'lucide-react'
import { Anthropic, OpenRouter, Zhipu, Kimi, Minimax, Volcengine, Bailian, Bedrock, Google, DeepSeek, Doubao, KwaiKAT, LongCat, ModelScope, Nvidia, SiliconCloud, XiaomiMiMo, OpenAI } from '@lobehub/icons'
import type { IconType } from '@lobehub/icons'
import type { ApiProvider } from '../../../shared/agent-types'

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

export const PRESET_PROVIDER_KEY: Record<string, string> = {
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

export function resolveProviderKey(provider: ApiProvider): string | null {
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
