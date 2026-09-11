import { View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import type { Locale } from '@superone/shared/agent-types'
import { MobileThemeProvider } from '../theme/context'
import { ZoomableMermaid } from './zoomable-mermaid'

const FLOW = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 280 120" width="280" height="120">
  <rect width="280" height="120" rx="12" fill="#1e1e2e"/>
  <rect x="16" y="36" width="88" height="48" rx="8" fill="#313244"/>
  <text x="60" y="66" text-anchor="middle" fill="#cdd6f4" font-size="14" font-family="system-ui">Start</text>
  <path d="M112 60h32" stroke="#89b4fa" stroke-width="2"/>
  <polygon points="144,54 156,60 144,66" fill="#89b4fa"/>
  <rect x="164" y="36" width="100" height="48" rx="8" fill="#313244"/>
  <text x="214" y="66" text-anchor="middle" fill="#cdd6f4" font-size="14" font-family="system-ui">End</text>
</svg>`

const WIDE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 160" width="720" height="160">
  <rect width="720" height="160" rx="12" fill="#1e1e2e"/>
  <text x="360" y="88" text-anchor="middle" fill="#cdd6f4" font-size="18" font-family="system-ui">A very wide sequence that needs a pinch to read</text>
</svg>`

type Args = {
  svg: string
  scheme: 'light' | 'dark'
  locale: Locale
}

function Preview({ svg, scheme, locale }: Args) {
  return (
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}>
      <MobileThemeProvider colorScheme={scheme} locale={locale}>
        <View style={{ flex: 1 }}>
          <ZoomableMermaid svg={svg} />
        </View>
      </MobileThemeProvider>
    </SafeAreaProvider>
  )
}

export default {
  title: 'Mobile/ZoomableMermaid',
  component: ZoomableMermaid,
  render: Preview,
  args: { svg: FLOW, scheme: 'dark', locale: 'en' } satisfies Args,
  argTypes: {
    scheme: { control: 'radio', options: ['light', 'dark'] },
    locale: { control: 'radio', options: ['en', 'zh'] },
  },
}

/** A compact flowchart fitted to the page: pinch, pan, double tap. */
export const Flowchart = {}
/** Wider than the phone; pinch in to read the labels. */
export const WideSequence = { args: { svg: WIDE } }
/** Light shell: the page background matches the rest of the preview. */
export const LightScheme = { args: { scheme: 'light' as const } }
/** Translated accessible name. */
export const Chinese = { args: { locale: 'zh' as Locale } }
