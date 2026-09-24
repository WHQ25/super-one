/** @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const getAppSettings = vi.fn()
const saveAppSettings = vi.fn()
const connectDeepseek = vi.fn()

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

const { DshSubagentModelsSettings, dshModelRoutes } = await import('./DshSubagentModelsSection')

const MODELS = [
  { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', description: 'deepseek-official', provider: 'deepseek-official' },
  { id: 'deepseek-flash', name: 'DeepSeek V4.1 Flash', description: 'deepseek-official', provider: 'deepseek-official' },
]

beforeEach(() => {
  vi.clearAllMocks()
  getAppSettings.mockResolvedValue({ dshSubagentModelSelection: { enabled: false, allowedModels: [] } })
  saveAppSettings.mockImplementation(async (patch: Record<string, unknown>) => patch)
  connectDeepseek.mockResolvedValue({ models: MODELS })
  Object.defineProperty(window, 'app', {
    configurable: true,
    value: { getAppSettings, saveAppSettings, connectDeepseek },
  })
})

describe('DshSubagentModelsSettings', () => {
  it('saves the switch and the allowed routes as one preference', async () => {
    const user = userEvent.setup()
    render(<DshSubagentModelsSettings />)
    await waitFor(() => expect(screen.getByRole('switch')).not.toBeDisabled())

    await user.click(screen.getByRole('switch'))
    await waitFor(() => expect(screen.getByLabelText(/DeepSeek V4.1 Flash/)).not.toBeDisabled())
    await user.click(screen.getByLabelText(/DeepSeek V4.1 Flash/))

    await waitFor(() => expect(saveAppSettings).toHaveBeenLastCalledWith({
      dshSubagentModelSelection: {
        enabled: true,
        allowedModels: [{ provider: 'deepseek-official', model: 'deepseek-flash' }],
      },
    }))
  })

  it('keeps the model list inert while the preference is off', async () => {
    render(<DshSubagentModelsSettings />)

    await waitFor(() => expect(screen.getByLabelText(/DeepSeek V4 Pro/)).toBeInTheDocument())
    expect(screen.getByLabelText(/DeepSeek V4 Pro/)).toBeDisabled()
  })

  it('warns when the preference is on but no model is allowed', async () => {
    getAppSettings.mockResolvedValue({ dshSubagentModelSelection: { enabled: true, allowedModels: [] } })
    render(<DshSubagentModelsSettings />)

    expect(await screen.findByText('settings.preferences.dshSubagentModels.noneSelected')).toBeInTheDocument()
  })

  it('says so when the DeepSeek catalog is unavailable', async () => {
    connectDeepseek.mockRejectedValue(new Error('no key'))
    render(<DshSubagentModelsSettings />)

    expect(await screen.findByText('settings.preferences.dshSubagentModels.empty')).toBeInTheDocument()
  })
})

describe('dshModelRoutes', () => {
  it('keeps only models that name the provider they route through', () => {
    expect(dshModelRoutes([...MODELS, { id: 'x', name: 'X', description: '' }]).map((route) => route.model))
      .toEqual(['deepseek-v4-pro', 'deepseek-flash'])
  })
})
