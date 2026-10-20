import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import { ClaudeAccountsPanel, type ClaudeAccountsPanelProps } from './ClaudeAccountsPanel'
import type { ClaudeAccount } from '@superone/shared/agent-types'
const accounts: ClaudeAccount[] = [
  { credentialDir: '/accounts/personal', loggedIn: true, isDefault: true, identityStatus: 'verified', email: 'personal@example.com', identityKey: 'personal|org-a', orgId: 'org-a', orgName: 'Personal', subscriptionType: 'max', projectsDirectory: null },
  { credentialDir: '/accounts/work', loggedIn: true, isDefault: false, identityStatus: 'verified', email: 'work@example.com', identityKey: 'work|org-b', orgId: 'org-b', orgName: 'Acme', subscriptionType: 'pro', projectsDirectory: null },
]
const noop = () => {}
const meta = {
  title: 'Settings/Claude Accounts', component: ClaudeAccountsPanel, parameters: { layout: 'padded' },
  decorators: [(Story) => <div className="max-w-2xl"><Story /></div>],
  args: { accounts, meters: Object.fromEntries(accounts.map((row, index) => [row.credentialDir!, { limits: { windows: [
    { label: '5-hour', usedPercent: index ? 86 : 23, resetsAt: Math.floor(Date.now() / 1000) + 3600 },
    { label: 'Weekly', usedPercent: index ? 72 : 48, resetsAt: Math.floor(Date.now() / 1000) + 86400 },
  ], extraUsage: index ? { usedDollars: 41.5, limitDollars: 50 } : null, ...(index ? {} : { resetGrants: [{ resetsLeft: 1, expiresAt: Math.floor(Date.now() / 1000) + 3 * 86400 }] }),
  planType: row.subscriptionType } }])), onRefresh: noop, onRefreshUsage: noop, onSignIn: noop, onSignOut: noop, onRemove: noop, onSetDefault: noop, onCancel: noop },
} satisfies Meta<typeof ClaudeAccountsPanel>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {}
/** Accounts belonging to the desktop being controlled. This machine cannot sign them in or out. */
export const RemoteDesktop: Story = { args: { manage: false }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement)
  await expect(canvas.getByText('personal@example.com')).toBeInTheDocument()
  await expect(canvas.queryByRole('button', { name: /sign out/i })).not.toBeInTheDocument()
  await expect(canvas.queryByRole('button', { name: /add account/i })).not.toBeInTheDocument()
} }
export const Empty: Story = { args: { accounts: [] } }
export const Loading: Story = { args: { accounts: [], loading: true } }
export const UsageLoading: Story = { args: { meters: { '/accounts/personal': { loading: true }, '/accounts/work': { loading: true } } } }
export const RefreshingOneAccount: Story = { args: { meters: { ...meta.args.meters, '/accounts/personal': { ...meta.args.meters['/accounts/personal'], loading: true } } } }
export const ErrorRetry: Story = { args: { error: 'Could not load Claude accounts. Refresh to retry.' } }
export const IdentityUnavailable: Story = { args: { accounts: accounts.map((row) => ({ ...row, identityStatus: 'unavailable' })) } }
export const UncappedExtraUsage: Story = { args: { meters: { '/accounts/personal': { limits: { windows: [{ label: '5-hour', usedPercent: 100, resetsAt: Math.floor(Date.now() / 1000) + 1800 }], extraUsage: { usedDollars: 1234.56, limitDollars: null }, planType: 'max' } } } } }
export const UsageUnavailable: Story = { args: { meters: { '/accounts/personal': { error: true } } } }
export const SignedOut: Story = { args: { accounts: [{ ...accounts[0]!, loggedIn: false, identityStatus: 'signedOut' }] } }
export const BrowserLogin: Story = { args: { signingIn: true, busy: true } }
export const Disabled: Story = { args: { busy: true } }
export const Narrow: Story = { args: { accounts: [{ ...accounts[0]!, email: 'a-very-long-personal-account-address@example-company.com' }, accounts[1]!] }, decorators: [(Story) => <div style={{ width: 320 }}><Story /></div>] }
export const Chinese: Story = { globals: { locale: 'zh' } }
export const Dark: Story = { decorators: [(Story) => <div className="dark bg-background text-foreground p-4"><Story /></div>] }
function InteractivePanel(props: ClaudeAccountsPanelProps) {
  const [rows, setRows] = useState(props.accounts)
  return <ClaudeAccountsPanel {...props} accounts={rows}
    onSetDefault={(dir) => setRows((old) => old.map((row) => ({ ...row, isDefault: row.credentialDir === dir })))}
    onSignOut={(dir) => setRows((old) => old.map((row) => row.credentialDir === dir ? { ...row, loggedIn: false } : row))}
    onRemove={(dir) => setRows((old) => old.filter((row) => row.credentialDir !== dir))}
    onSignIn={(dir) => setRows((old) => dir ? old.map((row) => row.credentialDir === dir ? { ...row, loggedIn: true } : row) : [...old, { ...accounts[0]!, credentialDir: `/accounts/${old.length}`, email: `new-${old.length}@example.com`, isDefault: false }])} />
}
export const ChangeDefault: Story = { render: (args) => <InteractivePanel {...args} />, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement)
  await userEvent.click(canvas.getByRole('button', { name: /set as default/i }))
  await expect(canvas.getByText('work@example.com').parentElement).toHaveTextContent('Default')
} }
export const RemoveSignedOut: Story = { args: { accounts: [accounts[0]!, { ...accounts[1]!, loggedIn: false, identityStatus: 'signedOut' }] }, render: (args) => <InteractivePanel {...args} />, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement)
  await userEvent.click(canvas.getByRole('button', { name: /remove account/i }))
  await expect(canvas.queryByText('work@example.com')).not.toBeInTheDocument()
} }
