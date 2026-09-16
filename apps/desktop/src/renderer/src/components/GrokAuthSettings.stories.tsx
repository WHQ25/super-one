import { useMemo } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import type { GrokAuthState } from '@superone/shared/grok-auth'
import { GrokAuthSettings, type GrokAuthApi } from './GrokAuthSettings'

function Preview({ initial, narrow = false, loading = false }: { initial: GrokAuthState; narrow?: boolean; loading?: boolean }) {
  const api = useMemo<GrokAuthApi>(() => {
    let state = initial
    return async (request) => {
      if (loading) return new Promise(() => {})
      if (request.action === 'start') state = { status: 'waiting', loginId: 'preview', authUrl: 'https://grok.com/login' }
      if (request.action === 'cancel') state = { status: 'signed_out' }
      if (request.action === 'submit') state = { status: 'signed_in', email: 'alex@example.com' }
      return state
    }
  }, [initial, loading])
  return <div data-grok-preview className="bg-background text-foreground p-6" style={{ width: narrow ? 360 : 720, maxWidth: '100%' }}><GrokAuthSettings api={api} /></div>
}
const meta = { title: 'Settings/Grok Account', component: Preview, parameters: { layout: 'centered' } } satisfies Meta<typeof Preview>
export default meta
type Story = StoryObj<typeof meta>
export const SignedOut: Story = { args: { initial: { status: 'signed_out' } } }
export const BrowserLogin: Story = { args: { initial: { status: 'waiting', loginId: 'preview', authUrl: 'https://grok.com/login' } } }
export const Connected: Story = { args: { initial: { status: 'signed_in', email: 'alex@example.com' } } }
export const Failed: Story = { args: { initial: { status: 'error', error: 'Login timed out. Please try again.' } } }
export const Unavailable: Story = { args: { initial: { status: 'unavailable' } } }
export const Narrow: Story = { args: { ...BrowserLogin.args, narrow: true } }

export const Loading: Story = { args: { initial: { status: 'signed_out' }, loading: true } }
export const Preparing: Story = { args: { initial: { status: 'starting', loginId: 'preview' } } }
export const Verifying: Story = { args: { initial: { status: 'verifying', loginId: 'preview' } } }
export const LongAccount: Story = { args: { narrow: true, initial: { status: 'signed_in', email: 'alexandra.engineering.platform.team@long-company-domain.example.com' } } }
