import type { ColorSchemeName } from 'react-native'
import type { HarnessId } from '@superone/shared/agent-types'
import { HARNESS_DEFAULT_BRAND_HUE } from '@superone/shared/harness-brand'
import {
  GENERATED_DARK_COLORS,
  GENERATED_LIGHT_COLORS,
  type GeneratedThemeColors,
} from './tokens.generated'

export type MobileColorScheme = 'light' | 'dark'

export interface MobileThemeTokens {
  scheme: MobileColorScheme
  brandHue: number
  colors: GeneratedThemeColors
  spacing: { xs: number; sm: number; md: number; lg: number; xl: number }
  radius: { sm: number; md: number; lg: number; pill: number }
  type: { meta: number; body: number; title: number; display: number }
}

export interface MobileWebViewTheme {
  type: 'setTheme'
  hue: number
  scheme: MobileColorScheme
  colors: Pick<GeneratedThemeColors, 'background' | 'surface' | 'foreground' | 'mutedForeground' | 'border'>
}

export function normalizeColorScheme(scheme: ColorSchemeName): MobileColorScheme {
  return scheme === 'light' ? 'light' : 'dark'
}

export function mobileThemeTokens(
  scheme: MobileColorScheme,
  harness: HarnessId = 'codex',
): MobileThemeTokens {
  return {
    scheme,
    brandHue: HARNESS_DEFAULT_BRAND_HUE[harness],
    colors: scheme === 'dark' ? GENERATED_DARK_COLORS : GENERATED_LIGHT_COLORS[harness],
    spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 },
    radius: { sm: 6, md: 8, lg: 12, pill: 999 },
    type: { meta: 12, body: 16, title: 17, display: 24 },
  }
}

export function mobileWebViewTheme(tokens: MobileThemeTokens): MobileWebViewTheme {
  const { background, surface, foreground, mutedForeground, border } = tokens.colors
  return {
    type: 'setTheme',
    hue: tokens.brandHue,
    scheme: tokens.scheme,
    colors: { background, surface, foreground, mutedForeground, border },
  }
}
