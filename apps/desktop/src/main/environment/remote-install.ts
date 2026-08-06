import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import {
  PUBLIC_CLI_BIN,
  PUBLIC_CLI_PACKAGE,
  type RemoteInstallSource,
} from '@superone/shared/environment'
import { shellQuote } from './ssh-bootstrap'
import { sshCapture, sshUpload } from './ssh-forward'

/**
 * Discovering and installing a node on a remote host over SSH.
 *
 * SSH is only a bootstrap channel (design §15): registry install of
 * `@super-one/cli` is the product default; local tarball upload is for
 * dev/debug. Once the node is running, product traffic uses the authenticated
 * RPC protocol instead.
 */

/** Minimum Node major the distribution bundle targets. */
export const MIN_REMOTE_NODE_MAJOR = 20

export { PUBLIC_CLI_BIN, PUBLIC_CLI_PACKAGE }
export type { RemoteInstallSource }

export interface RemoteHostProbe {
  os: 'linux' | 'darwin' | 'unknown'
  arch: 'x64' | 'arm64' | 'unknown'
  /** True when the C library is musl (Alpine), which needs a different prebuild. */
  musl: boolean
  home: string
  /** Absolute path of an existing superone, if one is already installed. */
  superonePath: string | null
  superoneVersion: string | null
  /** Node major found on PATH, or null when Node is absent. */
  nodeMajor: number | null
  /** Absolute Node executable selected from PATH, a login shell, or a version manager. */
  nodePath?: string | null
  /** Directory containing the selected Node/npm executables. */
  nodeBinDir?: string | null
  /** Absolute npm executable selected alongside Node. */
  npmPath?: string | null
  /** Effective PATH used by the non-interactive probe. */
  shellPath?: string | null
  /** `npm` on PATH — required for the registry install path. */
  hasNpm: boolean
  hasSystemd: boolean
  /** better-sqlite3 prebuild target matching this host. */
  distTarget: string | null
}

const PROBE_SCRIPT = [
  'echo "SUPERONE_PROBE_BEGIN"',
  'echo "os=$(uname -s)"',
  'echo "arch=$(uname -m)"',
  'echo "home=$HOME"',
  // Alpine/musl needs the linuxmusl-* prebuild instead of linux-*.
  `if [ -f /etc/alpine-release ] || (ldd --version 2>&1 | grep -qi musl); then echo "musl=1"; else echo "musl=0"; fi`,
  // Non-interactive SSH shells skip nvm/fnm/asdf/mise initialization. Prefer
  // the login shell, then scan common version-manager layouts directly.
  `NODE_BIN="$(bash -lc 'command -v node' 2>/dev/null | tail -1)"`,
  `NPM_BIN="$(bash -lc 'command -v npm' 2>/dev/null | tail -1)"`,
  `if [ ! -x "$NODE_BIN" ]; then NODE_BIN="$(command -v node 2>/dev/null || true)"; fi`,
  `if [ ! -x "$NPM_BIN" ]; then NPM_BIN="$(command -v npm 2>/dev/null || true)"; fi`,
  `if [ ! -x "$NODE_BIN" ]; then FALLBACK_NODE=""; for c in "$HOME"/.nvm/versions/node/*/bin/node "$HOME"/.fnm/node-versions/*/installation/bin/node "$HOME"/.volta/bin/node "$HOME"/.asdf/shims/node "$HOME"/.local/share/mise/installs/node/*/bin/node; do if [ -x "$c" ]; then [ -n "$FALLBACK_NODE" ] || FALLBACK_NODE="$c"; candidate_major="$("$c" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"; if [ "$candidate_major" -ge ${MIN_REMOTE_NODE_MAJOR} ] 2>/dev/null; then NODE_BIN="$c"; break; fi; fi; done; [ -x "$NODE_BIN" ] || NODE_BIN="$FALLBACK_NODE"; fi`,
  `if [ -x "$NODE_BIN" ]; then NODE_NPM="$(dirname "$NODE_BIN")/npm"; if [ -x "$NODE_NPM" ]; then NPM_BIN="$NODE_NPM"; fi; fi`,
  `NODE_BIN_DIR=""; if [ -x "$NODE_BIN" ]; then NODE_BIN_DIR="$(dirname "$NODE_BIN")"; export PATH="$NODE_BIN_DIR:$PATH"; fi`,
  `echo "node_path=$NODE_BIN"`,
  `echo "node_bin_dir=$NODE_BIN_DIR"`,
  `echo "npm_path=$NPM_BIN"`,
  `echo "shell_path=$PATH"`,
  // Look on PATH first, then the locations our own installer uses.
  `SUPERONE_BIN="$(command -v superone 2>/dev/null || true)"`,
  `for c in "$HOME/.local/bin/superone" "$HOME/.superone/npm/bin/superone" "$HOME/.superone/current/bin/superone" /usr/local/bin/superone; do`,
  `  [ -n "$SUPERONE_BIN" ] && break`,
  `  [ -x "$c" ] && SUPERONE_BIN="$c"`,
  'done',
  'echo "superone=$SUPERONE_BIN"',
  // Prefer `superone version` (product CLI release). Fallbacks: upload MANIFEST,
  // then npm package.json for registry installs under ~/.superone/npm.
  `SUPERONE_VER=""`,
  `if [ -n "$SUPERONE_BIN" ]; then`,
  `  SUPERONE_VER="$("$SUPERONE_BIN" version 2>/dev/null | head -1 | tr -d '\\r' | tr -d '[:space:]')"`,
  `  if [ -z "$SUPERONE_VER" ] && [ -f "$HOME/.superone/current/MANIFEST.json" ]; then`,
  `    SUPERONE_VER="$(sed -n 's/.*"version"[^"]*"\\([^"]*\\)".*/\\1/p' "$HOME/.superone/current/MANIFEST.json" | head -1)"`,
  '  fi',
  `  if [ -z "$SUPERONE_VER" ] && [ -f "$HOME/.superone/npm/lib/node_modules/@super-one/cli/package.json" ]; then`,
  `    SUPERONE_VER="$(sed -n 's/.*"version"[^"]*"\\([^"]*\\)".*/\\1/p' "$HOME/.superone/npm/lib/node_modules/@super-one/cli/package.json" | head -1)"`,
  '  fi',
  `  echo "superone_version=$SUPERONE_VER"`,
  'fi',
  `if [ -x "$NODE_BIN" ]; then echo "node_major=$("$NODE_BIN" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"; else echo "node_major="; fi`,
  `if [ -x "$NPM_BIN" ]; then echo "npm=1"; else echo "npm=0"; fi`,
  `if command -v systemctl >/dev/null 2>&1; then echo "systemd=1"; else echo "systemd=0"; fi`,
  'echo "SUPERONE_PROBE_END"',
].join('\n')

