import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, waitFor } from 'storybook/test'
import { Button } from '@superone/ui/components/ui/button'
import { ActivityPanel } from '@/components/activity/ActivityPanel'
import { isDockReady, openNewFileTab } from '@/components/activity/activity-panel-api'
import { useActivityPanelStore } from '@/stores/activity-panel'

/**
 * A tab opened into a strip that already overflows lands fully in view — even when
 * the Activity panel was closed at the time, as it is when a file chip in chat
 * opens it. Click the button to open another tab at the end of the strip.
 */

const SEED_TABS = ['/storybook/bun-run-storybook.log', '/storybook/chat-mentionchip.tsx', '/storybook/git-graph.md']
const NEW_TAB = '/storybook/browser/f1bbb7ed-aeb8-48cd-9069-8bbeac2b5a8b.png'

function Scenario() {
  return (
    <div className="relative flex h-screen">
      <ActivityPanel getMaxWidth={() => window.innerWidth} transitionMs={0} />
      <div className="p-4">
        <Button variant="outline" onClick={() => openNewFileTab(NEW_TAB)}>Open image tab</Button>
      </div>
    </div>
  )
}

const meta: Meta<typeof Scenario> = {
  title: 'Activity/Tab Strip',
  component: Scenario,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => {
      useActivityPanelStore.setState({ panelWidth: 420 })
      // The file bodies only need to mount; every environment call resolves empty.
      const original = window.environment
      window.environment = new Proxy(original ?? {}, {
        get: (target, key) => Reflect.get(target, key) ?? (async () => undefined),
      }) as typeof window.environment
      return <Story />
    },
  ],
}

export default meta
type Story = StoryObj<typeof Scenario>

function activeTabFitsStrip(root: HTMLElement): boolean {
  const tab = root.querySelector<HTMLElement>('.dv-tab[aria-selected="true"]')
  const strip = tab?.parentElement
  if (!tab || !strip) return false
  const t = tab.getBoundingClientRect()
  const s = strip.getBoundingClientRect()
  return t.left >= s.left && t.right <= s.right
}

const openIntoOverflowingStrip = (closeFirst: boolean): Story['play'] => async ({ canvasElement, canvas, userEvent }) => {
  await waitFor(() => expect(isDockReady()).toBe(true))
  for (const path of SEED_TABS) openNewFileTab(path)
  if (closeFirst) useActivityPanelStore.getState().setShowPanel(false)
  await userEvent.click(await canvas.findByRole('button', { name: 'Open image tab' }))
  await waitFor(() => expect(activeTabFitsStrip(canvasElement)).toBe(true))
}

/** The Activity panel is closed when the tab opens — the case a file chip hits. */
export const OpenWhileClosed: Story = { play: openIntoOverflowingStrip(true) }

export const OpenWhileShown: Story = { play: openIntoOverflowingStrip(false) }

export const OpenWhileClosedLight: Story = { play: openIntoOverflowingStrip(true), globals: { theme: 'light' } }
