import { requireNativeView, requireOptionalNativeModule } from 'expo'
import { scanFromURLAsync, type BarcodeScanningResult } from 'expo-camera'
import * as ImagePicker from 'expo-image-picker'
import type { ComponentType } from 'react'
import { Platform, type ViewProps } from 'react-native'

type NativeScanResponse = {
  width: number
  height: number
  barcodes: BarcodeScanningResult[]
}

type NativeQrModule = {
  scanImageAsync?: (uri: string) => Promise<NativeScanResponse>
}

type NativeQrViewProps = ViewProps & {
  active: boolean
  enableTorch: boolean
  zoom: number
  onBarcodesScanned: (event: { nativeEvent: { barcodes?: BarcodeScanningResult[] } }) => void
  onMountError: (event: { nativeEvent: { message?: string } }) => void
}

export type PickedQrImage = {
  uri: string
  width: number
  height: number
  barcodes: BarcodeScanningResult[]
}

const nativeModule = (Platform.OS === 'ios' || Platform.OS === 'android')
  ? requireOptionalNativeModule<NativeQrModule>('SuperOneQrScanner')
  : null

const NativeView: ComponentType<NativeQrViewProps> | null = Platform.OS === 'android' && nativeModule
  ? requireNativeView<NativeQrViewProps>('SuperOneQrScanner')
  : null

export const nativeAndroidQrCameraAvailable = NativeView !== null

export function NativeQrCamera(props: ViewProps & {
  active: boolean
  enableTorch: boolean
  zoom: number
  onBarcodesScanned: (barcodes: BarcodeScanningResult[]) => void
  onMountError: () => void
}) {
  if (!NativeView) return null
  const { active, enableTorch, zoom, onBarcodesScanned, onMountError, ...viewProps } = props
  return (
    <NativeView
      {...viewProps}
      active={active}
      enableTorch={enableTorch}
      zoom={zoom}
      onBarcodesScanned={({ nativeEvent }) => {
        if (Array.isArray(nativeEvent.barcodes) && nativeEvent.barcodes.length > 0) {
          onBarcodesScanned(nativeEvent.barcodes)
        }
      }}
      onMountError={() => onMountError()}
    />
  )
}

export async function pickAndScanQrImage(): Promise<PickedQrImage | null> {
  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 1,
  })
  const asset = picked.canceled ? undefined : picked.assets?.[0]
  if (!asset?.uri) return null
  if (nativeModule?.scanImageAsync) {
    const decoded = await nativeModule.scanImageAsync(asset.uri)
    return {
      uri: asset.uri,
      width: decoded.width || asset.width || 0,
      height: decoded.height || asset.height || 0,
      barcodes: Array.isArray(decoded.barcodes) ? decoded.barcodes : [],
    }
  }
  const barcodes = await scanFromURLAsync(asset.uri, ['qr'])
  return {
    uri: asset.uri,
    width: asset.width || 0,
    height: asset.height || 0,
    barcodes,
  }
}
