import Constants from 'expo-constants'
import { Platform } from 'react-native'
import { resolveMobileDeviceName } from './device-name'

/**
 * Reads the name already exported by expo-constants (linked in the current
 * native binary) so pairing does not need a new native module.
 */
export function getMobileDeviceName(): string {
  return resolveMobileDeviceName({
    deviceName: Constants.deviceName,
    brand: Platform.OS === 'android' ? Platform.constants.Brand : undefined,
    os: Platform.OS,
  })
}
