import { MobileApp } from './src/navigation/mobile-app'
import { MobileThemeProvider } from './src/theme/context'
import { mobileKv } from './src/storage'
import { UpdateGate } from './src/updates/UpdateGate'
import { defaultUpdatePorts } from './src/updates/update-ports'

export default function App() {
  return (
    <MobileThemeProvider store={mobileKv}>
      <UpdateGate ports={defaultUpdatePorts()} store={mobileKv}>
        <MobileApp />
      </UpdateGate>
    </MobileThemeProvider>
  )
}
