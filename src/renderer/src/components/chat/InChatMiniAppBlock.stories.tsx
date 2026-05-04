import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState, type ReactNode } from 'react'
import { InChatMiniAppBlock } from './InChatMiniAppBlock'
import { useMiniAppStore } from '@/stores/miniapp'
import type { MiniAppEntry } from '../../../../shared/miniapp-types'

function StoryShell({ children, width = 720 }: { children: ReactNode; width?: number }) {
  return (
    <div className="@container" style={{ maxWidth: width }}>
      {children}
    </div>
  )
}

function SeedApps({ apps, children }: { apps: MiniAppEntry[]; children: ReactNode }) {
  useState(() => {
    useMiniAppStore.setState({ apps, loaded: true })
    return null
  })
  return <>{children}</>
}

const PROD_APP: MiniAppEntry = {
  id: 'palette-picker',
  installDir: '/Users/me/.superone/apps/palette-picker',
  manifest: {
    appId: 'palette-picker',
    name: 'Palette Picker',
    version: '1.2.0',
    inChatToolName: 'pick_palette',
    runningText: 'Picking colors',
  },
}

const DEV_APP: MiniAppEntry = {
  id: 'dev-charts',
  installDir: '/Users/me/projects/dev-charts',
  distDir: '/Users/me/projects/dev-charts/dist',
  manifest: {
    appId: 'dev-charts',
    name: 'Dev Charts',
    version: '0.0.1',
    isDev: true,
    inChatToolName: 'render_chart',
  },
}

const meta: Meta<typeof InChatMiniAppBlock> = {
  title: 'Common/InChatMiniAppBlock',
  component: InChatMiniAppBlock,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <StoryShell><Story /></StoryShell>],
}

export default meta
type Story = StoryObj<typeof InChatMiniAppBlock>

export const ProductionIframe: Story = {
  args: {
    appId: 'palette-picker',
    data: { palette: ['#fcd9b8', '#f0a062', '#864', '#1a1a1a'] },
  },
  decorators: [(Story) => <SeedApps apps={[PROD_APP]}><Story /></SeedApps>],
}

export const DevWebview: Story = {
  args: {
    appId: 'dev-charts',
    data: { series: [{ x: 1, y: 4 }, { x: 2, y: 7 }, { x: 3, y: 3 }] },
  },
  decorators: [(Story) => <SeedApps apps={[DEV_APP]}><Story /></SeedApps>],
}

export const UnknownApp: Story = {
  args: {
    appId: 'not-installed',
    data: {},
  },
  decorators: [(Story) => <SeedApps apps={[]}><Story /></SeedApps>],
}
