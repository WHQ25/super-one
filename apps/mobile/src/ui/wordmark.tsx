import { Image } from 'react-native'

const source = require('../../assets/logo-text.png')
/** Intrinsic 484×96; the height is the design input, the width follows it. */
const ASPECT = 484 / 96

/**
 * The SuperOne wordmark. It lives inside the page content rather than a fixed
 * bar, so it travels with whatever it introduces — the device list, or the
 * pairing code — instead of anchoring to the top of the screen.
 */
export function Wordmark({ height = 40 }: { height?: number }) {
  return (
    <Image
      accessibilityLabel="SuperOne"
      accessible
      resizeMode="contain"
      source={source}
      style={{ alignSelf: 'center', height, width: Math.round(height * ASPECT) }}
      testID="app-wordmark"
    />
  )
}
