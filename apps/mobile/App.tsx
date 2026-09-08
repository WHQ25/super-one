import { MobileApp } from './src/navigation/mobile-app'
import { MobileThemeProvider } from './src/theme/context'
import { mobileKv } from './src/storage'

export default function App() {
  return (
    <MobileThemeProvider store={mobileKv}>
      <MobileApp />
    </MobileThemeProvider>
  )
}
