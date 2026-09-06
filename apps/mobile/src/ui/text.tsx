import { forwardRef } from 'react'
import { Text as NativeText, useWindowDimensions, type TextProps } from 'react-native'

export type Text = NativeText

/** RN 0.81 Fabric can retain a paragraph's old measured bounds after a live
 * content-size change. Updating a text-layout prop invalidates that measurement
 * without remounting the surrounding controls or losing an editor draft.
 * The default cap stays above the system scale, including scales below 1. */
export const Text = forwardRef<NativeText, TextProps>(function Text(props, ref) {
  const { fontScale } = useWindowDimensions()
  const cap = props.maxFontSizeMultiplier
  return <NativeText {...props} ref={ref}
    maxFontSizeMultiplier={cap && cap > 0 ? Math.max(1, Math.min(cap, fontScale)) : fontScale + 1} />
})