/** Parse `key=value` lines from the probe script into a typed result. */
export function parseProbeOutput(stdout: string): RemoteHostProbe {
  const values = new Map<string, string>()
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    values.set(trimmed.slice(0, eq), trimmed.slice(eq + 1))
  }

  const rawOs = (values.get('os') || '').toLowerCase()
  const os = rawOs.includes('linux') ? 'linux' : rawOs.includes('darwin') ? 'darwin' : 'unknown'

  const rawArch = values.get('arch') || ''
  const arch =
    rawArch === 'x86_64' || rawArch === 'amd64'
      ? 'x64'
      : rawArch === 'aarch64' || rawArch === 'arm64'
        ? 'arm64'
        : 'unknown'

  const musl = values.get('musl') === '1'
  const nodeMajorRaw = values.get('node_major')
  const nodeMajor = nodeMajorRaw ? Number(nodeMajorRaw) || null : null

  return {
    os,
    arch,
    musl,
    home: values.get('home') || '',
    superonePath: values.get('superone') || null,
    superoneVersion: values.get('superone_version') || null,
    nodeMajor,
    nodePath: values.get('node_path') || null,
    nodeBinDir: values.get('node_bin_dir') || null,
    npmPath: values.get('npm_path') || null,
    shellPath: values.get('shell_path') || null,
    hasNpm: values.get('npm') === '1',
    hasSystemd: values.get('systemd') === '1',
    distTarget: distTargetFor(os, arch, musl),
  }
}

/** Map a probed host to the artifact target built by scripts/build-dist.ts. */
export function distTargetFor(
  os: RemoteHostProbe['os'],
  arch: RemoteHostProbe['arch'],
  musl: boolean,
): string | null {
  if (arch === 'unknown') return null
  if (os === 'linux') return `${musl ? 'linuxmusl' : 'linux'}-${arch}`
  if (os === 'darwin') return `darwin-${arch}`
  return null
}

export interface SshTarget {
  destination: string
  extraSshArgs?: string[]
  sshPath?: string
  /** Remote bin directory containing a version-manager Node/npm installation. */
  nodeBinDir?: string | null
}

/** Prefix a remote command with the Node directory discovered during probing. */
export function withRemoteNodePath(
  command: string,
  nodeBinDir?: string | null,
): string {
  const dir = nodeBinDir?.trim()
  return dir ? `export PATH=${shellQuote(dir)}:$PATH && ${command}` : command
}

