import type { Meta, StoryObj } from '@storybook/react'
import { useEffect, useState } from 'react'
import { expect, userEvent, within } from 'storybook/test'
import { createDefaultPerSessionState, createDefaultProjectState, useChatStore } from '@/stores/chat'
import { useActivityPanelStore } from '@/stores/activity-panel'
import { useAppStore } from '@/stores/app'
import { HeaderSessionMenu } from './HeaderSessionMenu'

/**
 * The chat title's hover menu. Float Chat / Dock Chat sits right above Convert to
 * Mini Window: both choose how this chat is shown. Each story opens the menu.
 */
const FOLDER = '/Users/me/project'
const SESSION = 'story-session'

function seed(floating: boolean, empty = false) {
  const project = createDefaultProjectState()
  project._activeSessionId = SESSION
  project._sessions = {
    [SESSION]: {
      ...createDefaultPerSessionState(),
      cwd: FOLDER,
      _title: 'Refactor the layout tools',
      messages: empty ? [] : [{ id: 'm1', role: 'user', content: [{ type: 'text', text: 'hi' }] }] as never,
    },
  }
  useChatStore.setState({ projectSessions: { [FOLDER]: project }, activeProject: FOLDER })
  useAppStore.setState({ liquidGlass: false })
  useActivityPanelStore.setState({ showPanel: floating, maximized: false, chatFloating: floating })
}

function MenuPreview({ floating, empty = false }: { floating: boolean; empty?: boolean }) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    seed(floating, empty)
    setReady(true)
  }, [floating, empty])
  if (!ready) return null
  return (
    <div className="group/htitle flex items-center gap-1 text-xs text-muted-foreground">
      {empty ? 'New Session' : 'Refactor the layout tools'}
      <HeaderSessionMenu sessionId={SESSION} folderPath={FOLDER} />
    </div>
  )
}

const meta = {
  title: 'Chat/Header session menu',
  component: MenuPreview,
  parameters: { layout: 'padded' },
  args: { floating: false },
} satisfies Meta<typeof MenuPreview>

export default meta
type Story = StoryObj<typeof meta>

const openMenu = async (canvasElement: HTMLElement) => {
  await userEvent.click(await within(canvasElement).findByRole('button', { name: 'Session actions' }))
}

export const Docked: Story = {
  name: 'docked · offers Float Chat',
  play: async ({ canvasElement }) => {
    await openMenu(canvasElement)
    await expect(await within(document.body).findByRole('menuitem', { name: 'Float Chat' })).toBeInTheDocument()
  },
}

export const Floating: Story = {
  name: 'floating · offers Dock Chat',
  args: { floating: true },
  play: async ({ canvasElement }) => {
    await openMenu(canvasElement)
    await expect(await within(document.body).findByRole('menuitem', { name: 'Dock Chat' })).toBeInTheDocument()
  },
}

export const DockedChinese: Story = {
  name: 'docked · Chinese',
  globals: { locale: 'zh' },
  play: async ({ canvasElement }) => {
    await openMenu(canvasElement)
    await within(document.body).findByRole('menuitem', { name: '浮窗显示聊天' })
  },
}

export const FloatingDark: Story = {
  ...Floating,
  name: 'floating · dark',
  globals: { theme: 'dark' },
}

export const NewSession: Story = {
  name: 'new session · form entries only',
  args: { empty: true },
  play: async ({ canvasElement }) => {
    await openMenu(canvasElement)
    const items = await within(document.body).findAllByRole('menuitem')
    await expect(items.map((item) => item.textContent)).toEqual(['Float Chat', 'Convert to Mini Window'])
  },
}
