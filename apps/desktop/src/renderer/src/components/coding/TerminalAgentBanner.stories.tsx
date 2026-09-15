import { TerminalAgentBanner } from './TerminalAgentBanner'

export default {
  title: 'Desktop/TerminalAgentBanner',
  component: TerminalAgentBanner,
}

export const Driving = {
  name: 'Agent drives a command',
  render: () => (
    <div className="flex h-40 flex-col bg-card">
      <div className="min-h-0 flex-1" />
      <TerminalAgentBanner command="bun run storybook --ci" />
    </div>
  ),
}

export const LongCommand = {
  name: 'Long command truncates in a narrow panel',
  render: () => (
    <div className="flex h-40 w-72 flex-col bg-card">
      <div className="min-h-0 flex-1" />
      <TerminalAgentBanner command="docker compose -f docker-compose.dev.yml up --build api worker scheduler" />
    </div>
  ),
}
