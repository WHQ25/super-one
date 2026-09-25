import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { ChevronDown, Plus } from 'lucide-react'
import { Button } from '@superone/ui/components/ui/button'
import { Switch } from '@superone/ui/components/ui/switch'
import { SettingsPage, SettingsRow, SettingsSection, SettingsSubheader } from './SettingsSection'

const meta: Meta<typeof SettingsPage> = {
  title: 'Settings/Primitives',
  component: SettingsPage,
  parameters: { layout: 'fullscreen' },
}

export default meta
type Story = StoryObj<typeof SettingsPage>

function Toggle({ initial = false }: { initial?: boolean }) {
  const [on, setOn] = useState(initial)
  return <Switch checked={on} onCheckedChange={setOn} />
}

function Picker({ value }: { value: string }) {
  return (
    <button className="flex h-7 items-center gap-2 rounded-md border border-border bg-background px-2.5 text-sm">
      {value}
      <ChevronDown className="size-3.5 text-muted-foreground" />
    </button>
  )
}

/** Single-row and multi-row groups: dividers start at the row's text inset and never sit above the first row. */
export const Basic: Story = {
  render: () => (
    <SettingsPage title="General">
      <SettingsSection title="Language & Region">
        <SettingsRow label="Language" description="Takes effect immediately">
          <Picker value="English" />
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title="Notifications">
        <SettingsRow label="Session completion" description="When an agent finishes or needs confirmation">
          <Toggle initial />
        </SettingsRow>
        <SettingsRow label="Quiet on desktop while phone is online" description="Avoid double alerts">
          <Toggle initial />
        </SettingsRow>
        <SettingsRow label="Row without a description">
          <Toggle />
        </SettingsRow>
      </SettingsSection>
    </SettingsPage>
  ),
}

/** Section actions on the title line, subheaders inside a card, and a full-width footer under a row. */
export const Dense: Story = {
  render: () => (
    <SettingsPage title="Zhipu GLM" actions={<Button size="sm" variant="outline" className="h-7">Test</Button>}>
      <SettingsSection title="Keys" actions={<Button size="sm" variant="ghost" className="h-7"><Plus className="size-3.5" />Add Key</Button>}>
        <SettingsRow label={<span className="flex items-center gap-2">Work <span className="font-mono text-xs text-muted-foreground">sk-••••a3f9</span></span>} />
        <SettingsRow label={<span className="flex items-center gap-2">Personal <span className="font-mono text-xs text-muted-foreground">sk-••••71c0</span></span>}>
          <Button size="sm" variant="outline" className="h-7">Set Default</Button>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title="Models" description="24 available">
        <SettingsSubheader>Enabled</SettingsSubheader>
        <SettingsRow label="GLM-4.6"><Toggle initial /></SettingsRow>
        <SettingsRow label="GLM-4.5 Air"><Toggle initial /></SettingsRow>
        <SettingsSubheader>Disabled</SettingsSubheader>
        <SettingsRow label="GLM-4 Plus"><Toggle /></SettingsRow>
      </SettingsSection>
      <SettingsSection title="Updates">
        <SettingsRow
          label="Check for Updates"
          description="Downloading v0.72.0 — 42%"
          footer={<div className="h-1 overflow-hidden rounded-full bg-muted"><div className="h-full w-[42%] rounded-full bg-primary" /></div>}
        >
          <Button size="sm" variant="outline" className="h-7" disabled>Check</Button>
        </SettingsRow>
      </SettingsSection>
    </SettingsPage>
  ),
}

/** Long copy wraps under the label while the control keeps its size. */
export const LongContent: Story = {
  render: () => (
    <SettingsPage title="Experimental">
      <SettingsSection title="Experimental" description="May be unstable">
        <SettingsRow
          label="Route Claude through the OpenAI Chat Completions protocol for third-party gateways that only speak it"
          description="Requests are translated on the fly. Streaming, tool calls and images are supported; prompt caching and extended thinking are not, and some gateways reject the translated reasoning blocks entirely."
        >
          <Toggle />
        </SettingsRow>
      </SettingsSection>
    </SettingsPage>
  ),
}

export const Narrow: Story = {
  ...Basic,
  decorators: [(Story) => <div className="w-[420px]"><Story /></div>],
}
