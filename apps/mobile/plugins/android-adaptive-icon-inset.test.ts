import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ADAPTIVE_ICON_INSET,
  applyAdaptiveIconInset,
  applyAdaptiveIconInsetToRes,
} from './android-adaptive-icon-inset'

const EXPO_XML = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/iconBackground"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>`

const INSET_XML = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/iconBackground"/>
    <foreground>
        <inset
            android:drawable="@mipmap/ic_launcher_foreground"
            android:inset="16%" />
    </foreground>
</adaptive-icon>`

describe('applyAdaptiveIconInset', () => {
  it('wraps Expo’s full-bleed foreground in a 16% inset', () => {
    expect(applyAdaptiveIconInset(EXPO_XML)).toBe(INSET_XML)
  })

  it('is idempotent', () => {
    const once = applyAdaptiveIconInset(EXPO_XML)
    expect(applyAdaptiveIconInset(once)).toBe(once)
  })

  it('rewrites an existing inset to the Flutter safe-zone value', () => {
    const tight = INSET_XML.replace('16%', '8%')
    expect(applyAdaptiveIconInset(tight)).toBe(INSET_XML)
  })

  it('leaves non-adaptive XML alone', () => {
    const other = '<layer-list xmlns:android="http://schemas.android.com/apk/res/android"/>'
    expect(applyAdaptiveIconInset(other)).toBe(other)
  })

  it('keeps a monochrome layer when Expo emits one', () => {
    const withMono = EXPO_XML.replace(
      '</adaptive-icon>',
      '    <monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>\n</adaptive-icon>',
    )
    const next = applyAdaptiveIconInset(withMono)
    expect(next).toContain(`android:inset="${ADAPTIVE_ICON_INSET}"`)
    expect(next).toContain('ic_launcher_monochrome')
  })
})

describe('applyAdaptiveIconInsetToRes', () => {
  it('patches both anydpi launcher XML files', () => {
    const root = mkdtempSync(join(tmpdir(), 'adaptive-icon-'))
    const dir = join(root, 'mipmap-anydpi-v26')
    mkdirSync(dir)
    writeFileSync(join(dir, 'ic_launcher.xml'), EXPO_XML)
    writeFileSync(join(dir, 'ic_launcher_round.xml'), EXPO_XML)
    applyAdaptiveIconInsetToRes(root)
    expect(readFileSync(join(dir, 'ic_launcher.xml'), 'utf8')).toBe(INSET_XML)
    expect(readFileSync(join(dir, 'ic_launcher_round.xml'), 'utf8')).toBe(INSET_XML)
  })
})
