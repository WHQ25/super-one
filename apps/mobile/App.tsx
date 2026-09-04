import { MobileApp } from './src/navigation/mobile-app'
import { MobileThemeProvider } from './src/theme/context'

export default function App() {
  return (
    <MobileThemeProvider>
      <MobileApp />
    </MobileThemeProvider>
  )
}
