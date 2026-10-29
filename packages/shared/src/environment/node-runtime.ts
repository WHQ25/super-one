/**
 * Minimum Node.js for the published CLI and remote-node install.
 *
 * @cursor/sdk requires >=22.13. better-sqlite3 requires >=22. The floor is the
 * stricter of the two, compared as a full version rather than a major.
 */
export const MIN_CLI_NODE_VERSION = '22.13.0'

export function parseNodeVersion(raw: string | null | undefined): [number, number, number] | null {
  if (!raw?.trim()) return null
  const match = /^\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(raw.trim())
  if (!match) return null
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)]
}

export function nodeVersionSatisfies(
  actual: string | null | undefined,
  minimum = MIN_CLI_NODE_VERSION,
): boolean {
  const found = parseNodeVersion(actual)
  const required = parseNodeVersion(minimum)
  if (!found || !required) return false
  for (let i = 0; i < 3; i += 1) {
    if (found[i] !== required[i]) return found[i]! > required[i]!
  }
  return true
}

export function cliNodeEngineRange(minimum = MIN_CLI_NODE_VERSION): string {
  return `>=${minimum}`
}

/** esbuild accepts a Node major, not 22.13. The runtime check stays on the full version. */
export function cliNodeEsbuildTarget(minimum = MIN_CLI_NODE_VERSION): string {
  return `node${minimum.split('.')[0]}`
}

/**
 * POSIX sh function. `node_meets_minimum "$version"` returns 0 when the version
 * is at least the CLI floor. Generated into remote probes and upload launchers.
 */
export function posixNodeMeetsMinimumFunction(minimum = MIN_CLI_NODE_VERSION): string {
  const parsed = parseNodeVersion(minimum)
  if (!parsed) throw new Error(`invalid node floor ${minimum}`)
  const [maj, min, pat] = parsed
  return [
    'node_meets_minimum() {',
    '  ver=${1#v}',
    '  maj=${ver%%.*}',
    '  if [ "$maj" = "$ver" ]; then',
    '    min=0',
    '    pat=0',
    '  else',
    '    rest=${ver#*.}',
    '    min=${rest%%.*}',
    '    if [ "$min" = "$rest" ]; then',
    '      pat=0',
    '    else',
    '      pat=${rest#*.}',
    '      pat=${pat%%[!0-9]*}',
    '    fi',
    '  fi',
    '  [ -n "$maj" ] || maj=0',
    '  [ -n "$min" ] || min=0',
    '  [ -n "$pat" ] || pat=0',
    `  if [ "$maj" -gt ${maj} ] 2>/dev/null; then return 0; fi`,
    `  if [ "$maj" -lt ${maj} ] 2>/dev/null; then return 1; fi`,
    `  if [ "$min" -gt ${min} ] 2>/dev/null; then return 0; fi`,
    `  if [ "$min" -lt ${min} ] 2>/dev/null; then return 1; fi`,
    `  [ "$pat" -ge ${pat} ] 2>/dev/null`,
    '}',
  ].join('\n')
}
