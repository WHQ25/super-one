import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { ToolBlock } from './ToolBlock'

function StoryShell({ children, width = 640 }: { children: ReactNode; width?: number }) {
  return (
    <div className="@container" style={{ maxWidth: width }}>
      {children}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
      <div className="space-y-1">{children}</div>
    </section>
  )
}

function block(
  tool: 'miniapp_dev_setup' | 'miniapp_dev_register' | 'miniapp_dev_pack' | 'miniapp_dev_update_types',
  input: Record<string, unknown>,
  status: 'streaming' | 'complete' = 'complete',
  result?: string,
) {
  return (
    <ToolBlock
      toolName={`mcp__superone__${tool}`}
      input={JSON.stringify(input)}
      status={status}
      result={result}
    />
  )
}

const meta: Meta<typeof ToolBlock> = {
  title: 'Tool UI/SuperOne MCP/Miniapp',
  component: ToolBlock,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <StoryShell><Story /></StoryShell>],
}

export default meta
type Story = StoryObj<typeof ToolBlock>

const SETUP_INPUT = {
  name: 'palette-picker',
  directory: '/Users/me/projects/palette-picker',
  description: 'A small mini-app that picks colors from an image.',
}

export const MiniappDevSetup: Story = {
  name: 'miniapp_dev_setup',
  render: () => (
    <StoryShell>
      <Section title="miniapp_dev_setup">
        {block('miniapp_dev_setup', SETUP_INPUT, 'streaming')}
        {block('miniapp_dev_setup', SETUP_INPUT, 'complete', JSON.stringify({ status: 'ok', appId: 'palette-picker' }))}
      </Section>
    </StoryShell>
  ),
}

export const MiniappDevRegister: Story = {
  name: 'miniapp_dev_register',
  render: () => (
    <StoryShell>
      <Section title="miniapp_dev_register">
        {block('miniapp_dev_register', { directory: SETUP_INPUT.directory, name: SETUP_INPUT.name }, 'streaming')}
        {block('miniapp_dev_register', { directory: SETUP_INPUT.directory, name: SETUP_INPUT.name }, 'complete', JSON.stringify({ status: 'ok', appId: 'palette-picker' }))}
      </Section>
    </StoryShell>
  ),
}

export const MiniappDevPack: Story = {
  name: 'miniapp_dev_pack',
  render: () => (
    <StoryShell>
      <Section title="miniapp_dev_pack">
        {block('miniapp_dev_pack', { appDir: SETUP_INPUT.directory, outputDir: '/tmp' }, 'streaming')}
        {block('miniapp_dev_pack', { appDir: SETUP_INPUT.directory, outputDir: '/tmp' }, 'complete', JSON.stringify({ status: 'ok', file: '/tmp/palette-picker.s1app' }))}
      </Section>
    </StoryShell>
  ),
}

export const MiniappDevUpdateTypes: Story = {
  name: 'miniapp_dev_update_types',
  render: () => (
    <StoryShell>
      <Section title="miniapp_dev_update_types">
        {block('miniapp_dev_update_types', { appDir: SETUP_INPUT.directory }, 'streaming')}
        {block('miniapp_dev_update_types', { appDir: SETUP_INPUT.directory }, 'complete', JSON.stringify({ status: 'ok', updated: true }))}
      </Section>
    </StoryShell>
  ),
}
