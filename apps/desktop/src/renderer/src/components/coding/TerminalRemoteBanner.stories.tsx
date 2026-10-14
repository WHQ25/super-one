import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import type { TerminalListItem } from '@superone/shared/agent-types'
import { NODE_WINDOW_TERMINAL_OWNER, remoteTerminalKey } from '@superone/shared/remote-resource-key'
import { TerminalRemoteBanner } from './TerminalRemoteBanner'
import { TerminalTabStrip } from './TerminalTabStrip'
import { terminalHolder } from './terminal-holder'

const tab = (terminalId: string, title: string, ownerDeviceId: string | null, extra: Partial<TerminalListItem> = {}): TerminalListItem => ({
  terminalId, title, ownerDeviceId, cwd: '/Users/b/app', projectPath: '/Users/b/app', status: 'running', ...extra,
})
const remote = (id: string) => remoteTerminalKey('desktop-b', id)

/**
 * The terminal panel's tab strip and banner as TerminalPanel lays them out,
 * for a tab of this computer or of a paired node (`remote` keys). Take Over
 * and Disconnect hand the tab to this window, as the lease would.
 */
function Preview({ tabs: initial, hostName = 'Desktop B', width = 640 }: { tabs: TerminalListItem[]; hostName?: string | null; width?: number }) {
  const [tabs, setTabs] = useState(initial)
  const [activeId, setActiveId] = useState(initial[0]?.terminalId ?? null)
  const active = tabs.find((item) => item.terminalId === activeId)
  const holder = terminalHolder(active?.ownerDeviceId)
  const isRemote = activeId?.startsWith('remote-terminal:') ?? false
  return (
    <div className="flex h-56 flex-col bg-card" style={{ width }}>
      <div className="flex h-9 shrink-0 items-center gap-1 overflow-x-auto px-2">
        <TerminalTabStrip
          tabs={tabs}
          activeId={activeId}
          onActivate={setActiveId}
          onClose={(id) => setTabs((list) => list.filter((item) => item.terminalId !== id))}
          onReorder={() => {}}
        />
      </div>
      <pre className="min-h-0 flex-1 overflow-hidden p-2 font-mono text-xs text-muted-foreground">$ bun run dev{'\n'}ready on http://localhost:5173</pre>
      {holder !== 'me' && (
        <TerminalRemoteBanner
          holder={holder}
          hostName={hostName}
          action={!isRemote ? 'disconnect' : holder === 'host' ? 'takeOver' : undefined}
          onAction={() => setTabs((list) => list.map((item) => item.terminalId === activeId ? { ...item, ownerDeviceId: null } : item))}
        />
      )}
    </div>
  )
}

const meta = {
  title: 'Desktop/TerminalOwnership',
  component: Preview,
} satisfies Meta<typeof Preview>

export default meta
type Story = StoryObj<typeof meta>

export const OwnedByMe: Story = {
  name: 'Remote tab this desktop writes in',
  args: { tabs: [tab(remote('t1'), 'zsh', null), tab(remote('t2'), 'vite', null)] },
}

export const HeldByNodeWindow: Story = {
  name: "Node's window took it back · Take Over",
  args: { tabs: [tab(remote('t1'), 'zsh', NODE_WINDOW_TERMINAL_OWNER), tab(remote('t2'), 'vite', null)] },
}

export const HeldByNodeWindowUnnamed: Story = {
  name: "Node's window took it back · name loading",
  args: { tabs: [tab(remote('t1'), 'zsh', NODE_WINDOW_TERMINAL_OWNER)], hostName: null },
}

export const HeldByPhone: Story = {
  name: "A phone of the node holds it · view only",
  args: { tabs: [tab(remote('t1'), 'zsh', 'phone-1')] },
}

export const HeldByAnotherDesktop: Story = {
  name: 'Another computer holds it · view only',
  args: { tabs: [tab(remote('t1'), 'htop', 'node:cs-2')] },
}

export const LocalTabHeldByPhone: Story = {
  name: 'This computer · a phone holds the tab · Disconnect',
  args: { tabs: [tab('local-1', 'zsh', 'phone-1')] },
}

export const LocalTabHeldByController: Story = {
  name: 'This computer · a controller desktop holds the tab · Disconnect',
  args: { tabs: [tab('local-1', 'zsh', 'node:cs-1')] },
}

export const ManyTerminals: Story = {
  name: 'Many tabs with every writer',
  args: {
    tabs: [
      tab(remote('t1'), 'zsh', NODE_WINDOW_TERMINAL_OWNER),
      ...Array.from({ length: 6 }, (_, i) => tab(remote(`m${i}`), `worker ${i + 1}`, null)),
      tab(remote('p'), 'phone shell', 'phone-1'),
      tab(remote('d'), 'another computer', 'node:cs-2'),
      tab(remote('a'), 'bun test --watch', null, { agentControl: { sessionId: 's1', command: 'bun test --watch', startedAt: 0 } }),
      tab(remote('long'), 'a very long running command title that truncates in the strip', null),
    ],
  },
}

export const Narrow: Story = {
  name: 'Narrow panel · long computer name',
  args: {
    tabs: [tab(remote('t1'), 'zsh', NODE_WINDOW_TERMINAL_OWNER), tab(remote('t2'), 'vite', 'phone-1')],
    hostName: 'Build server in the third floor lab (Mac Studio)',
    width: 260,
  },
}
