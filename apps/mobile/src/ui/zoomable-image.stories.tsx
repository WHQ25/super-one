import { useState } from 'react'
import { View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import type { Locale } from '@superone/shared/agent-types'
import { TINY_PNG } from '../preview/file-preview-fixtures'
import { MobileThemeProvider } from '../theme/context'
import { Text } from './text'
import { ZoomableImage } from './zoomable-image'

type Args = {
  src: string
  label: string
  scheme: 'light' | 'dark'
  locale: Locale
  /** Start with the chrome already out of the way, as a second tap leaves it. */
  chromeHidden: boolean
}

/**
 * The viewer on its own, with the chrome toggle it drives reported underneath —
 * the transition a single tap causes is the part worth watching, and inside the
 * full modal it is hidden behind a title row fading at the same time.
 */
function Preview({ src, label, scheme, locale, chromeHidden }: Args) {
  const [chromeVisible, setChromeVisible] = useState(!chromeHidden)
  return (
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } }}>
      <MobileThemeProvider colorScheme={scheme} locale={locale}>
        <View style={{ flex: 1 }}>
          <ZoomableImage src={src} label={label} chromeVisible={chromeVisible} onToggleChrome={() => setChromeVisible((visible) => !visible)} />
          <View style={{ position: 'absolute', top: 60, left: 0, right: 0, alignItems: 'center' }} pointerEvents="none">
            <Text style={{ fontSize: 12 }}>{chromeVisible ? 'Chrome: shown' : 'Chrome: hidden'}</Text>
          </View>
        </View>
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
  } satisfies Args,
  argTypes: {
    scheme: { control: 'radio', options: ['light', 'dark'] },
    locale: { control: 'radio', options: ['en', 'zh'] },
    chromeHidden: { control: 'boolean' },
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