export async function probeRemoteHost(target: SshTarget): Promise<RemoteHostProbe> {
  const result = await sshCapture({
    destination: target.destination,
    extraArgs: target.extraSshArgs,
    sshPath: target.sshPath,
    command: PROBE_SCRIPT,
    timeoutMs: 30_000,
  })
  if (!result.stdout.includes('SUPERONE_PROBE_BEGIN')) {
    throw new Error(
      `ssh probe failed: ${result.stderr.trim() || result.stdout.trim() || `code ${result.code}`}`,
    )
  }
  return parseProbeOutput(result.stdout)
}

export interface InstallResult {
  /** Absolute remote path to the installed launcher. */
  remoteExec: string
  version: string
  /** Dist target (upload) or `registry` / package spec. */
  target: string
  /** Content hash for upload installs; empty for registry. */
  sha256: string
  source: RemoteInstallSource
  /** Set when an older version was replaced. */
  previousVersion?: string
}

export type InstallProgressStep = 'npm' | 'upload' | 'verify' | 'extract' | 'activate'

export interface InstallOptions extends SshTarget {
  /** Local path to a `superone-<version>-<target>.tar.gz` built by build-dist. */
  tarballPath: string
  version: string
  distTarget: string
  /** Remote home from the probe; used to build absolute paths. */
  remoteHome: string
  previousVersion?: string
  onProgress?: (phase: InstallProgressStep, detail?: string) => void
}

export interface RegistryInstallOptions extends SshTarget {
  /** npm package version (no leading `v`); must be pinned, never bare `latest`. */
  version: string
  packageName?: string
  remoteHome: string
  previousVersion?: string
  onProgress?: (phase: InstallProgressStep, detail?: string) => void
}

/**
 * Upload and activate a distribution on the remote host.
 *
 * The install is checksum-verified before extraction, and activation flips a
 * `current` symlink so a failed install never replaces a working version
 * (design §15 atomic version switch).
 */
export async function installNodeOverSsh(options: InstallOptions): Promise<InstallResult> {
  const { destination, extraSshArgs, sshPath } = options
  const sshOpts = { destination, extraArgs: extraSshArgs, sshPath }
  const remoteCommand = (command: string): string =>
    withRemoteNodePath(command, options.nodeBinDir)

  const bytes = await readFile(options.tarballPath)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const stageName = `superone-${options.version}-${options.distTarget}`
  const root = `${options.remoteHome}/.superone`
  const uploadPath = `${root}/downloads/${basename(options.tarballPath)}`

  options.onProgress?.('upload')
  await sshUpload({
    destination,
    extraArgs: extraSshArgs,
    sshPath,
    localPath: options.tarballPath,
    remotePath: uploadPath,
    remoteCommand: `mkdir -p ${shellQuote(`${root}/downloads`)} && cat > ${shellQuote(uploadPath)}`,
    onProgress: (sent, total) =>
      options.onProgress?.('upload', `${Math.round((sent / total) * 100)}%`),
  })

  // Verify, extract, and activate in one SSH session — a truncated upload must
  // never become `current`, and the install must not trip SSH connection limits.
  options.onProgress?.('verify')
  const finalize = await sshCapture({
    ...sshOpts,
    command: remoteCommand(
      [
        `remote_sha="$( (sha256sum ${shellQuote(uploadPath)} 2>/dev/null || shasum -a 256 ${shellQuote(uploadPath)}) | awk '{print $1}' )"`,
        `if [ "$remote_sha" != ${shellQuote(sha256)} ]; then rm -f ${shellQuote(uploadPath)}; echo "SUPERONE_CHECKSUM_MISMATCH=$remote_sha" >&2; exit 41; fi`,
        `mkdir -p ${shellQuote(`${root}/versions`)} ${shellQuote(`${options.remoteHome}/.local/bin`)} && chmod 700 ${shellQuote(root)}`,
        `rm -rf ${shellQuote(`${root}/versions/${stageName}`)}`,
        `tar xzf ${shellQuote(uploadPath)} -C ${shellQuote(`${root}/versions`)}`,
        `chmod +x ${shellQuote(`${root}/versions/${stageName}/bin/superone`)}`,
        `ln -sfn ${shellQuote(`${root}/versions/${stageName}`)} ${shellQuote(`${root}/current`)}`,
        `ln -sfn ${shellQuote(`${root}/current/bin/superone`)} ${shellQuote(`${options.remoteHome}/.local/bin/superone`)}`,
        `rm -f ${shellQuote(uploadPath)}`,
        `${shellQuote(`${root}/current/bin/superone`)} identity --home ${shellQuote(`${root}/node`)} >/dev/null`,
        'echo SUPERONE_UPLOAD_OK',
      ].join(' && '),
    ),
    timeoutMs: 120_000,
  })
  if (finalize.code !== 0 || !finalize.stdout.includes('SUPERONE_UPLOAD_OK')) {
    const mismatch = /SUPERONE_CHECKSUM_MISMATCH=([^\n]*)/
      .exec(finalize.stderr)?.[1]
      ?.trim()
    if (mismatch !== undefined) {
      throw new Error(
        `checksum mismatch after upload: expected ${sha256}, got ${mismatch || 'none'}`,
      )
    }
    throw new Error(
      `remote install finalization failed: ${finalize.stderr.trim() || finalize.stdout.trim() || `code ${finalize.code}`}`,
    )
  }
  options.onProgress?.('extract')
  options.onProgress?.('activate')

  return {
    remoteExec: `${root}/current/bin/superone`,
    version: options.version,
    target: options.distTarget,
    sha256,
    source: 'upload',
    previousVersion: options.previousVersion,
  }
}

