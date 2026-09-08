import { expect, it, jest } from '@jest/globals'
import type { RemoteHarnessOption } from '@superone/shared/agent-types'
import { renderWithTheme } from '../test-render'
import { HarnessIcon } from '../ui'
import { NewSessionLanding } from './new-session-landing'

jest.mock('../ui', () => ({
  HarnessIcon: jest.fn(() => null),
  HarnessTabs: () => null,
  ProjectSelect: () => null,
  GitChips: () => null,
  ProviderBrand: () => null,
}))

const options: RemoteHarnessOption[] = [
  { key: 'claude', provider: 'claude', acpAgentId: null, label: 'Claude Code' },
  { key: 'acp:grok-build', provider: 'acp', acpAgentId: 'grok-build', label: 'Grok Build' },
  { key: 'acp:opencode', provider: 'acp', acpAgentId: 'opencode', label: 'OpenCode' },
  { key: 'acp:custom', provider: 'acp', acpAgentId: 'custom', label: 'Custom agent' },
]

it.each(options)('passes the selected $label identity to the landing icon', async (option) => {
  jest.mocked(HarnessIcon).mockClear()
  await renderWithTheme(<NewSessionLanding
    provider={option.provider}
    harnessOptions={options}
    activeHarnessKey={option.key}
    onHarness={jest.fn()}
    onOpenProject={jest.fn()}
    worktreeSelection={{ kind: 'local' }}
    onWorktree={jest.fn()}
    onBranch={jest.fn()}
  />)
  expect(HarnessIcon).toHaveBeenCalledWith(expect.objectContaining({
    provider: option.provider,
    acpAgentId: option.acpAgentId,
    renderLevel: 'rich',
  }), undefined)
})
