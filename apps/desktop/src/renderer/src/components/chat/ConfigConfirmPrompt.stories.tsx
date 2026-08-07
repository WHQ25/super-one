import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ConfigConfirmField, ConfigConfirmPayload } from '@superone/shared/agent-types'
import { customPlatformEndpoints, type Credential, type Platform } from '@superone/shared/platform-registry'
import { mockIpc } from '../../../../../.storybook/mock-ipc'
import { ConfigConfirmPrompt } from './ConfigConfirmPrompt'

// A custom provider speaking one OpenAI-compatible base for chat + image, so the structured fields have a
// real Platform/Plan/Endpoint to resolve against — the same lookup the dialog does at runtime.
const RELAY: Platform = {
  id: 'custom:relay',
  brand: 'custom',
  name: 'My Relay',
  plans: [
    {
      id: 'api',
      name: 'API',
      auth: 'api-key',
      endpoints: customPlatformEndpoints({ openai: ['chat', 'image'] }, 'https://relay.example.com').map((e) => ({
        ...e,
        defaults: { extraEnv: { ANTHROPIC_API_TIMEOUT_MS: '60000', KEEP_ME: '1' } },
      })),
    },
  ],
}

const RELAY_KEY: Credential = {
  id: 'cred-1',
  platformId: RELAY.id,
  planId: 'api',
  name: 'Personal Key',
  secret: '***abc123',
  notes: '',
  sortOrder: 0,
  overrides: {
    openai: {
      models: [
        { id: 'glm-4.5', name: 'GLM 4.5', tasks: ['chat'] },
        { id: 'seedream-4', name: 'Seedream 4', tasks: ['image'] },
      ],
    },
  },
}

const PLATFORM_CONTEXT = { platformId: RELAY.id, planId: 'api' }
const ENDPOINT_CONTEXT = { ...PLATFORM_CONTEXT, endpointId: 'openai', credentialId: RELAY_KEY.id }

function field(partial: Omit<ConfigConfirmField, 'domain'> & { domain?: string }): ConfigConfirmField {
  return { domain: 'custom-platform', ...partial }
}

function resourcePayload(
  operation: 'create' | 'update' | 'delete',
  fields: ConfigConfirmField[],
  overrides: Partial<ConfigConfirmPayload['resource']> = {},
): ConfigConfirmPayload {
  return {
    resource: {
      resource: 'custom-platform',
      operation,
      recordId: RELAY.id,
      title: 'My Relay',
      subtitle: 'custom',
      context: PLATFORM_CONTEXT,
      fields,
      ...overrides,
    } as NonNullable<ConfigConfirmPayload['resource']>,
  }
}

// The structured editors resolve their Platform/Plan/Endpoint through the settings store, which lazily
// fetches over IPC when it is empty. Mocking the IPC (rather than seeding the store) keeps that real path
// in play — the same one that runs when the dialog opens in a chat that never visited Settings.
mockIpc('app', 'listPlatforms', () => Promise.resolve([RELAY]))
mockIpc('app', 'listCredentials', () => Promise.resolve([RELAY_KEY]))
mockIpc('app', 'listBindings', () => Promise.resolve([]))

/**
 * Renders the prompt at the width of a chat panel. The confirm/reject argument is echoed below so the
 * payload the agent would receive back is visible while clicking through.
 */
function Harness({ payload }: { payload: ConfigConfirmPayload }) {
  const [result, setResult] = useState<string | null>(null)

  return (
    <div className="@container w-[560px]">
      <ConfigConfirmPrompt
        payload={payload}
        onConfirm={(values) => setResult(`confirm ${JSON.stringify(values)}`)}
        onReject={(feedback) => setResult(`reject "${feedback}"`)}
      />
      {result && <pre className="mx-3 rounded bg-muted/40 p-2 text-[10px] break-all whitespace-pre-wrap">{result}</pre>}
    </div>
  )
}

