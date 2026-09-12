import { useMemo, useState } from 'react'
import { View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import type { ImageGenerationInfo, Locale } from '@superone/shared/agent-types'
import { createFakeGenerationPorts } from '../preview/fake-generation-ports'
import { CODEX_GENERATION, TINY_PNG, TOOL_GENERATION } from '../preview/file-preview-fixtures'
import { MobileThemeProvider } from '../theme/context'
import { MenuHost } from './menu-host'
import { Text } from './text'
import { ZoomableImage } from './zoomable-image'

type Args = {
  src: string
  label: string
  scheme: 'light' | 'dark'
  locale: Locale
  /** Start with the chrome already out of the way, as a second tap leaves it. */
  chromeHidden: boolean
  /** Generation facts; adds the info button beside the rotate pair. */
  generation?: ImageGenerationInfo
  /** How the fake host answers the panel: thumbs and labels, names only, or nothing at all. */
  host: 'lan' | 'relay' | 'none'
}

/**
 * The viewer on its own, with the chrome toggle it drives reported underneath —
 * the transition a single tap causes is the part worth watching, and inside the
 * full modal it is hidden behind a title row fading at the same time.
 */
function Preview({ src, label, scheme, locale, chromeHidden, generation, host }: Args) {
  const [chromeVisible, setChromeVisible] = useState(!chromeHidden)
  const ports = useMemo(
    () => (host === 'none' ? undefined : createFakeGenerationPorts({ images: host === 'relay' ? 'name' : 'bytes', delayMs: 400 })),
    [host],
  )
  return (
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}>
      <MobileThemeProvider colorScheme={scheme} locale={locale}>
        {/* The info panel is an anchored menu, so the viewer needs a host the way the modal gives it one. */}
        <MenuHost>
          <View style={{ flex: 1 }}>
            <ZoomableImage src={src} label={label} generation={generation} generationPorts={ports} chromeVisible={chromeVisible} onToggleChrome={() => setChromeVisible((visible) => !visible)} />
            <View style={{ position: 'absolute', top: 60, left: 0, right: 0, alignItems: 'center' }} pointerEvents="none">
              <Text style={{ fontSize: 12 }}>{chromeVisible ? 'Chrome: shown' : 'Chrome: hidden'}</Text>
            </View>
          </View>
        </MenuHost>
      </MobileThemeProvider>
    </SafeAreaProvider>
  )
}

export default {
  title: 'Mobile/ZoomableImage',
  component: ZoomableImage,
  render: Preview,
  args: {
    src: 'https://picsum.photos/seed/superone/1200/800',
    label: 'Screenshot',
    scheme: 'dark',
    locale: 'en',
    chromeHidden: false,
    host: 'lan',
  } satisfies Args,
  argTypes: {
    scheme: { control: 'radio', options: ['light', 'dark'] },
    locale: { control: 'radio', options: ['en', 'zh'] },
    chromeHidden: { control: 'boolean' },
    host: { control: 'radio', options: ['lan', 'relay', 'none'] },
  },
}

/** A landscape picture fitted to the screen: pinch, drag, double tap, rotate. */
export const Landscape = {}
/** A portrait picture has to shrink to lie down; the landscape one grows to stand up. */
export const Portrait = { args: { src: 'https://picsum.photos/seed/superone-tall/800/1600', label: 'Tall screenshot' } }
/** A near-square picture barely changes size through a turn. */
export const Square = { args: { src: 'https://picsum.photos/seed/superone-square/900/900', label: 'Square' } }
/** Chrome tapped away: the rotate bar goes with it and takes no touches. */
export const ChromeHidden = { args: { chromeHidden: true } }
/** Two pixels stretched over a phone: the fit maths with nothing to look at. */
export const TinyBytes = { args: { src: TINY_PNG, label: 'screen.png' } }
/** No spinner forever — a source that cannot decode says so. */
export const Broken = { args: { src: 'data:image/png;base64,AAAA', label: 'broken.png' } }
/** Translated rotate labels. */
export const Chinese = { args: { locale: 'zh' as Locale } }
/** Light shell: the rotate bar keeps its own surface against a pale picture. */
export const LightScheme = { args: { scheme: 'light' as const } }
/** A `media_generate_image` result: the info button opens size, timing, resolved provider/model, reference thumbs, warnings and prompt. */
export const ToolGenerated = { args: { src: 'https://picsum.photos/seed/superone-tall/800/1600', label: 'astronaut.png', generation: TOOL_GENERATION } }
/** Over the relay a reference image is not fetched unasked: its file name stands in for the thumb. */
export const ToolGeneratedRelay = { args: { ...ToolGenerated.args, host: 'relay' as const } }
/** A host too old for the catalogue command: ids and names, nothing waits. */
export const ToolGeneratedNoHost = { args: { ...ToolGenerated.args, host: 'none' as const } }
/** A Codex-native ImageGen result: only the prompt and timing are known. */
export const CodexGenerated = { args: { src: 'https://picsum.photos/seed/superone-tall/800/1600', label: 'codex.png', generation: CODEX_GENERATION } }
/** The info panel translated. */
export const ToolGeneratedChinese = { args: { ...ToolGenerated.args, locale: 'zh' as Locale } }
/** A prompt long enough to scroll inside the panel. */
export const LongPrompt = { args: { ...ToolGenerated.args, generation: { ...TOOL_GENERATION, revisedPrompt: Array.from({ length: 12 }, () => TOOL_GENERATION.revisedPrompt).join(' ') } } }
