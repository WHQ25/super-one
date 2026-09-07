import { render } from '@testing-library/react-native'
import type { ReactElement } from 'react'
import { MobileThemeProvider } from './theme/context'
import type { MobileColorScheme } from './theme/tokens'

/**
 * Components read colours off `useMobileTheme`, which throws outside the
 * provider — so every component test mounts through it.
 *
 * `render` is async in React Native Testing Library 14: React 19 renders
 * concurrently and the tree is not committed when the call returns. Always
 * await this.
 */
export function renderWithTheme(ui: ReactElement, colorScheme: MobileColorScheme = 'dark') {
  return render(<MobileThemeProvider colorScheme={colorScheme}>{ui}</MobileThemeProvider>)
}