const meta: Meta<typeof Harness> = {
  title: 'Chat/ConfigConfirmPrompt',
  component: Harness,
  parameters: { layout: 'padded' },
}

export default meta
type Story = StoryObj<typeof Harness>

/** Plain app settings — no resource header, one editable control per row. */
export const AppSettings: Story = {
  args: {
    payload: {
      fields: [
        field({ domain: 'general', key: 'analyticsEnabled', label: 'Analytics', type: 'boolean', currentValue: true, proposedValue: false }),
        field({
          domain: 'general',
          key: 'updateChannel',
          label: 'Update Channel',
          type: 'enum',
          enumValues: ['alpha', 'beta', 'stable'],
          clearable: true,
          note: 'Clear to follow the channel this build shipped on.',
          currentValue: 'stable',
          proposedValue: 'beta',
        }),
        field({ domain: 'appearance', key: 'terminalFontSize', label: 'Terminal Font Size', type: 'number', min: 12, max: 22, currentValue: 14, proposedValue: 16 }),
        field({ domain: 'appearance', key: 'uiFontFamily', label: 'UI Font', type: 'string', clearable: true, currentValue: null, proposedValue: 'Inter' }),
        field({
          domain: 'appearance',
          key: 'terminalDarkPalette',
          label: 'Terminal Dark Palette',
          type: 'enum',
          enumValues: ['monokai-remastered', 'catppuccin-mocha', 'tokyo-night', 'dracula'],
          clearable: true,
          currentValue: null,
          proposedValue: 'dracula',
        }),
        field({
          domain: 'appearance',
          key: 'mermaidLightTheme',
          label: 'Mermaid Light Theme',
          type: 'enum',
          enumValues: ['default', 'forest', 'neutral', 'neo', 'redux', 'redux-color'],
          clearable: true,
          currentValue: null,
          proposedValue: 'forest',
        }),
      ],
    },
  },
}

/** The smallest useful change: one env var, merged key by key. The summary names only what moved. */
export const SingleEnvVar: Story = {
  args: {
    payload: resourcePayload('update', [
      field({
        key: 'extraEnv',
        label: 'Environment Variables',
        type: 'env',
        currentValue: { ANTHROPIC_API_TIMEOUT_MS: '60000', KEEP_ME: '1' },
        proposedValue: { ANTHROPIC_API_TIMEOUT_MS: '120000', KEEP_ME: '1' },
      }),
    ]),
  },
}

/** Claude-harness model slots, edited through the same id/name editor the settings page uses. */
export const ModelMapping: Story = {
  args: {
    payload: resourcePayload('update', [
      field({
        key: 'modelMapping',
        label: 'Model Mapping',
        type: 'model-mapping',
        currentValue: { opus: { id: 'glm-4.5', name: 'GLM 4.5' } },
        proposedValue: { opus: { id: 'glm-4.6', name: 'GLM 4.6' }, haiku: { id: 'glm-4.5-air' } },
      }),
    ]),
  },
}

/** Wire formats and capabilities as checkboxes — never as a hand-written endpoints array. */
export const Capabilities: Story = {
  args: {
    payload: resourcePayload('update', [
      field({
        key: 'capabilities',
        label: 'Formats & Capabilities',
        type: 'capabilities',
        currentValue: { families: ['openai'], tasks: { openai: ['chat', 'image'] }, extras: {} },
        proposedValue: { families: ['openai', 'anthropic'], tasks: { openai: ['chat', 'image', 'video'], anthropic: ['chat'] }, extras: { openai: ['openai-responses'] } },
      }),
    ]),
  },
}

