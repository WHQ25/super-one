import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getPrebuildConfigAsync } from '@expo/prebuild-config'
import { compileModsAsync } from '@expo/config-plugins'
import { expect, it } from 'vitest'

it('keeps microphone permission through the complete Expo plugin chain on both platforms', async () => {
  // A fresh root represents EAS/clean prebuild; stale ignored native trees must
  // not supply the result. Introspection never writes native build files.
  const root = await mkdtemp(join(tmpdir(), 'superone-voice-config-'))
  try {
    const { exp } = await getPrebuildConfigAsync(fileURLToPath(new URL('../', import.meta.url)), { platforms: ['ios', 'android'] })
    const config = await compileModsAsync(exp, { projectRoot: root, introspect: true,
      platforms: ['ios', 'android'], assertMissingModProviders: false })
    const results = config._internal!.modResults as {
      android: { manifest: { manifest: { 'uses-permission': Array<{ $: Record<string, string> }> } } }
      ios: { infoPlist: { NSMicrophoneUsageDescription?: string } }
    }
    const microphone = results.android.manifest.manifest['uses-permission']
      .filter(entry => entry.$['android:name'] === 'android.permission.RECORD_AUDIO')
    expect(microphone).toEqual([{ $: { 'android:name': 'android.permission.RECORD_AUDIO' } }])
    expect(results.ios.infoPlist.NSMicrophoneUsageDescription).toBeTruthy()
  } finally { await rm(root, { recursive: true, force: true }) }
})
