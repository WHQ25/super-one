'use strict'

/**
 * Android adaptive icons are 108dp; launchers mask to the inner ~72dp, which
 * trims 16% on each side. Flutter's `adaptive_icon_foreground_inset: 16` puts
 * the artwork in that safe zone. Expo writes a full-bleed foreground with no
 * inset, so SUPER/ONE get cropped and look oversized on the home screen.
 */

const { existsSync, readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const ADAPTIVE_ICON_INSET = '16%'
const ADAPTIVE_ICON_XML = ['ic_launcher.xml', 'ic_launcher_round.xml']

const FOREGROUND_FLAT =
  /<foreground android:drawable="([^"]+)"\s*\/>/
const FOREGROUND_INSET =
  /(<foreground>\s*<inset\b[\s\S]*?android:inset=")([^"]*)(")/

function applyAdaptiveIconInset(xml, inset = ADAPTIVE_ICON_INSET) {
  if (!xml.includes('<adaptive-icon')) return xml
  if (FOREGROUND_INSET.test(xml)) {
    return xml.replace(FOREGROUND_INSET, `$1${inset}$3`)
  }
  if (!FOREGROUND_FLAT.test(xml)) return xml
  return xml.replace(
    FOREGROUND_FLAT,
    `<foreground>\n        <inset\n            android:drawable="$1"\n            android:inset="${inset}" />\n    </foreground>`,
  )
}

function applyAdaptiveIconInsetToRes(resDir, inset = ADAPTIVE_ICON_INSET) {
  const dir = join(resDir, 'mipmap-anydpi-v26')
  if (!existsSync(dir)) return []
  const written = []
  for (const name of ADAPTIVE_ICON_XML) {
    if (!existsSync(join(dir, name))) continue
    const path = join(dir, name)
    const current = readFileSync(path, 'utf8')
    const next = applyAdaptiveIconInset(current, inset)
    if (next !== current) {
      writeFileSync(path, next)
      written.push(path)
    }
  }
  return written
}

module.exports = {
  ADAPTIVE_ICON_INSET,
  ADAPTIVE_ICON_XML,
  applyAdaptiveIconInset,
  applyAdaptiveIconInsetToRes,
}
