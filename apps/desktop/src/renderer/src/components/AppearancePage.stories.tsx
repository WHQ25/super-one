import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactElement } from 'react'
import type { ThemeMode } from '@superone/shared/agent-types'
import { mockIpc } from '../../../../.storybook/mock-ipc'
import { useAppStore } from '@/stores/app'
import { AppearancePage } from './AppearancePage'

let appSettings: Record<string, unknown> = { crispText: true, customAppIconPath: null }
let theme: { mode: ThemeMode; dark: boolean } = { mode: 'system', dark: false }

mockIpc('app', 'getAppSettings', async () => ({ ...appSettings }))
mockIpc('app', 'saveAppSettings', async (patch: unknown) => {
  appSettings = { ...appSettings, ...(patch as Record<string, unknown>) }
  return { ...appSettings }
})
// `useTheme` applies whatever `getTheme` reports to <html>, so it must agree
// with the toolbar theme or the page would flip the story's color scheme.
mockIpc('app', 'getTheme', async () => theme)
mockIpc('app', 'setTheme', async (mode: unknown) => {
  theme = { ...theme, mode: mode as ThemeMode }
})

/** Seeds the mocks during render, before the page's mount effects read them. */
function seed(store: Partial<ReturnType<typeof useAppStore.getState>> = {}, mode: ThemeMode = 'system') {
  return (Story: () => ReactElement, ctx: { globals: { theme?: 'light' | 'dark' } }) => {
    appSettings = { crispText: true, customAppIconPath: null }
    theme = { mode, dark: ctx.globals.theme === 'dark' }
    useAppStore.setState({
      terminalLightPalette: null,
      terminalDarkPalette: null,
      terminalFontSize: 14,
      terminalFontFamily: null,
      mermaidLightTheme: null,
      mermaidDarkTheme: null,
      uiFontFamily: null,
      liquidGlass: false,
      autoExpandFileDiffs: true,
      detailChatMode: false,
      ...store,
    })
    return <Story />
  }
}

const meta: Meta<typeof AppearancePage> = {
  title: 'Settings/Appearance',
  component: AppearancePage,
  parameters: { layout: 'fullscreen' },
}

export default meta
type Story = StoryObj<typeof AppearancePage>

/** Theme cards in a padded card body; every other setting is a row. Pickers keep their live previews under the row. */
export const Default: Story = { decorators: [seed()] }

/** Non-default schemes and fonts, so the previews and dropdown labels differ from the defaults. */
export const CustomSchemes: Story = {
  decorators: [
    seed({
      terminalLightPalette: 'catppuccin-latte',
      terminalDarkPalette: 'tokyo-night',
      terminalFontSize: 13,
      terminalFontFamily: 'Menlo',
      mermaidLightTheme: 'forest',
      mermaidDarkTheme: 'neutral',
      uiFontFamily: 'Helvetica Neue',
      liquidGlass: true,
    }, 'light'),
  ],
}

export const Dark: Story = {
  decorators: [seed({}, 'dark')],
  globals: { theme: 'dark' },
}

/** Theme cards shrink with the column; row controls keep their width. */
export const Narrow: Story = {
  decorators: [
    seed(),
    (Story) => (
      <div className="w-[480px]">
        <Story />
      </div>
    ),
  ],
}
