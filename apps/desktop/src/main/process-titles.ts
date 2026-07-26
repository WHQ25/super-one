// Two different naming channels, do not confuse them:
//
// - `spawn(..., { argv0 })` rewrites argv[0]. Visible in `ps -o comm`, but NOT in
//   macOS Activity Monitor — that reads the LaunchServices display name, which an
//   argv0 override never touches. Never triggers a LaunchServices "check-in", so
//   it's always Dock-safe. **Prefer this whenever we control the exec.**
// - `process.title = ...` inside a Node child. libuv also calls LaunchServices, so
//   the name lands in Activity Monitor too — but that check-in can leave a process
//   registered as a foreground app and bouncing in the Dock, observed when the
//   process is spawned (and its lifecycle managed) by a third party we don't
//   control (Codex's own launcher respawning the MCP bridge per turn). Known
//   upstream pattern with no clean fix: anthropics/claude-code#1912, Cursor forum
//   "floating node exec icon in Dock". Avoid for anything short-lived or spawned
//   outside our own `child_process` call.
//
// Renderer processes can use neither: `sandbox: true` makes preload's `process` an
// Electron shim (the assignment is a no-op), and the seatbelt sandbox would reject
// the LaunchServices call anyway. Per-renderer attribution needs an in-app task
// manager over `app.getAppMetrics()` + `webContents.getOSProcessId()`.
export const ProcessTitle = {
  Claude: 'SuperOne Claude',
  Codex: 'SuperOne Codex',
  Mdns: 'SuperOne mDNS',
  SleepBlocker: 'SuperOne Sleep Blocker',
  Installer: 'SuperOne Installer',
  LlmProxy: 'SuperOne LLM Proxy',
} as const

export const SUPERONE_ROLE_ARG_PREFIX = '--superone-role='

export const SUPERONE_GLASS_ARG = '--superone-liquid-glass'

export function glassBootArgs(enabled: boolean): string[] {
  return enabled ? [SUPERONE_GLASS_ARG] : []
}

export const WindowRole = {
  Main: 'main',
  Mini: 'mini',
  WorkerHost: 'worker-host',
} as const

export type WindowRoleValue = (typeof WindowRole)[keyof typeof WindowRole]

export function roleArg(role: WindowRoleValue): string {
  return `${SUPERONE_ROLE_ARG_PREFIX}${role}`
}
