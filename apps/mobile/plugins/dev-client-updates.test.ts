import { describe, expect, it } from 'vitest'
import {
  disableUpdatesInDebugManifest,
  ensureFingerprintResourcesTaskInvalidWhenMissing,
  FINGERPRINT_GRADLE_MARKER,
  UPDATES_ENABLED_META_NAME,
} from './dev-client-updates'

const EXPO_DEBUG_MANIFEST = `<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:tools="http://schemas.android.com/tools">

    <uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW"/>

    <application android:usesCleartextTraffic="true" tools:targetApi="28" tools:ignore="GoogleAppIndexingWarning" tools:replace="android:usesCleartextTraffic" />
</manifest>
`

describe('disableUpdatesInDebugManifest', () => {
  it('overrides expo-updates ENABLED on the Expo debug manifest', () => {
    const next = disableUpdatesInDebugManifest(EXPO_DEBUG_MANIFEST)
    expect(next).toContain(`android:name="${UPDATES_ENABLED_META_NAME}"`)
    expect(next).toContain('android:value="false"')
    expect(next).toContain('tools:replace="android:value"')
    expect(next).toContain('xmlns:tools="http://schemas.android.com/tools"')
    expect(next).not.toMatch(/<application\b[^>]*\/>/)
  })

  it('is idempotent', () => {
    const once = disableUpdatesInDebugManifest(EXPO_DEBUG_MANIFEST)
    expect(disableUpdatesInDebugManifest(once)).toBe(once)
  })

  it('adds the tools xmlns and an application tag when they are missing', () => {
    const next = disableUpdatesInDebugManifest('<manifest>\n</manifest>\n')
    expect(next).toContain('xmlns:tools="http://schemas.android.com/tools"')
    expect(next).toContain(`android:name="${UPDATES_ENABLED_META_NAME}"`)
    expect(next).toContain('<application>')
  })
})

describe('ensureFingerprintResourcesTaskInvalidWhenMissing', () => {
  it('appends a Gradle hook that reruns when the fingerprint asset is missing', () => {
    const gradle = 'dependencies {\n    implementation("com.facebook.react:react-android")\n}\n'
    const next = ensureFingerprintResourcesTaskInvalidWhenMissing(gradle)
    expect(next).toContain(FINGERPRINT_GRADLE_MARKER)
    expect(next).toContain('create.*UpdatesResources')
    expect(next).toContain('fingerprint')
    expect(next).toContain('app.json')
  })

  it('is idempotent', () => {
    const once = ensureFingerprintResourcesTaskInvalidWhenMissing('android { }\n')
    expect(ensureFingerprintResourcesTaskInvalidWhenMissing(once)).toBe(once)
  })
})
