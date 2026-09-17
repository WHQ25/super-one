'use strict'

/**
 * Post-signing launch check for macOS bundles.
 *
 * `codesign --verify`, notarization and Gatekeeper all validate the signature
 * *structure*; none of them checks whether AMFI will actually honour the
 * entitlements at exec. A restricted entitlement without a matching embedded
 * provisioning profile passes every one of those and is then SIGKILLed by the
 * kernel as "completely unsigned" on first launch (0.67.0-alpha.2). The only
 * check that catches it is executing the signed binary, so do that here:
 * `ELECTRON_RUN_AS_NODE` turns the binary into a plain node process that exits
 * immediately, and the kernel's signature decision happens before any of it.
 *
 * Runs after notarization (electron-builder signs, notarizes, then emits
 * afterSign), so it checks the exact bytes that ship; a failure costs one
 * wasted notarization round, which is the right trade.
 */

const { spawnSync, execFileSync } = require('node:child_process')
const { readdirSync, existsSync } = require('node:fs')
const { join } = require('node:path')

const { isBridgeBuild } = require('./mac-signing.cjs')

const EXEC_TIMEOUT_MS = 60_000

// Entitlements AMFI only honours with an embedded.provisionprofile. Nested
// bundles never carry a profile, so they must never carry these either.
const RESTRICTED_ENTITLEMENTS = ['keychain-access-groups', 'com.apple.application-identifier']

// Standalone executables inside the bundle that are neither the main app nor
// an Electron helper, but whose death would be just as fatal: a rejected
// ShipIt means every future update fails silently.
const EXTRA_EXECUTABLES = [
  ['Squirrel.framework', 'Resources', 'ShipIt'],
  ['Electron Framework.framework', 'Helpers', 'chrome_crashpad_handler'],
]

function readEntitlementKeys(bundlePath) {
  const xml = execFileSync('/usr/bin/codesign', ['-d', '--entitlements', '-', '--xml', bundlePath], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  if (!xml.trim()) return []
  const json = execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', '-'], { input: xml, encoding: 'utf8' })
  return Object.keys(JSON.parse(json))
}

function readBundleIdentifier(bundlePath) {
  return execFileSync(
    '/usr/libexec/PlistBuddy',
    ['-c', 'Print CFBundleIdentifier', join(bundlePath, 'Contents', 'Info.plist')],
    { encoding: 'utf8' },
  ).trim()
}

function assertNoRestrictedKeys(bundlePath, label) {
  const restricted = readEntitlementKeys(bundlePath).filter((k) => RESTRICTED_ENTITLEMENTS.includes(k))
  if (restricted.length > 0) {
    throw new Error(`[afterSign] ${label} carries restricted entitlements (${restricted.join(', ')}) but can have no profile`)
  }
}

/**
 * Exec the binary; only an AMFI kill or an unexpected exit fails the build.
 * `args` are for Electron binaries (run as node); other executables are
 * launched bare and merely must not be SIGKILLed.
 */
function assertExecutes(label, executable, args, { expectCleanExit }) {
  const result = spawnSync(executable, args, {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8',
    timeout: EXEC_TIMEOUT_MS,
  })
  // A foreign-architecture slice on a host without Rosetta cannot be
  // executed at all; that says nothing about the signature.
  if (result.error && (result.error.code === 'EBADARCH' || result.error.code === 'ENOEXEC')) {
    console.warn(`[afterSign] ${label}: cannot execute on this host (${result.error.code}), skipping launch check`)
    return
  }
  // Hitting the timeout (spawnSync SIGTERMs the child) means the process
  // launched and ran, which is all this check is for: AMFI kills at exec,
  // long before. The x64 slice runs under Rosetta on an arm64 runner, where
  // first-run translation of the Electron framework alone can take this long.
  if (result.error && result.error.code === 'ETIMEDOUT') {
    console.warn(`[afterSign] ${label}: still running after ${EXEC_TIMEOUT_MS / 1000}s (Rosetta translation?); it launched, moving on`)
    return
  }
  if (result.signal === 'SIGKILL') {
    throw new Error(
      `[afterSign] ${label} was SIGKILLed at exec — AMFI rejected its code signature. ` +
        'Usually a restricted entitlement (keychain-access-groups, application-identifier) with no matching ' +
        'embedded.provisionprofile. Check `codesign -d --entitlements - --xml <bundle>` and ' +
        '`log show --predicate \'process == "kernel"\' | grep AMFI`.',
    )
  }
  if (expectCleanExit && result.status !== 0) {
    throw new Error(
      `[afterSign] ${label} did not exit cleanly under ELECTRON_RUN_AS_NODE ` +
        `(status=${result.status} signal=${result.signal})\n${result.stderr}`,
    )
  }
}

exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return

  const { productFilename, id: expectedBundleId } = context.packager.appInfo
  const appPath = join(context.appOutDir, `${productFilename}.app`)
  const mainExecutable = join(appPath, 'Contents', 'MacOS', productFilename)
  const frameworksDir = join(appPath, 'Contents', 'Frameworks')

  const bundleId = readBundleIdentifier(appPath)
  if (bundleId !== expectedBundleId) {
    throw new Error(`[afterSign] bundle id is ${bundleId}, expected ${expectedBundleId}`)
  }

  const profilePath = join(appPath, 'Contents', 'embedded.provisionprofile')
  const mainKeys = readEntitlementKeys(appPath)
  const mainRestricted = mainKeys.filter((k) => RESTRICTED_ENTITLEMENTS.includes(k))
  if (isBridgeBuild() && (mainRestricted.length > 0 || existsSync(profilePath))) {
    throw new Error('[afterSign] bridge build must carry neither restricted entitlements nor a profile')
  }
  // A developer machine may have the profile installed system-wide, which
  // would let the exec check below pass while every user's machine kills the
  // app; the structural check does not depend on the host.
  if (mainRestricted.length > 0 && !existsSync(profilePath)) {
    throw new Error(
      `[afterSign] main app carries restricted entitlements (${mainRestricted.join(', ')}) but no embedded.provisionprofile`,
    )
  }

  const nestedApps = readdirSync(frameworksDir).filter((name) => name.endsWith('.app'))
  for (const name of nestedApps) assertNoRestrictedKeys(join(frameworksDir, name), name)
  for (const parts of EXTRA_EXECUTABLES) {
    const executable = join(frameworksDir, ...parts)
    if (existsSync(executable)) assertNoRestrictedKeys(executable, parts.join('/'))
  }

  // Requires the RunAsNode fuse (on by default; no `electronFuses` config
  // disables it). Turning that fuse off would make this launch the GUI and
  // ride out the timeout as a pass — assert on the fuse first if that changes.
  assertExecutes(`${productFilename}.app`, mainExecutable, ['-e', 'process.exit(0)'], { expectCleanExit: true })
  for (const name of nestedApps.filter((n) => n.includes(' Helper'))) {
    const executable = join(frameworksDir, name, 'Contents', 'MacOS', name.slice(0, -'.app'.length))
    assertExecutes(name, executable, ['-e', 'process.exit(0)'], { expectCleanExit: true })
  }
  for (const parts of EXTRA_EXECUTABLES) {
    const executable = join(frameworksDir, ...parts)
    // ShipIt / crashpad exit non-zero without arguments; only the kill matters.
    if (existsSync(executable)) assertExecutes(parts.join('/'), executable, [], { expectCleanExit: false })
  }
  console.log(`[afterSign] launch check passed: ${productFilename}.app (${bundleId}) + ${nestedApps.length} nested bundles`)
}
