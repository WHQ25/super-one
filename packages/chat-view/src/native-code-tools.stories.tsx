import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useState, type ReactNode } from 'react'
import { PortableToolRow } from './PortableToolRow'
import { installFakeNativeHost } from './fixtures/native-host'
import { sanitizeRemoteToolInput } from '@superone/shared/remote-tool-input'
import { parsePatchToolText } from '@superone/shared/patch-tool'

function NativeHost({ children }: { children: ReactNode }) {
  const [previewPath, setPreviewPath] = useState('')
  useEffect(() => installFakeNativeHost((request, reply) => {
    if (request.action === 'previewFile') setPreviewPath(String(request.payload?.path ?? ''))
    reply({ result: { ok: true } })
  }), [])
  return <div className="@container w-[320px]">
    {children}
    {previewPath && <div role="status" className="mt-2 text-xs text-muted-foreground">Preview requested: {previewPath}</div>}
  </div>
}

const meta: Meta<typeof PortableToolRow> = {
  title: 'Tool UI/General/Native Code Tools (Mobile)',
  component: PortableToolRow,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <NativeHost><Story /></NativeHost>],
}
export default meta
type Story = StoryObj<typeof PortableToolRow>

const patchText = '*** Begin Patch\n*** Update File: src/config.ts\n@@\n-export const enabled = false\n+export const enabled = true\n*** Add File: src/new.ts\n+export const answer = 42\n*** End Patch'

export const PatchHeaders: Story = {
  args: { toolName: 'Patch', input: sanitizeRemoteToolInput('Patch', JSON.stringify({ patchText })), status: 'complete' },
}
export const PatchDetails: Story = {
  args: { toolName: 'Patch', input: JSON.stringify({ files: parsePatchToolText(patchText) }), status: 'complete', defaultExpanded: true },
}
export const CodeResult: Story = {
  args: { toolName: 'CodeExecution', input: '{"language":"JavaScript"}', result: '{"answer":42}', status: 'complete', defaultExpanded: true },
}
export const Streaming: Story = {
  args: { toolName: 'CodeExecution', input: '{"language":"JavaScript"}', status: 'streaming', elapsedSeconds: 2 },
}
export const Failed: Story = {
  args: { toolName: 'Patch', input: '{}', result: 'Patch context did not match', status: 'complete', isError: true, defaultExpanded: true },
}
export const Denied: Story = {
  args: { toolName: 'CodeExecution', input: '{"language":"JavaScript"}', result: '[denied] User denied permission', status: 'complete' },
}
export const Nested: Story = {
  args: { ...PatchDetails.args, allowExpand: false, inSubagent: true },
}
