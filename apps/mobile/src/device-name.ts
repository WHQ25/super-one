/**
 * Label the desktop shows for this phone at pairing and register.
 *
 * iOS: the user-assigned device name. iOS 16+ may return the generic "iPhone"
 * unless Apple grants a restricted entitlement — same limit the Flutter client
 * had. Android: brand + model, matching Flutter's `device_info_plus` string.
 */
export function resolveMobileDeviceName(info: {
  deviceName?: string | null
  brand?: string | null
  os?: string | null
}): string {
  const name = info.deviceName?.trim() ?? ''
  const brand = info.brand?.trim() ?? ''

  if (info.os === 'android') {
    if (brand && name) {
      const pretty = `${brand.charAt(0).toUpperCase()}${brand.slice(1)}`
      if (name.toLowerCase().startsWith(brand.toLowerCase())) return name
      return `${pretty} ${name}`
    }
    if (name) return name
    if (brand) return `${brand.charAt(0).toUpperCase()}${brand.slice(1)}`
    return 'Android'
  }

  if (name) return name
  if (info.os === 'ios') return 'iPhone'
  return 'Mobile'
}
