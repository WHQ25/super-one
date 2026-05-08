import type { ReactNode } from 'react'
import { Globe } from 'lucide-react'
import { Anthropic, Claude, OpenRouter, Zhipu, Kimi, Minimax, Volcengine, Bailian, Bedrock, Google, DeepSeek, Doubao, KwaiKAT, LongCat, ModelScope, Nvidia, SiliconCloud, XiaomiMiMo, OpenAI } from '@lobehub/icons'
import type { IconType } from '@lobehub/icons'
import type { ApiProvider } from '@superone/shared/agent-types'
import { PRESET_PROVIDER_KEY, resolveProviderKey } from '@superone/shared/provider-utils'

export { PRESET_PROVIDER_KEY, resolveProviderKey }

interface BrandEntry {
  Mono: IconType
  Color?: IconType
  Text?: IconType
  Combine?: typeof OpenAI.Combine
  extraLabel?: string
}

const BRANDS: Record<string, BrandEntry> = {
  anthropic: { Mono: Anthropic, Text: Anthropic.Text },
  claude: { Mono: Claude, Color: Claude.Color, Text: Claude.Text },
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
  chatgpt: { Mono: OpenAI, Combine: OpenAI.Combine, extraLabel: 'ChatGPT' },
}

export function ProviderLabel({ presetKey, provider, fallback, size = 44, iconOnly = false }: { presetKey?: string; provider?: ApiProvider; fallback?: string; size?: number; iconOnly?: boolean }): ReactNode {
  const key = presetKey ? PRESET_PROVIDER_KEY[presetKey] : provider ? resolveProviderKey(provider) : null
  const brand = key ? BRANDS[key] : null
  if (brand) {
    const IconComp = brand.Color ?? brand.Mono
    if (iconOnly) {
      return <IconComp size={size} />
    }
    if (brand.Combine && brand.extraLabel) {
      return (
        <brand.Combine
          size={size}
          extra={brand.extraLabel}
          showText={false}
          style={{ display: 'inline-flex', flexDirection: 'row', alignItems: 'center' }}
        />
      )
    }
    if (brand.Text) {
      return (
        <span className="inline-flex items-center gap-1.5">
          <IconComp size={size} />
          <brand.Text size={size * 0.75} />
        </span>
      )
    }
    return <IconComp size={size} />
  }
  if (iconOnly) {
    return <Globe className="text-muted-foreground" style={{ width: size, height: size }} />
  }
  return <span className="flex items-center gap-2 text-sm font-medium"><Globe className="size-5 text-muted-foreground" />{fallback}</span>
}
