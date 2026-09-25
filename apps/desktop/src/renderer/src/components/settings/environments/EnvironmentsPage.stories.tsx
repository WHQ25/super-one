import type { Meta, StoryObj } from '@storybook/react-vite'
import type { EnvironmentListItem } from '@superone/shared/environment'
import { EnvironmentsPage } from './EnvironmentsPage'
import { ENVIRONMENT_ITEMS, mockEnvironmentApi } from './story-fixtures'

type Params = { items?: EnvironmentListItem[] | null; labReachable?: boolean; width?: number }

/**
 * "Control other devices" body as it sits under Settings → Remote Control. One section per
 * channel; each device is a card row. The dev-only Local lab section shows in `storybook dev`.
 */
const meta: Meta<typeof EnvironmentsPage> = {
  title: 'Settings/Remote/Environments',
  component: EnvironmentsPage,
  parameters: { layout: 'padded' },
  beforeEach: ({ parameters }) => {
    const { items = ENVIRONMENT_ITEMS, labReachable } = parameters as Params
    return mockEnvironmentApi(items, { labReachable })
  },
  decorators: [
    (Story, { parameters }) => (
      <div className="mx-auto max-w-3xl" style={{ width: (parameters as Params).width }}>
        <Story />
      </div>
    ),
  ],
}

export default meta
type Story = StoryObj<typeof EnvironmentsPage>

export const Loading: Story = { parameters: { items: null } }

export const Empty: Story = { parameters: { items: [] } }

/** Connected (with its harness list), outdated node, backoff, auth-blocked and identity-conflict rows. */
export const Populated: Story = {}

export const LabOnline: Story = { parameters: { items: ENVIRONMENT_ITEMS.slice(0, 1), labReachable: true } }

export const Narrow: Story = { parameters: { width: 460 } }
