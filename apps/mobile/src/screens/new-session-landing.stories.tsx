import type { ComponentProps, ReactNode } from 'react'
import { View } from 'react-native'
import { MobileThemeProvider, useMobileTheme } from '../theme/context'
import { NewSessionLanding, type NewSessionLandingProps } from './new-session-landing'

const noop = () => {}

const harnessOptions: NewSessionLandingProps['harnessOptions'] = [
  { key: 'claude', provider: 'claude', acpAgentId: null, label: 'Claude Code' },
  { key: 'codex', provider: 'codex', acpAgentId: null, label: 'Codex' },
  { key: 'acp:grok-build', provider: 'acp', acpAgentId: 'grok-build', label: 'Grok Build' },
]

const base: NewSessionLandingProps = {
  provider: 'claude',
  harnessOptions,
  activeHarnessKey: 'claude',
  onHarness: noop,
  projectName: 'super-one',
  onOpenProject: noop,
  worktreeSelection: { kind: 'local' },
  worktreeInfo: {
    isWorktree: false,
    currentBranch: 'feat/mobile-ui',
    entries: [],
  },
  branch: 'feat/mobile-ui',
  dirtyFiles: 3,
  onWorktree: noop,
  onBranch: noop,
}

function Frame({ children, width, height }: { children: ReactNode; width: number; height: number }) {
  const { tokens } = useMobileTheme()
  return <View style={{ width, height, backgroundColor: tokens.colors.background }}>{children}</View>
}

function Phone({ children, height = 520, width = 390 }: { children: ReactNode; height?: number; width?: number }) {
  return (
    <MobileThemeProvider>
      <Frame width={width} height={height}>{children}</Frame>
    </MobileThemeProvider>
  )
}

function Preview(props: ComponentProps<typeof NewSessionLanding> & { frameHeight?: number; frameWidth?: number }) {
  const { frameHeight, frameWidth, ...landing } = props
  return <Phone height={frameHeight} width={frameWidth}><NewSessionLanding {...landing} /></Phone>
}

export default {
  title: 'Mobile/NewSessionLanding',
  component: NewSessionLanding,
  render: Preview,
  args: base,
}

export const KeyboardDown = {
  name: 'Keyboard down · icon centered in transcript',
}

export const KeyboardUp = {
  name: 'Keyboard up · compressed transcript',
  render: (props: ComponentProps<typeof NewSessionLanding>) => <Preview {...props} frameHeight={260} />,
}

export const NoProject = {
  args: { projectName: undefined, branch: undefined, dirtyFiles: undefined },
}

export const PoweredByCodex = {
  args: { provider: 'codex', activeHarnessKey: 'codex' },
}

export const LongNames = {
  args: {
    projectName: 'super-one-mobile-remote-control-workspace',
    branch: 'feat/new-session-landing-harness-icon-vertical-alignment',
  },
}

export const Narrow = {
  render: (props: ComponentProps<typeof NewSessionLanding>) => <Preview {...props} frameWidth={320} />,
}
