import { expect, test, jest } from '@jest/globals'
import { screen } from '@testing-library/react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import type { ReactElement } from 'react'
import type { Locale } from '@superone/shared/agent-types'
import { renderWithTheme } from '../test-render'
import { OtaUpdatePrompt, UpdatePrompt } from './update-prompt'
import { fakeAndroidManifest, fakeIosManifest } from '../preview/fake-update-ports'
import type { UpdateFlowActions, UpdateFlowState } from '../updates/use-update-check'

function actions(): UpdateFlowActions {
  return {
    check: jest.fn(),
    startDownload: jest.fn(),
    cancelDownload: jest.fn(),
    dismiss: jest.fn(),
    openTestFlight: jest.fn(),
    openUnknownSourcesSettings: jest.fn(),
  }
}

function state(overrides: Partial<UpdateFlowState> = {}): UpdateFlowState {
  return {
    verdict: 'optional',
    manifest: fakeAndroidManifest(),
    download: null,
    failure: null,
    checking: false,
    canSelfInstall: true,
    currentVersion: '1.0.0',
    currentBuildCode: 42,
    ...overrides,
  }
}

/**
 * The optional prompt renders through `PromptSheet`, which reads the status-bar
 * inset directly -- outside a provider that hook throws.
 */
function renderPrompt(ui: ReactElement, locale: Locale = 'en') {
  return renderWithTheme(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      {ui}
    </SafeAreaProvider>,
    'dark',
    locale,
  )
}

test('renders nothing when there is no update', async () => {
  await renderPrompt(<UpdatePrompt state={state({ verdict: 'none' })} actions={actions()} />)
  expect(screen.queryByText('Update available')).toBeNull()
  expect(screen.queryByTestId('update-gate')).toBeNull()
})

test('an optional update offers both builds, the size, and a way out', async () => {
  await renderPrompt(<UpdatePrompt state={state()} actions={actions()} />)
  expect(screen.getByText('Update available')).toBeTruthy()
  expect(screen.getByTestId('update-current-build')).toHaveTextContent('1.0.0 (42)')
  expect(screen.getByTestId('update-next-build')).toHaveTextContent('1.1.0 (48)')
  expect(screen.getByTestId('update-size')).toHaveTextContent('96 MB')
  expect(screen.getByText('Update now')).toBeTruthy()
  expect(screen.getByText('Later')).toBeTruthy()
})

test('a required update takes the whole screen and offers no way out', async () => {
  await renderPrompt(
    <UpdatePrompt state={state({ verdict: 'required', currentBuildCode: 29 })} actions={actions()} />,
  )
  expect(screen.getByTestId('update-gate')).toBeTruthy()
  // Dismissing a hard gate would defeat the only mechanism that stops an old
  // client from talking to a desktop it can no longer understand.
  expect(screen.queryByText('Later')).toBeNull()
})

test('a download in progress replaces the update action with cancel', async () => {
  await renderPrompt(
    <UpdatePrompt state={state({ download: { fraction: 0.46 } })} actions={actions()} />,
  )
  expect(screen.getByTestId('update-progress')).toHaveTextContent('46%')
  expect(screen.getByText('Cancel')).toBeTruthy()
  expect(screen.queryByText('Update now')).toBeNull()
  expect(screen.queryByText('Later')).toBeNull()
})

test('an unknown total shows a dash rather than a stuck 0%', async () => {
  await renderPrompt(
    <UpdatePrompt state={state({ download: { fraction: null } })} actions={actions()} />,
  )
  expect(screen.getByTestId('update-progress')).toHaveTextContent('—')
})

test('a failure explains itself and turns the action into a retry', async () => {
  await renderPrompt(<UpdatePrompt state={state({ failure: 'checksum' })} actions={actions()} />)
  expect(screen.getByTestId('update-failure')).toHaveTextContent(
    'The downloaded file did not match what the server published.',
  )
  // The `en` map is not identity: it applies the desktop's Title Case.
  expect(screen.getByText('Try Again')).toBeTruthy()
})

test('a blocked installer adds the settings escape beside the retry', async () => {
  await renderPrompt(
    <UpdatePrompt state={state({ failure: 'install-unavailable' })} actions={actions()} />,
  )
  // Android gives no way to query the per-source install permission, so the
  // only recovery we can offer is a shortcut to the toggle.
  expect(screen.getByText('Allow installs')).toBeTruthy()
  // The `en` map is not identity: it applies the desktop's Title Case.
  expect(screen.getByText('Try Again')).toBeTruthy()
})

test('iOS sends the user to TestFlight instead of downloading', async () => {
  await renderPrompt(
    <UpdatePrompt
      state={state({ manifest: fakeIosManifest(), canSelfInstall: false })}
      actions={actions()}
    />,
  )
  expect(screen.getByText('Open TestFlight')).toBeTruthy()
  expect(screen.queryByText('Update now')).toBeNull()
  // No artifact on iOS, so there is no size to promise.
  expect(screen.queryByTestId('update-size')).toBeNull()
})

test('translates the whole prompt', async () => {
  await renderPrompt(<UpdatePrompt state={state()} actions={actions()} />, 'zh')
  expect(screen.getByText('有可用更新')).toBeTruthy()
  expect(screen.getByText('立即更新')).toBeTruthy()
  expect(screen.getByText('稍后')).toBeTruthy()
  // Numbers stay outside the translation, so they read the same in both locales.
  expect(screen.getByTestId('update-next-build')).toHaveTextContent('1.1.0 (48)')
})

test('the OTA gate renders nothing until an update is known', async () => {
  await renderPrompt(<OtaUpdatePrompt view={{ phase: 'hidden' }} />)
  expect(screen.queryByTestId('ota-update-gate')).toBeNull()
})

test('the OTA gate shows progress and offers no controls', async () => {
  await renderPrompt(<OtaUpdatePrompt view={{ phase: 'downloading', fraction: 0.38 }} />)
  expect(screen.getByTestId('ota-update-gate')).toBeTruthy()
  expect(screen.getByText('Updating SuperOne')).toBeTruthy()
  expect(screen.getByTestId('ota-update-progress')).toHaveTextContent('38%')
  expect(screen.queryByRole('button')).toBeNull()
})

test('the OTA gate says it is restarting once the bundle is on disk', async () => {
  await renderPrompt(<OtaUpdatePrompt view={{ phase: 'restarting' }} />, 'zh')
  expect(screen.getByText('正在更新 SuperOne')).toBeTruthy()
  expect(screen.getByText('正在重启…')).toBeTruthy()
  expect(screen.getByTestId('ota-update-progress')).toHaveTextContent('100%')
})
