import './polyfills'
import { createElement } from 'react'
import { registerRootComponent } from 'expo'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import App from './App'

const Root = () => createElement(SafeAreaProvider, null, createElement(App))

registerRootComponent(Root)
