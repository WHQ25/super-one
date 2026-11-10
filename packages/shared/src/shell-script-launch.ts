/**
 * Argv for a code-fence script. A login interactive child of the user's shell
 * runs the script, so it reads the same startup files as a terminal paste
 * (zsh: `.zprofile` and `.zshrc`). The wrapper prints `[exit N]`, then replaces
 * itself with an interactive login shell. `exit` in the script therefore cannot
 * close the terminal tab. The script is an argument, never interpolated, so
 * quotes and newlines stay literal.
 */
export function scriptedShellArgs(shell: string, script: string): string[] {
  const program = shellProgram(shell)
  if (program === 'fish') return fishArgs(shell, script)
  if (program === 'pwsh' || program === 'powershell') return powershellArgs(shell, script)
  if (program === 'cmd') return ['/D', '/K', script]
  return posixArgs(shell, script)
}

/** `path.basename` on macOS ignores `\`, so Windows shells would be treated as POSIX. */
function shellProgram(shell: string): string {
  const base = (shell.split(/[/\\]/).pop() ?? shell).toLowerCase()
  return base.endsWith('.exe') ? base.slice(0, -4) : base
}

function posixArgs(shell: string, script: string): string[] {
  // set +e first: zsh reads .zshenv before -c, and set -e there would abort
  // this wrapper when the script exits non-zero. The script runs in a login
  // interactive child (-ilc), not this wrapper, so its startup files still apply.
  return [
    '-c',
    'set +e; "$1" -ilc "$2"; result=$?; printf "\\n[exit %s]\\n" "$result"; exec "$1" -il',
    'shell',
    shell,
    script,
  ]
}

function fishArgs(shell: string, script: string): string[] {
  // --no-config keeps the wrapper from running a config that calls exit.
  // The inner shell and the interactive follow-up still load the user's config.
  return [
    '--no-config',
    '-c',
    '$argv[1] -c $argv[2]; set result $status; printf "\\n[exit %s]\\n" $result; exec $argv[1] -i',
    shell,
    script,
  ]
}

function powershellArgs(shell: string, script: string): string[] {
  const inner = `& ${powershellSingleQuote(shell)} -NoLogo -NoProfile -Command ${powershellSingleQuote(script)}`
  const command = `$code = 0; ${inner}; if ($null -ne $LASTEXITCODE) { $code = $LASTEXITCODE }; Write-Host ""; Write-Host "[exit $code]"`
  return ['-NoLogo', '-NoProfile', '-NoExit', '-Command', command]
}

function powershellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}
