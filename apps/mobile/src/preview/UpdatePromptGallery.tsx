import { useMemo, useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { Text } from '../ui/text'
import { OtaUpdatePrompt, UpdatePrompt } from '../ui/update-prompt'
import { useMobileTheme } from '../theme/context'
import type { OtaView } from '../updates/ota-update-state'
import type { UpdateFlowActions, UpdateFlowState } from '../updates/use-update-check'
import { fakeAndroidManifest, fakeIosManifest } from './fake-update-ports'

/**
 * Every update state the shell can reach, on demand.
 *
 * These are the states a healthy install never shows -- a hard gate, a failed
 * checksum, an installer Android refused to open -- so reproducing them by
 * hand would mean publishing a broken manifest on purpose.
 */

type Scenario =
  | { id: string; label: string; state: UpdateFlowState }
  | { id: string; label: string; ota: OtaView }

const ANDROID = fakeAndroidManifest()
const IOS = fakeIosManifest()

const BASE = {
  download: null,
  failure: null,
  checking: false,
  canSelfInstall: true,
  currentVersion: '1.0.0',
  currentBuildCode: 42,
} satisfies Omit<UpdateFlowState, 'verdict' | 'manifest'>

const SCENARIOS: Scenario[] = [
  {
    id: 'optional',
    label: 'Optional · dismissible sheet',
    state: { ...BASE, verdict: 'optional', manifest: ANDROID },
  },
  {
    id: 'downloading',
    label: 'Downloading · 46%',
    state: { ...BASE, verdict: 'optional', manifest: ANDROID, download: { fraction: 0.46 } },
  },
  {
    id: 'downloading-unknown',
    label: 'Downloading · no Content-Length',
    state: { ...BASE, verdict: 'optional', manifest: ANDROID, download: { fraction: null } },
  },
  {
    id: 'network',
    label: 'Failed · network',
    state: { ...BASE, verdict: 'optional', manifest: ANDROID, failure: 'network' },
  },
  {
    id: 'checksum',
    label: 'Failed · checksum',
    state: { ...BASE, verdict: 'optional', manifest: ANDROID, failure: 'checksum' },
  },
  {
    id: 'disk-space',
    label: 'Refused · disk space',
    state: { ...BASE, verdict: 'optional', manifest: ANDROID, failure: 'disk-space' },
  },
  {
    id: 'install-unavailable',
    label: 'Failed · installer blocked',
    state: { ...BASE, verdict: 'optional', manifest: ANDROID, failure: 'install-unavailable' },
  },
  {
    id: 'required',
    label: 'Required · hard gate',
    state: { ...BASE, verdict: 'required', manifest: ANDROID, currentBuildCode: 29 },
  },
  {
    id: 'required-downloading',
    label: 'Required · downloading, no way out',
    state: {
      ...BASE,
      verdict: 'required',
      manifest: ANDROID,
      currentBuildCode: 29,
      download: { fraction: 0.72 },
    },
  },
  {
    id: 'ios-optional',
    label: 'iOS · sends you to TestFlight',
    state: { ...BASE, verdict: 'optional', manifest: IOS, canSelfInstall: false },
  },
  {
    id: 'ios-required',
    label: 'iOS · hard gate, TestFlight only',
    state: {
      ...BASE,
      verdict: 'required',
      manifest: IOS,
      canSelfInstall: false,
      currentBuildCode: 29,
    },
  },
  {
    id: 'ota-downloading',
    label: 'OTA · downloading 38%, nothing to press',
    ota: { phase: 'downloading', fraction: 0.38 },
  },
  {
    id: 'ota-starting',
    label: 'OTA · found, bytes not moving yet',
    ota: { phase: 'downloading', fraction: 0 },
  },
  {
    id: 'ota-restarting',
    label: 'OTA · on disk, restarting',
    ota: { phase: 'restarting' },
  },
]

export function UpdatePromptGallery() {
  const { tokens: { colors, spacing, radius } } = useMobileTheme()
  const [selected, setSelected] = useState(SCENARIOS[0])
  const [lastAction, setLastAction] = useState<string>('—')

  const actions = useMemo<UpdateFlowActions>(
    () => ({
      check: () => setLastAction('check'),
      startDownload: () => setLastAction('startDownload'),
      cancelDownload: () => setLastAction('cancelDownload'),
      dismiss: () => setLastAction('dismiss'),
      openTestFlight: () => setLastAction('openTestFlight'),
      openUnknownSourcesSettings: () => setLastAction('openUnknownSourcesSettings'),
    }),
    [],
  )

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        contentContainerStyle={{ padding: spacing.md, gap: spacing.sm }}
        style={{ maxHeight: 260 }}
      >
        {SCENARIOS.map((scenario) => (
          <Pressable
            key={scenario.id}
            testID={`update-scenario-${scenario.id}`}
            onPress={() => setSelected(scenario)}
            style={{
              padding: spacing.sm,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: scenario.id === selected.id ? colors.primary : colors.border,
            }}
          >
            <Text style={{ color: colors.foreground, fontSize: 13 }}>{scenario.label}</Text>
          </Pressable>
        ))}
        <Text testID="preview-last-action" style={{ color: colors.mutedForeground, fontSize: 12 }}>
          {lastAction}
        </Text>
      </ScrollView>
      {'ota' in selected
        ? <OtaUpdatePrompt view={selected.ota} />
        : <UpdatePrompt state={selected.state} actions={actions} />}
    </View>
  )
}
