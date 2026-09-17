'use strict'

/**
 * macOS bundle identity + entitlements for one build.
 *
 * `build/entitlements.mac.plist` carries only unrestricted hardened-runtime
 * keys and signs every nested helper. The built-in browser's Touch ID passkeys
 * (src/main/browser/browser-webauthn.ts) additionally need
 * `keychain-access-groups`, which is a *restricted* entitlement: AMFI only
 * honours it when the bundle embeds a provisioning profile granting it, and
 * with no profile it throws the whole signature away at exec — the app is
 * SIGKILLed as "completely unsigned" while `codesign --verify`, notarization
 * and Gatekeeper all still pass. 0.67.0-alpha.2 shipped exactly that.
 *
 * So the restricted keys are templated here, for the main app only, and only
 * when a Developer ID profile for the variant's `macAppId` is supplied via
 * SUPERONE_MAC_PROVISIONING_PROFILE. Without one (contributor builds, ad-hoc
 * dev bundles) the main app keeps the shared unrestricted file: it launches,
 * passkeys are simply unavailable. Nothing team-specific lives in the repo —
 * the team id, keychain group and designated requirement all derive from the
 * profile at build time, so a fork signs with its own profile untouched.
 *
 * `SUPERONE_MAC_BRIDGE=1` packages the *legacy* bundle id instead. That build
 * exists only to be the last Squirrel-installable version for users still on
 * the old id (see docs/agent-reference/packaging.md, "bundle id migration");
 * it never carries restricted keys, because no profile can exist for an id we
 * do not own.
 */

const { execFileSync, spawnSync } = require('node:child_process')
const { copyFileSync, mkdirSync, writeFileSync } = require('node:fs')
const { isAbsolute, join, resolve } = require('node:path')

const PROFILE_ENV = 'SUPERONE_MAC_PROVISIONING_PROFILE'
const BRIDGE_ENV = 'SUPERONE_MAC_BRIDGE'

// Team-agnostic suffix; the team prefix comes from the profile. The packaged
// app reads the full group back from package.json (`macKeychainAccessGroup`).
const WEBAUTHN_KEYCHAIN_GROUP_SUFFIX = 'com.superone.app.webauthn'

// Update-manifest name for builds under the new bundle id. Squirrel.Mac
// verifies a downloaded bundle against the *running* app's designated
// requirement, which names the old identifier, so old-id clients must never be
// offered a new-id zip: they keep polling `latest-mac.yml`, which freezes at
// the bridge build, while new-id clients poll `desktop-mac.yml`.
const MAC_UPDATE_CHANNEL = 'desktop'
const LEGACY_MAC_UPDATE_CHANNEL = 'latest'

function isBridgeBuild() {
  return process.env[BRIDGE_ENV] === '1'
}

function plutil(args, input) {
  const result = spawnSync('/usr/bin/plutil', args, { input, encoding: 'utf8' })
  return result.status === 0 ? result.stdout.trim() : null
}

// Profiles carry <data> and <date> members, which plutil refuses to render as
// JSON wholesale, so pull the handful of keys out individually.
function readProfile(profilePath) {
  const xml = execFileSync('/usr/bin/security', ['cms', '-D', '-i', profilePath], { encoding: 'utf8' })
  const extract = (keyPath, format) => plutil(['-extract', keyPath, format, '-o', '-', '-'], xml)
  const groups = extract('Entitlements.keychain-access-groups', 'json')
  return {
    name: extract('Name', 'raw'),
    provisionsAllDevices: extract('ProvisionsAllDevices', 'raw') === 'true',
    expirationDate: extract('ExpirationDate', 'raw'),
    teamId: extract('Entitlements.com\\.apple\\.developer\\.team-identifier', 'raw'),
    applicationIdentifier: extract('Entitlements.com\\.apple\\.application-identifier', 'raw'),
    keychainAccessGroups: groups ? JSON.parse(groups) : [],
  }
}

/** `T.com.foo.*` and `T.*` style grants cover any suffix under them. */
function grantCovers(granted, wanted) {
  return granted === wanted || (granted.endsWith('*') && wanted.startsWith(granted.slice(0, -1)))
}

function validateProfile(profile, profilePath, applicationIdentifier, keychainGroup, variantId) {
  if (!profile.provisionsAllDevices) {
    throw new Error(`[mac-signing] ${profilePath} is not a Developer ID profile (ProvisionsAllDevices missing)`)
  }
  if (!profile.expirationDate || new Date(profile.expirationDate).getTime() <= Date.now()) {
    throw new Error(`[mac-signing] ${profilePath} expired on ${profile.expirationDate}`)
  }
  if (!profile.teamId || !profile.applicationIdentifier) {
    throw new Error(`[mac-signing] ${profilePath} has no team / application identifier entitlements`)
  }
  if (!grantCovers(profile.applicationIdentifier, applicationIdentifier)) {
    throw new Error(
      `[mac-signing] ${profilePath} is for "${profile.applicationIdentifier}", ` +
        `but variant "${variantId}" needs "${applicationIdentifier}"`,
    )
  }
  if (!profile.keychainAccessGroups.some((g) => grantCovers(g, keychainGroup))) {
    throw new Error(
      `[mac-signing] ${profilePath} does not grant keychain-access-group "${keychainGroup}" ` +
        `(grants: ${profile.keychainAccessGroups.join(', ') || 'none'})`,
    )
  }
}