/** A credential's enabled-model list for one endpoint. The endpoint id shows under the record title. */
export const EnabledModels: Story = {
  args: {
    payload: resourcePayload(
      'update',
      [
        field({
          domain: 'ai-provider',
          key: 'models',
          label: 'Enabled Models',
          type: 'models',
          context: ENDPOINT_CONTEXT,
          currentValue: [
            { id: 'glm-4.5', name: 'GLM 4.5', tasks: ['chat'] },
            { id: 'seedream-4', name: 'Seedream 4', tasks: ['image'] },
          ],
          proposedValue: [
            { id: 'glm-4.6', name: 'GLM 4.6', tasks: ['chat'] },
            { id: 'seedream-4', name: 'Seedream 4', tasks: ['image'] },
          ],
        }),
      ],
      { resource: 'ai-provider', recordId: RELAY_KEY.id, title: 'Personal Key', subtitle: 'custom:relay / api', context: ENDPOINT_CONTEXT },
    ),
  },
}

/** Creating a provider from scratch: everything the settings form asks for, in one confirmation. */
export const CreateProvider: Story = {
  args: {
    payload: resourcePayload(
      'create',
      [
        field({ key: 'name', label: 'Name', type: 'string', currentValue: null, proposedValue: 'My Relay' }),
        field({ key: 'baseUrl', label: 'Base URL', type: 'string', currentValue: null, proposedValue: 'https://relay.example.com' }),
        field({
          key: 'capabilities',
          label: 'Formats & Capabilities',
          type: 'capabilities',
          currentValue: null,
          proposedValue: { families: ['openai'], tasks: { openai: ['chat', 'image'] }, extras: {} },
        }),
        field({ key: 'extraEnv', label: 'Environment Variables', type: 'env', currentValue: null, proposedValue: { ANTHROPIC_API_TIMEOUT_MS: '600000' } }),
        field({ key: 'apiKey', label: 'API Key', type: 'string', secret: true, currentValue: null, proposedValue: 'sk-example-123456' }),
        field({ key: 'keyName', label: 'Key Label', type: 'string', currentValue: null, proposedValue: 'Personal Key' }),
      ],
      { recordId: undefined, title: 'My Relay', subtitle: undefined },
    ),
  },
}

/** Delete is identity-only — no field rows, destructive framing, and a red confirm button. */
export const DeleteProvider: Story = {
  args: {
    payload: resourcePayload('delete', [], { title: 'My Relay', subtitle: 'custom · 1 key' }),
  },
}

/** Several fields of mixed kinds at once — the layout switches per row between inline and full-width. */
export const MixedFields: Story = {
  args: {
    payload: resourcePayload('update', [
      field({ key: 'name', label: 'Name', type: 'string', currentValue: 'My Relay', proposedValue: 'Work Relay' }),
      field({ key: 'baseUrl', label: 'Base URL', type: 'string', currentValue: 'https://relay.example.com/v1', proposedValue: 'https://relay.internal/v1' }),
      field({
        key: 'capabilities',
        label: 'Formats & Capabilities',
        type: 'capabilities',
        currentValue: { families: ['openai'], tasks: { openai: ['chat'] }, extras: {} },
        proposedValue: { families: ['openai'], tasks: { openai: ['chat', 'image'] }, extras: {} },
      }),
      field({
        key: 'extraEnv',
        label: 'Environment Variables',
        type: 'env',
        currentValue: { KEEP_ME: '1' },
        proposedValue: { KEEP_ME: '1', ANTHROPIC_API_TIMEOUT_MS: '600000' },
      }),
    ]),
  },
}

/** The untyped escape hatch: `json` is the only type still edited as raw text. */
export const RawJsonFallback: Story = {
  args: {
    payload: resourcePayload('update', [
      field({
        key: 'schedule',
        label: 'Schedule',
        type: 'json',
        note: 'Only reached by fields with no dedicated editor.',
        currentValue: JSON.stringify({ type: 'recurring', preset: 'daily' }, null, 2),
        proposedValue: JSON.stringify({ type: 'recurring', preset: 'weekly', dayOfWeek: 1 }, null, 2),
      }),
    ]),
  },
}
