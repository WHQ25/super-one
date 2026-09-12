import './polyfills'
import { installNativeCrypto } from './src/native-crypto'
import { createElement } from 'react'
import { registerRootComponent } from 'expo'
import { SafeAreaProvider } from 'react-native-safe-area-context'
// Keep the offline preview independent of app storage and remote connections.
const App = __DEV__ && process.env.EXPO_PUBLIC_NATIVE_PREVIEW === '1'
  ? require('./src/preview/NativePreviewApp').default
  : require('./App').default

// Relay frames are sealed on the JS thread; native AES keeps a picture from
// freezing the app for seconds per crossing.
installNativeCrypto()

const Root = () => createElement(SafeAreaProvider, null, createElement(App))

registerRootComponent(Root)
