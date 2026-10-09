import type { CodexCommandAction } from './agent-types'

type Token = { text: string; separator?: true }

/** A deliberately small literal-shell grammar. Unsupported syntax stays Bash. */
function tokens(command: string): Token[] | undefined {
  const result: Token[] = []
  let word = '', started = false, quote = ''
  const flush = () => { if (started) result.push({ text: word }); word = ''; started = false }
  for (let i = 0; i < command.length; i++) {
    const c = command[i]!
    if (quote) {
      if (c === quote) { quote = ''; continue }
      if (quote === '"' && (c === '$' || c === '`')) return
      if (quote === '"' && c === '\\' && /["\\$`]/.test(command[i + 1] ?? '')) {
        word += command[++i]; continue
      }
      word += c; continue
    }
    if (c === "'" || c === '"') { quote = c; started = true; continue }
    if (c === '\\') {
      if (!command[i + 1] || command[i + 1] === '\n') return
      word += command[++i]; started = true; continue
    }
    if (c === '\n' || c === ';' || (c === '&' && command[i + 1] === '&')) {
      flush(); result.push({ text: c === '&' ? '&&' : ';', separator: true })
      if (c === '&') i++
      continue
    }
    if (/\s/.test(c)) { flush(); continue }
    if (/[|&<>$`*?\[\]{}~#()]/.test(c)) return
    word += c; started = true
  }
  if (quote) return
  flush()
  return result
}

function absolutePath(path: string, cwd?: string): string | undefined {
  if (!path || path === '-') return
  // Windows drive/UNC operands are left to upstream metadata, not POSIX joining.
  if (/^[A-Za-z]:|^\\\\/.test(path) || (cwd && !cwd.startsWith('/'))) return
  const full = path.startsWith('/') ? path : cwd ? `${cwd}/${path}` : path
  const parts: string[] = []
  for (const part of full.split('/')) {
    if (!part || part === '.') continue
    if (part === '..' && parts.length && parts.at(-1) !== '..') parts.pop()
    else if (part !== '..' || !full.startsWith('/')) parts.push(part)
  }
  return `${full.startsWith('/') ? '/' : ''}${parts.join('/')}`
}

function operands(argv: string[]): string[] | undefined {
  if (argv[0]?.includes('/') && !/^\/(?:usr\/)?bin\/(?:cat|head|tail|sed)$/.test(argv[0])) return
  const reader = argv[0]?.split('/').pop()
  if (!reader || !['cat', 'head', 'tail', 'sed'].includes(reader)) return
  const files: string[] = []
  let options = true, expression = reader !== 'sed', quiet = false
  for (let i = 1; i < argv.length; i++) {
    const value = argv[i]!
    if (options && value === '--') { options = false; continue }
    if (options && value.startsWith('-')) {
      if (reader === 'cat' && /^-[AbEenstTv]+$/.test(value)) continue
      if (reader === 'head' || reader === 'tail') {
        if (/^-[qv]+$/.test(value) || /^-(?:n|c)[+-]?\d+$/.test(value) || /^--(?:lines|bytes)=[+-]?\d+$/.test(value)) continue
        if (['-n', '-c', '--lines', '--bytes'].includes(value) && /^[+-]?\d+$/.test(argv[i + 1] ?? '')) { i++; continue }
      }
      if (reader === 'sed' && value === '-n') { quiet = true; continue }
      if (reader === 'sed' && value === '-e' && !expression && /^\d+(?:,\d+)?p$/.test(argv[i + 1] ?? '')) { expression = true; i++; continue }
      return
    }
    if (!expression) {
      if (!/^\d+(?:,\d+)?p$/.test(value)) return
      expression = true; continue
    }
    if (!value || value === '-') return
    files.push(value)
  }
  if (!files.length || (reader === 'sed' && (!quiet || !expression))) return
  return files
}

/** Never executes shell text; all-or-nothing recognition, bounded for transcript input. */
export function literalReadActions(command: string, cwd?: string, depth = 0): CodexCommandAction[] | undefined {
  if (command.length > 16_384 || depth > 2) return
  const parsed = tokens(command)
  if (!parsed?.length) return
  const shell = parsed[0]!.text.split('/').pop()
  if (['sh', 'bash', 'zsh', 'dash'].includes(shell ?? '') && (!parsed[0]!.text.includes('/') || /^\/(?:usr\/)?bin\//.test(parsed[0]!.text)) && parsed.length === 3 && /^-(?:l?c|cl)$/.test(parsed[1]!.text)) {
    return literalReadActions(parsed[2]!.text, cwd, depth + 1)
  }
  const commands: string[][] = [[]]
  const separators: string[] = []
  for (const token of parsed) {
    if (token.separator) {
      if (!commands.at(-1)!.length) return
      separators.push(token.text)
      commands.push([])
    } else commands.at(-1)!.push(token.text)
  }
  if (!commands.at(-1)!.length) commands.pop()
  const actions: CodexCommandAction[] = []
  let directory = cwd
  for (const [index, argv] of commands.entries()) {
    if (argv[0] === 'cd' && argv.length === 2) {
      // A failed cd followed by ';' would read from the previous directory.
      if (separators[index] !== '&&') return
      directory = absolutePath(argv[1]!, directory)
      if (!directory) return
      continue
    }
    const files = operands(argv)
    if (!files) return
    for (const file of files) {
      const path = absolutePath(file, directory)
      if (!path || actions.length >= 128) return
      actions.push({ type: 'read', path, name: path.split('/').pop(), command: argv.join(' ') })
    }
  }
  return actions.length ? actions : undefined
}
