import { Globe } from 'lucide-react-native'
import { Image, View } from 'react-native'
import { SvgXml } from 'react-native-svg'
import { Text } from './text'
import { useMobileTheme } from '../theme/context'
import data from './provider-brands.generated.json'
import { providerRasters } from './provider-rasters'
import { tintSvgCurrentColor } from './tint-svg-current-color'

type VectorMark = { svg: string; aspect: number }
type RasterMark = { png: string; aspect: number }
type Mark = VectorMark | RasterMark
type Brand = { icon: Mark; text?: VectorMark; extra?: string }

function isRaster(mark: Mark): mark is RasterMark {
  return 'png' in mark
}

const BRANDS: Record<string, Brand> = data.brands
const { textMultiple: TEXT_MULTIPLE, spaceMultiple: SPACE_MULTIPLE } = data

export function providerBrand(brandKey?: string | null): Brand | null {
  return brandKey && Object.hasOwn(BRANDS, brandKey) ? BRANDS[brandKey]! : null
}

/**
 * `ProviderLabel` for React Native: the desktop's `TightCombine` lockup —
 * the `@lobehub/icons` mark next to its word mark, both already cropped to
 * their ink box by the generator, so only the sizing rules live here. A mark
 * whose SVG depends on filters is a Chromium raster of that same cropped box.
 * A provider with no brand falls back to its favicon and plain name.
 */
export function ProviderBrand(props: {
  brandKey?: string | null
  name: string
  /** Favicon for a custom provider with no brand mark. */
  icon?: string | null
  size?: number
}) {
  const { tokens: { colors } } = useMobileTheme()
  const size = props.size ?? 16
  const brand = providerBrand(props.brandKey)
  if (!brand) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
        {props.icon
          ? <Image source={{ uri: props.icon }} style={{ width: size, height: size, borderRadius: 3 }} />
          : <Globe size={size} color={colors.mutedForeground} />}
        <Text numberOfLines={1} style={{ fontSize: size * TEXT_MULTIPLE, color: colors.foreground }}>{props.name}</Text>
      </View>
    )
  }
  // `contain`: the longer side gets the full size, so mixed marks stay optically equal.
  const longest = Math.max(brand.icon.aspect, 1)
  const textSize = size * TEXT_MULTIPLE
  const ink = colors.foreground
  const iconWidth = size * (brand.icon.aspect / longest)
  const iconHeight = size / longest
  const raster = isRaster(brand.icon) && Object.hasOwn(providerRasters, brand.icon.png)
    ? providerRasters[brand.icon.png as keyof typeof providerRasters]
    : undefined
  return (
    <View accessible accessibilityLabel={props.name}
      style={{ flexDirection: 'row', alignItems: 'center', gap: size * SPACE_MULTIPLE }}>
      {raster
        ? <Image testID="provider-brand-icon" source={raster} resizeMode="contain" accessible={false}
          style={{ width: iconWidth, height: iconHeight }} />
        : !isRaster(brand.icon)
          ? <SvgXml testID="provider-brand-icon" key={`${props.brandKey}-icon-${ink}`} xml={tintSvgCurrentColor(brand.icon.svg, ink)} color={ink}
            width={iconWidth} height={iconHeight} />
          : null}
      {brand.text
        ? <SvgXml key={`${props.brandKey}-text-${ink}`} xml={tintSvgCurrentColor(brand.text.svg, ink)} color={ink}
          width={textSize * brand.text.aspect} height={textSize} />
        : brand.extra
          ? <Text numberOfLines={1} style={{ fontSize: textSize * 0.95, color: ink }}>{brand.extra}</Text>
          : <Text numberOfLines={1} style={{ fontSize: textSize, color: ink }}>{props.name}</Text>}
    </View>
  )
}
