import { useLayoutEffect } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fireEvent, userEvent, waitFor, within } from 'storybook/test'
import type { ThemeMode } from '@superone/shared/agent-types'
import { Button } from '@superone/ui/components/ui/button'
import { useAppStore } from '@/stores/app'
import { useActiveHarness } from '@/hooks/useHarnessTheme'
import { mockIpc } from '../../../../../.storybook/mock-ipc'
import { BrandColorPopover } from './BrandColorPopover'

function Preview({ width = 360, customized = false, glass = false }) {
  const harness = useActiveHarness()
  useLayoutEffect(() => {
    const previous = useAppStore.getState()
    useAppStore.setState({
      brandHues: { ...previous.brandHues, [harness]: customized ? 300 : null },
      darkBrandHues: { ...previous.darkBrandHues, [harness]: customized ? 130 : null },
      tokenOverrides: { ...previous.tokenOverrides, [harness]: customized ? { '--primary': { h: 300 } } : {} },
      darkTokenOverrides: { ...previous.darkTokenOverrides, [harness]: customized ? { '--primary': { l: 0.65, c: 0.12, a: 0.8 } } : {} },
      liquidGlass: glass,
    })
    return () => {
      useAppStore.setState({
        brandHues: previous.brandHues, darkBrandHues: previous.darkBrandHues,
        tokenOverrides: previous.tokenOverrides, liquidGlass: previous.liquidGlass,
        darkTokenOverrides: previous.darkTokenOverrides,
      })
    }
  }, [harness, customized, glass])

  return (
    <div className="flex min-h-[640px] items-end gap-3 rounded-xl bg-sidebar p-4 text-sidebar-foreground" style={{ width }} data-sidebar-inner>
      <BrandColorPopover />
      <Button size="sm">Primary Action</Button>
    </div>
  )
}

const meta = {
  title: 'Sidebar/BrandColorPopover',
  component: Preview,
  parameters: { layout: 'centered' },
  decorators: [(Story, context) => {
    let state = { mode: (context.globals.theme ?? 'light') as ThemeMode, dark: context.globals.theme === 'dark' }
    const listeners = new Set<(next: typeof state) => void>()
    mockIpc('app', 'getTheme', async () => state)
    mockIpc('app', 'onThemeChange', listener => {
      listeners.add(listener as (next: typeof state) => void)
      return () => { listeners.delete(listener as (next: typeof state) => void) }
    })
    mockIpc('app', 'setTheme', async mode => {
      state = { mode: mode as ThemeMode, dark: mode === 'dark' }
      for (const listener of listeners) listener(state)
      return state
    })
    mockIpc('app', 'saveAppSettings', async () => ({}))
    return <Story />
  }],
} satisfies Meta<typeof Preview>
export default meta
type Story = StoryObj<typeof meta>

const openPalette: NonNullable<Story['play']> = async ({ canvasElement }) => {
  await userEvent.click(within(canvasElement).getByRole('button', { name: /^(Customize|自定义)/ }))
  await expect(within(canvasElement.ownerDocument.body).getByRole('dialog')).toBeVisible()
}

export const Light: Story = { globals: { theme: 'light' }, play: openPalette }
export const Dark: Story = { globals: { theme: 'dark' }, play: openPalette }
export const StableFooter: Story = {
  ...Dark,
  play: async context => {
    await openPalette(context)
    const page = within(context.canvasElement.ownerDocument.body)
    const dialog = page.getByRole('dialog')
    const footer = dialog.lastElementChild as HTMLElement
    const height = footer.getBoundingClientRect().height
    const assertHeight = () => expect(footer.getBoundingClientRect().height).toBe(height)
    fireEvent.change(page.getByRole('slider'), { target: { value: '130' } })
    await expect(await page.findByRole('button', { name: 'Reset' })).toBeVisible()
    await assertHeight()
    await userEvent.click(page.getByRole('button', { name: 'Reset' }))
    await waitFor(() => expect(page.getByRole('slider')).toHaveValue('255'))
    await assertHeight()
    await userEvent.click(page.getByRole('button', { name: 'Light', pressed: false }))
    await waitFor(() => expect(page.getByRole('button', { name: 'Advanced' })).toBeVisible())
    await assertHeight()
    fireEvent.change(page.getByRole('slider', { name: /^Claude|^Codex/ }), { target: { value: '300' } })
    await expect(await page.findByRole('button', { name: 'Reset' })).toBeVisible()
    await assertHeight()
    await userEvent.click(page.getByRole('button', { name: 'Dark', pressed: false }))
    await waitFor(() => expect(page.getByRole('button', { name: 'Dark', pressed: true })).toBeVisible())
    await assertHeight()
  },
}
export const DarkCustomized: Story = { ...Dark, args: { customized: true } }
export const DarkGlassChinese: Story = { ...DarkCustomized, globals: { theme: 'dark', locale: 'zh' }, args: { customized: true, glass: true } }
export const Narrow: Story = { ...Light, args: { width: 280 } }
export const Advanced: Story = {
  ...Light,
  args: { customized: true },
  play: async context => {
    await openPalette(context)
    await userEvent.click(within(context.canvasElement.ownerDocument.body).getByRole('button', { name: 'Advanced' }))
    await expect(within(context.canvasElement.ownerDocument.body).getByRole('combobox')).toBeVisible()
    await expect(within(context.canvasElement.ownerDocument.body).queryByRole('switch')).not.toBeInTheDocument()
    await expect(within(context.canvasElement.ownerDocument.body).queryByRole('button', { name: 'Light' })).not.toBeInTheDocument()
  },
}

export const DarkAdvanced: Story = {
  ...Dark,
  play: async context => {
    await openPalette(context)
    const page = within(context.canvasElement.ownerDocument.body)
    await userEvent.click(page.getByRole('button', { name: /^(Advanced|高级)$/ }))
    await expect(page.queryByRole('switch')).not.toBeInTheDocument()
    await expect(page.queryByRole('button', { name: /^(Light|Dark|浅色|深色)$/ })).not.toBeInTheDocument()
    await userEvent.click(page.getByRole('combobox'))
    await expect(page.getAllByRole('option')).toHaveLength(1)
    await userEvent.click(page.getByRole('option', { name: /^--primary/ }))
  },
}
export const DarkAdvancedChinese: Story = { ...DarkAdvanced, globals: { theme: 'dark', locale: 'zh' }, args: { customized: true, width: 280 } }
