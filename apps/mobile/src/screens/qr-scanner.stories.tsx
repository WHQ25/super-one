import { View } from 'react-native'
import { MobileThemeProvider } from '../theme/context'
import { QrScannerView } from './qr-scanner-view'
import { QrScannerFixture } from '../preview/QrScannerPreview'

function Preview(props: { count?: number; error?: boolean; theme?: 'light' | 'dark'; locale?: 'en' | 'zh'; width?: number; height?: number }) {
  return <MobileThemeProvider colorScheme={props.theme ?? 'dark'} locale={props.locale ?? 'en'}>
    <View style={{ width: props.width ?? 390, height: props.height ?? 760, padding: 16, backgroundColor: props.theme === 'light' ? '#fff' : '#111' }}>
      <QrScannerFixture count={props.count} error={props.error} />
    </View>
  </MobileThemeProvider>
}

export default { title: 'Mobile/QrScanner', component: QrScannerView, render: Preview }
export const MultipleCodes = { name: 'Multiple codes · tap a target' }
export const OneCode = { name: 'Single code · reading, no target', args: { count: 1 } }
export const Searching = { args: { count: 0 } }
export const CameraError = { args: { error: true } }
export const LightMode = { args: { theme: 'light' } }
export const NarrowChinese = { args: { locale: 'zh', width: 320, height: 640 } }
export const Landscape = { args: { width: 844, height: 390 } }