/**
 * Main-app entitlements = the shared file + the restricted keys. Copying the
 * file and inserting with plutil keeps every existing value's type intact.
 */
function writeMainEntitlements(baseEntitlementsPath, outPath, { applicationIdentifier, teamId, keychainGroup }) {
  copyFileSync(baseEntitlementsPath, outPath)
  const insert = (key, type, value) =>
    execFileSync('/usr/bin/plutil', ['-insert', key.replace(/\./g, '\\.'), `-${type}`, value, outPath])
  insert('com.apple.application-identifier', 'string', applicationIdentifier)
  insert('com.apple.developer.team-identifier', 'string', teamId)
  insert('keychain-access-groups', 'json', JSON.stringify([keychainGroup]))
}

/**
 * Designated requirement without the `identifier` clause. Squirrel.Mac checks
 * an update against the running app's DR, so with the stock DR any future
 * bundle-id change strands every installed client again (the whole reason the
 * bridge build exists). Trusting the team instead still accepts only bundles
 * signed by this Developer ID.
 */
function writeRequirements(outPath, teamId) {
  writeFileSync(
    outPath,
    `designated => anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] ` +
      `and certificate leaf[field.1.2.840.113635.100.6.1.13] and certificate leaf[subject.OU] = "${teamId}"\n`,
  )
}

/**
 * @param {{
 *   variant: { macAppId: string, legacyMacAppId: string, downloadPrefix: string | null },
 *   variantId: string,
 *   appRoot: string,
 *   baseEntitlements: string,
 *   generatedDir: string,
 * }} opts
 * @returns {{
 *   appId: string,
 *   bridge: boolean,
 *   publishChannel: string,
 *   entitlements: string | null,
 *   provisioningProfile: string | null,
 *   requirements: string | null,
 *   keychainAccessGroup: string | null,
 * }}
 */
function resolveMacSigning({ variant, variantId, appRoot, baseEntitlements, generatedDir }) {
  const bridge = isBridgeBuild()
  const profileEnv = process.env[PROFILE_ENV]
  const unrestricted = {
    appId: bridge ? variant.legacyMacAppId : variant.macAppId,
    bridge,
    publishChannel: bridge ? LEGACY_MAC_UPDATE_CHANNEL : MAC_UPDATE_CHANNEL,
    entitlements: null,
    provisioningProfile: null,
    requirements: null,
    keychainAccessGroup: null,
  }

  if (bridge) {
    if (profileEnv) console.warn(`[mac-signing] ${PROFILE_ENV} ignored: bridge builds never carry restricted entitlements`)
    console.log(`[mac-signing] ${variantId}: bridge build under legacy id ${unrestricted.appId}`)
    return unrestricted
  }
  if (!profileEnv) {
    console.warn(
      `[mac-signing] ${PROFILE_ENV} not set — main app signs with unrestricted entitlements only; ` +
        'browser passkeys (keychain-access-groups) will be unavailable in this build',
    )
    return unrestricted
  }

  const profilePath = isAbsolute(profileEnv) ? profileEnv : resolve(appRoot, profileEnv)
  const profile = readProfile(profilePath)
  const applicationIdentifier = `${profile.teamId}.${variant.macAppId}`
  const keychainGroup = `${profile.teamId}.${WEBAUTHN_KEYCHAIN_GROUP_SUFFIX}`
  validateProfile(profile, profilePath, applicationIdentifier, keychainGroup, variantId)

  mkdirSync(generatedDir, { recursive: true })
  const entitlements = join(generatedDir, `entitlements.${variantId}.plist`)
  const requirements = join(generatedDir, `requirements.${variantId}.txt`)
  writeMainEntitlements(resolve(appRoot, baseEntitlements), entitlements, {
    applicationIdentifier,
    teamId: profile.teamId,
    keychainGroup,
  })
  writeRequirements(requirements, profile.teamId)
  console.log(`[mac-signing] ${variantId}: ${variant.macAppId} with profile "${profile.name}" (team ${profile.teamId})`)
  return {
    ...unrestricted,
    entitlements,
    provisioningProfile: profilePath,
    requirements,
    keychainAccessGroup: keychainGroup,
  }
}

module.exports = {
  resolveMacSigning,
  isBridgeBuild,
  PROFILE_ENV,
  BRIDGE_ENV,
  MAC_UPDATE_CHANNEL,
  LEGACY_MAC_UPDATE_CHANNEL,
  WEBAUTHN_KEYCHAIN_GROUP_SUFFIX,
}
