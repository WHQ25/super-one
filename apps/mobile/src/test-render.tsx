import { render } from '@testing-library/react-native'
import type { ReactElement } from 'react'
import { MobileThemeProvider } from './theme/context'
import type { MobileColorScheme } from './theme/tokens'
import type { Locale } from '@superone/shared/agent-types'

/**
 * Components read colours off `useMobileTheme`, which throws outside the
 * provider — so every component test mounts through it.
 *
 * `render` is async in React Native Testing Library 14: React 19 renders
 * concurrently and the tree is not committed when the call returns. Always
 * await this.
 */
export async function renderWithTheme(
  ui: ReactElement,
  colorScheme: MobileColorScheme = 'dark',
  locale: Locale = 'en',
) {
  const wrap = (next: ReactElement) => <MobileThemeProvider colorScheme={colorScheme} locale={locale}>{next}</MobileThemeProvider>
  const result = await render(wrap(ui))
  // RNTL's own `rerender` replaces the whole tree, provider included, so a test
  // driving a prop change would remount into a bare tree and throw. Re-wrap it.
  return { ...result, rerender: (next: ReactElement) => result.rerender(wrap(next)) }
}
