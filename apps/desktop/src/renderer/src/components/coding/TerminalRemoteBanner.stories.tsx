import { TerminalRemoteBanner } from './TerminalRemoteBanner'

export default {
  title: 'Desktop/TerminalRemoteBanner',
  component: TerminalRemoteBanner,
}

export const Observation = {
  name: 'Phone owns the tab · observation + disconnect',
  render: () => (
    <div className="flex h-40 flex-col bg-card">
      <div className="min-h-0 flex-1" />
      <TerminalRemoteBanner onDisconnect={() => {}} />
    </div>
  ),
}