/**
 * Install `@super-one/cli` on the remote host via npm (user-local prefix).
 * Avoids sudo; places a stable symlink at `~/.local/bin/superone`.
 */
export async function installNodeFromRegistry(
  options: RegistryInstallOptions,
): Promise<InstallResult> {
  const packageName = options.packageName ?? PUBLIC_CLI_PACKAGE
  const version = options.version.trim()
  if (!version || version === 'latest') {
    throw new Error('registry install requires a pinned package version (not latest)')
  }

  const spec = `${packageName}@${version}`
  const prefix = `${options.remoteHome}/.superone/npm`
  const localBin = `${options.remoteHome}/.local/bin`
  const remoteExec = `${localBin}/${PUBLIC_CLI_BIN}`
  const remoteCommand = (command: string): string =>
    withRemoteNodePath(command, options.nodeBinDir)

  options.onProgress?.('npm', spec)

  const installCmd = remoteCommand(
    [
      `mkdir -p ${shellQuote(prefix)} ${shellQuote(localBin)}`,
      `npm install -g --prefix ${shellQuote(prefix)} ${shellQuote(spec)}`,
      `ln -sfn ${shellQuote(`${prefix}/bin/${PUBLIC_CLI_BIN}`)} ${shellQuote(remoteExec)}`,
      // Prove the launcher is executable; identity is cheap and fails closed.
      `${shellQuote(remoteExec)} identity --home ${shellQuote(`${options.remoteHome}/.superone/node`)} >/dev/null`,
      `echo "SUPERONE_REGISTRY_OK=${remoteExec}"`,
    ].join(' && '),
  )

  const result = await sshCapture({
    destination: options.destination,
    extraArgs: options.extraSshArgs,
    sshPath: options.sshPath,
    command: installCmd,
    timeoutMs: 10 * 60_000,
  })

  if (result.code !== 0 || !result.stdout.includes('SUPERONE_REGISTRY_OK=')) {
    const detail = (result.stderr.trim() || result.stdout.trim() || `code ${result.code}`).slice(0, 800)
    throw new Error(
      `npm install of ${spec} failed on remote host: ${detail}. ` +
        `If the package is not published yet or the host is offline, use install source "upload" with a local dist build.`,
    )
  }

  return {
    remoteExec,
    version,
    target: 'registry',
    sha256: '',
    source: 'registry',
    previousVersion: options.previousVersion,
  }
}

/**
 * Explain why a probed host cannot run the node, or null when it can.
 * Returned strings are user-facing and actionable.
 */
export function preflightBlocker(
  probe: RemoteHostProbe,
  source: RemoteInstallSource = 'registry',
): string | null {
  if (probe.os === 'unknown') return 'unsupported remote operating system'
  if (probe.arch === 'unknown') return 'unsupported remote CPU architecture'
  if (!probe.home) return 'could not resolve remote $HOME'
  if (probe.nodeMajor === null) {
    const pathDetail = probe.shellPath ? ` (probe PATH: ${probe.shellPath})` : ''
    return `Node.js ${MIN_REMOTE_NODE_MAJOR}+ is required on the remote host but was not found on PATH${pathDetail}`
  }
  if (probe.nodeMajor < MIN_REMOTE_NODE_MAJOR) {
    return `Node.js ${MIN_REMOTE_NODE_MAJOR}+ is required on the remote host, found ${probe.nodeMajor}`
  }
  if (source === 'registry' && !probe.hasNpm) {
    const pathDetail = probe.shellPath ? ` (probe PATH: ${probe.shellPath})` : ''
    return `npm is required on the remote host for registry install but was not found on PATH${pathDetail}`
  }
  if (source === 'upload' && !probe.distTarget) {
    return `no distribution built for ${probe.os}/${probe.arch}`
  }
  return null
}
