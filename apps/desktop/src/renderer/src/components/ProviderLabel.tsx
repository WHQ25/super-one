import type { CSSProperties, ReactNode } from 'react'
import { Globe } from 'lucide-react'
import { Anthropic, Claude, Cursor, OpenRouter, Zhipu, ZAI, Kimi, Moonshot, Minimax, Volcengine, Bailian, Bedrock, Google, Gemini, VertexAI, DeepSeek, KwaiKAT, LongCat, ModelScope, Nvidia, SiliconCloud, XiaomiMiMo, OpenAI } from '@lobehub/icons'
import type { IconType } from '@lobehub/icons'

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
  zai: { Mono: ZAI, Text: ZAI.Text },
  kimi: { Mono: Kimi, Color: Kimi.Color, Text: Kimi.Text },
  moonshot: { Mono: Moonshot, Text: Moonshot.Text },
  minimax: { Mono: Minimax, Color: Minimax.Color, Text: Minimax.Text },
  volcengine: { Mono: Volcengine, Color: Volcengine.Color, Text: Volcengine.Text },
  bailian: { Mono: Bailian, Color: Bailian.Color, Text: Bailian.Text },
  bedrock: { Mono: Bedrock, Color: Bedrock.Color, Text: Bedrock.Text },
  google: { Mono: Google, Color: Google.Color, Text: Google.Brand },
  gemini: { Mono: Gemini, Color: Gemini.Color, Text: Gemini.Text },
  vertexai: { Mono: VertexAI, Color: VertexAI.Color, Text: VertexAI.Text },
  deepseek: { Mono: DeepSeek, Color: DeepSeek.Color, Text: DeepSeek.Text },
  kwaikat: { Mono: KwaiKAT, Text: KwaiKAT.Text },
  longcat: { Mono: LongCat, Color: LongCat.Color, Text: LongCat.Text },
  modelscope: { Mono: ModelScope, Color: ModelScope.Color, Text: ModelScope.Text },
  nvidia: { Mono: Nvidia, Color: Nvidia.Color, Text: Nvidia.Text },
  siliconcloud: { Mono: SiliconCloud, Color: SiliconCloud.Color, Text: SiliconCloud.Text },
  xiaomimimo: { Mono: XiaomiMiMo, Text: XiaomiMiMo.Text },
  openai: { Mono: OpenAI, Text: OpenAI.Text },
  chatgpt: { Mono: OpenAI, Combine: OpenAI.Combine, extraLabel: 'ChatGPT' },
  cursor: { Mono: Cursor, Text: Cursor.Text },
}

export function ProviderLabel({ brandKey, fallback, size = 44, iconOnly = false, combine = false, compactFallback = false }: { brandKey?: string | null; fallback?: string; size?: number; iconOnly?: boolean; combine?: boolean; compactFallback?: boolean }): ReactNode {
  const brand = brandKey ? BRANDS[brandKey] : null
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
    const CombineComp = (brand.Mono as unknown as { Combine?: (p: { size?: number; type?: 'color' | 'mono'; style?: CSSProperties }) => ReactNode }).Combine
    if (combine && CombineComp) {
      return <CombineComp size={size} type="color" style={{ display: 'inline-flex', flexDirection: 'row', alignItems: 'center' }} />
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
  if (compactFallback) {
    return (
      <span className="inline-flex min-w-0 items-center gap-1.5">
        <Globe className="shrink-0 text-muted-foreground" style={{ width: size, height: size }} />
        <span className="truncate leading-none" style={{ fontSize: size * 0.75 }}>{fallback}</span>
      </span>
    )
  }
  return (
    <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
      <Globe className="size-5 shrink-0 text-muted-foreground" />
      <span className="truncate">{fallback}</span>
    </span>
  )
}
