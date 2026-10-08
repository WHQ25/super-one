import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'
import i18n from 'i18next'
import { encodeNodePairingCode } from '@superone/shared/environment/node-pairing-code'
import { mockIpc } from '../../../../../../.storybook/mock-ipc'
import { AddDesktopDialog } from './AddDesktopDialog'

type Params = {
  /** What the pasted code says; omit to leave the field empty. */
  paste?: 'valid' | 'garbage' | 'expired' | 'newer' | 'long'
  /** Main's pairRemote rejection message; omit for success. */
  pairError?: string
  submit?: boolean
}

const SECRET = 'e4620c0bf60dd8153f5073df3027f93dd7616ff89520dfbc6594907857bf6e6d'

function code(paste: NonNullable<Params['paste']>): string {
  if (paste === 'garbage') return 'superone://pair?channel=c0ffee&key=abc'
  if (paste === 'newer') return 'superone-node:3:eyJ1IjoiaHR0cDovL3gifQ'
  return encodeNodePairingCode({
    environmentId: 'env-9f3c2a',
    lan: {
      host: paste === 'long'
        ? 'hangqi-studio-display-workstation-with-a-very-long-bonjour-name.local'
        : 'Hangqis-Studio.local',
      port: paste === 'long' ? 47791 : 7791,
    },
    relay: { url: 'wss://relay.superone.example', room: '0f'.repeat(16) },
    pairingToken: 'pt_Jx8m2W0qLr4nB6sVt3yHc1kA',
    channel: { keyId: 'tok_7d1e', secretHex: SECRET },
    expiresAt: paste === 'expired' ? Date.now() - 1_000 : Date.now() + 10 * 60_000,
  })
}

const IPC = "Error invoking remote method 'environment:pairRemote': Error: "

/** Control Other Devices → Desktop → Add Desktop. `window.environment.pairRemote` is mocked. */
const meta = {
  title: 'Settings/Environments/Add Desktop',
  component: AddDesktopDialog,
  args: { open: true, onOpenChange: fn(), onAdded: fn() },
  beforeEach: ({ parameters }) => {
    const p = parameters as Params
    const previousApi = window.environment
    mockIpc('app', 'getHostname', async () => 'Hangqis-MacBook-Pro')
    window.environment = {
      ...previousApi,
      pairRemote: async () => {
        await new Promise((resolve) => setTimeout(resolve, 400))
        if (p.pairError) throw new Error(p.pairError)
        return { connectionId: 'c1', descriptor: {}, persisted: true }
      },
    }
    return () => { window.environment = previousApi }
  },
  play: async ({ canvasElement, parameters, args }) => {
    const p = parameters as Params
    if (!p.paste) return
    const screen = within(canvasElement.ownerDocument.body)
    await userEvent.click(screen.getByLabelText(i18n.t('settings.remote.addDesktop.codeLabel')))
    await userEvent.paste(code(p.paste))
    if (!p.submit) return
    await userEvent.click(screen.getByRole('button', { name: i18n.t('settings.remote.addDesktop.submit') }))
    if (!p.pairError) await waitFor(() => expect(args.onAdded).toHaveBeenCalled())
    else await expect(await screen.findByRole('alert')).toBeInTheDocument()
  },
} satisfies Meta<typeof AddDesktopDialog>
export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = {}

/** A valid code: Add is enabled and the name defaults to the machine name. */
export const ValidCode: Story = { parameters: { paste: 'valid' } }

export const InvalidCode: Story = { parameters: { paste: 'garbage' } }

export const ExpiredCode: Story = { parameters: { paste: 'expired' } }

export const NewerVersion: Story = { parameters: { paste: 'newer' } }

export const Success: Story = { parameters: { paste: 'valid', submit: true } }

export const Unreachable: Story = {
  parameters: {
    paste: 'valid',
    submit: true,
    pairError: `${IPC}pair request failed for remote node endpoint http://Hangqis-Studio.local:7791/v1/pair: connect ECONNREFUSED 192.168.1.20:7791`,
  },
}

export const TokenUsed: Story = {
  parameters: { paste: 'valid', submit: true, pairError: `${IPC}pairing token already used` },
}

export const ChannelRequired: Story = {
  parameters: { paste: 'valid', submit: true, pairError: `${IPC}this node accepts requests only inside its encrypted channel` },
}

/** Unknown failures fall back to main's message. */
export const OtherError: Story = {
  parameters: { paste: 'valid', submit: true, pairError: `${IPC}failed to store node credentials: keychain locked` },
}

export const LongHost: Story = {
  parameters: {
    paste: 'long',
    submit: true,
    pairError: `${IPC}pair request failed for remote node endpoint: encrypted auth request timeout`,
  },
}

export const Dark: Story = { ...Unreachable, globals: { theme: 'dark' } }

export const Chinese: Story = { ...Unreachable, globals: { locale: 'zh' } }
