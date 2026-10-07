import { expect, test } from '@jest/globals'
import { act, renderHook } from '@testing-library/react-native'
import type { ReactNode } from 'react'
import type { RemoteSystemInfo } from '@superone/shared/agent-types'
import { MobileThemeProvider } from '../theme/context'
import { useHarnessSelection } from './use-harness-selection'

const wrapper = ({ children }: { children: ReactNode }) =>
  <MobileThemeProvider>{children}</MobileThemeProvider>

const claude: RemoteSystemInfo = {
  models: [
    { id: 'opus', name: 'Opus', description: '', supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
    { id: 'haiku', name: 'Haiku', description: '', supportedEffortLevels: ['low', 'medium', 'high'] },
  ],
  defaults: { model: 'opus', effort: 'high' },
}

async function mount(info: RemoteSystemInfo = claude) {
  const hook = await renderHook(() => useHarnessSelection(), { wrapper })
  await act(async () => { hook.result.current.applySystemInfo('claude', info) })
  return hook
}

const ultracodeRow = (params: Array<{ id: string; selected: string }>) => params.find((param) => param.id === 'ultracode')

test('offers Ultracode on a model with xhigh effort, and a flip is what the next send carries', async () => {
  const { result } = await mount()
  expect(ultracodeRow(result.current.optionParams)).toMatchObject({ selected: 'false', description: expect.any(String) })
  expect(result.current.ultracodePick).toBeNull()

  await act(async () => { result.current.setOptionParam('ultracode', 'true') })

  expect(result.current.ultracode).toBe(true)
  expect(result.current.ultracodePick).toBe(true)
  expect(ultracodeRow(result.current.optionParams)?.selected).toBe('true')
})

test('follows the host\'s Ultracode without claiming it, so a send leaves it alone', async () => {
  const { result } = await mount()

  await act(async () => { result.current.setHostUltracode(true) })

  expect(result.current.ultracode).toBe(true)
  expect(result.current.ultracodePick).toBeNull()
})

test('turns Ultracode off on a model that cannot run it', async () => {
  const { result } = await mount()
  await act(async () => { result.current.setHostUltracode(true) })

  await act(async () => { result.current.selectModel('haiku') })

  expect(ultracodeRow(result.current.optionParams)).toBeUndefined()
  expect(result.current.ultracode).toBe(false)
  expect(result.current.ultracodePick).toBe(false)
})

test('hides Ultracode under a mapped credential, as the desktop does', async () => {
  const { result } = await mount({
    ...claude,
    activeProvider: { id: 'kimi', name: 'Kimi', presetKey: null, modelEnv: { default: { id: 'kimi-k2' } }, forcedEffort: null },
  })
  expect(ultracodeRow(result.current.optionParams)).toBeUndefined()
})

test('opening another session drops this phone\'s pick for that session\'s own', async () => {
  const { result } = await mount()
  await act(async () => { result.current.setOptionParam('ultracode', 'true') })

  await act(async () => { result.current.applySystemInfo('claude', claude, { model: 'opus', effort: 'high' }) })

  expect(result.current.ultracodePick).toBeNull()
})
