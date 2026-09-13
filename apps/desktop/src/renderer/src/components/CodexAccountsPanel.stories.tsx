import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { CodexAccountsPanel, type CodexAccountsPanelProps } from './CodexAccountsPanel'
import type { CodexAccount } from '@superone/shared/codex-accounts'

const accounts: CodexAccount[] = [
  { id: '11111111-1111-4111-8111-111111111111', signedIn: true, isDefault: true, email: 'personal@example.com', planType: 'plus', authMode: 'chatgpt', requiresOpenaiAuth: true },
  { id: '22222222-2222-4222-8222-222222222222', signedIn: true, isDefault: false, email: 'work@example.com', planType: 'pro', authMode: 'chatgpt', requiresOpenaiAuth: true },
]
const noop = () => {}
const meta = {
  title: 'Settings/Codex Accounts', component: CodexAccountsPanel,
  parameters: { layout: 'padded' },
  args: { accounts, onRefresh: noop, onSignIn: noop, onSignOut: noop, onSetDefault: noop, onCancel: noop, onOpenLogin: noop, onCopyCode: noop },
} satisfies Meta<typeof CodexAccountsPanel>
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {}
export const Empty: Story = { args: { accounts: [] } }
export const Loading: Story = { args: { accounts: [], loading: true } }
export const Submitting: Story = { args: { busy: true } }
export const Disabled: Story = { args: { disabled: true } }
export const ErrorRetry: Story = { args: { error: 'Could not connect to Codex. Refresh to try again.' } }
export const SignedOut: Story = { args: { accounts: [{ ...accounts[0]!, signedIn: false, isDefault: false }] } }
export const BrowserLogin: Story = { args: { pending: { accountId: 'new', type: 'chatgpt', loginId: 'test', authUrl: 'https://example.com' } } }
export const DeviceCode: Story = { args: { pending: { accountId: 'new', type: 'chatgptDeviceCode', loginId: 'test', verificationUrl: 'https://example.com', userCode: 'ABCD-EFGH' } } }
export const Narrow: Story = {
  args: { accounts: [{ ...accounts[0]!, email: 'a-very-long-personal-account-address@example-company.com' }, accounts[1]!] },
  decorators: [(Story) => <div style={{ width: 320 }}><Story /></div>],
}
function InteractivePanel(props: CodexAccountsPanelProps) {
  const [rows, setRows] = useState(props.accounts)
  return <CodexAccountsPanel {...props} accounts={rows}
    onSetDefault={(id) => setRows((rows) => rows.map((a) => ({ ...a, isDefault: a.id === id })))}
    onSignOut={(id) => setRows((rows) => rows.map((a) => a.id === id ? { ...a, signedIn: false, isDefault: false } : a))}
    onSignIn={(id) => setRows((rows) => id ? rows.map((a) => a.id === id ? { ...a, signedIn: true } : a) : [...rows, { ...accounts[0]!, id: `account-${rows.length}`, isDefault: rows.length === 0, email: `new-${rows.length}@example.com` }])}
  />
}
export const ChangeDefault: Story = { render: (args) => <InteractivePanel {...args} /> }
