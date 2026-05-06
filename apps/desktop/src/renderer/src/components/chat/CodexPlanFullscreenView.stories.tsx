import type { Meta, StoryObj } from '@storybook/react-vite'
import { CodexPlanFullscreenView } from './CodexPlanFullscreenView'

const meta: Meta<typeof CodexPlanFullscreenView> = {
  title: 'Codex/CodexPlanFullscreenView',
  component: CodexPlanFullscreenView,
  parameters: { layout: 'fullscreen' },
}

export default meta
type Story = StoryObj<typeof CodexPlanFullscreenView>

const PLAN_TEXT = [
  '# Plan: ship per-session ownership refactor',
  '',
  '## Why',
  '',
  '- Two mobile clients on the same channel currently cross-talk.',
  '- Lock checks duplicated across IPC handlers.',
  '- Single source of truth makes audit trivial.',
  '',
  '## Steps',
  '',
  '1. Add `owner: { kind: "local" } | { kind: "remote", deviceId }` to `Session`.',
  '2. Move `claim` / `release` / `subscribe` / `unsubscribe` onto `Session`.',
  '3. Centralize disconnect cleanup in `device-registry.ts`.',
  '4. Add integration tests covering the locked-send rejection.',
  '5. Update relay protocol so each mobile WS is tagged with its `mobileDeviceId`.',
  '',
  '## Sketch',
  '',
  '```ts',
  'class Session {',
  '  owner: Owner = { kind: "local" }',
  '  subscribers = new Set<string>()',
  '',
  '  send(text: string, origin: Origin) {',
  '    if (origin === "local" && this.isRemotelyControlled()) {',
  '      throw new SessionLockedError()',
  '    }',
  '    // …',
  '  }',
  '}',
  '```',
  '',
  '## Trade-offs',
  '',
  '| Option | Pro | Con |',
  '| ------ | --- | --- |',
  '| Per-session ownership | encapsulated, easy to reason about | every session pays a tiny memory cost |',
  '| Global registry | single map, easy to inspect | lock checks scattered, race-prone |',
  '',
  '---',
  '',
  'See also `super-one-relay` for the protocol side.',
].join('\n')

export const ReadOnly: Story = {
  args: {
    text: PLAN_TEXT,
    onClose: () => {},
  },
}

export const WithApproveReject: Story = {
  args: {
    text: PLAN_TEXT,
    onClose: () => {},
    onApprovePlan: () => {},
    onRejectPlan: () => {},
  },
}

export const Approved: Story = {
  args: {
    text: PLAN_TEXT,
    onClose: () => {},
    onApprovePlan: () => {},
    onRejectPlan: () => {},
    planApproval: { status: 'approved' },
  },
}

export const Rejected: Story = {
  args: {
    text: PLAN_TEXT,
    onClose: () => {},
    onApprovePlan: () => {},
    onRejectPlan: () => {},
    planApproval: {
      status: 'rejected',
      feedback: 'Step 4 needs to be a separate PR — too much surface area to review in one go.',
    },
  },
}
