/**
 * Agent citations put `start:end:path` in the fence info string
 * (`92:101:src/file.ts`). A bare filename or path is the same idea.
 * Ordinary language tags (`ts`, `typescript`, `c++`) are returned unchanged
 * so the highlighter still receives a grammar id.
 */

/** Extensions Shiki does not already alias to a bundled grammar. */
const EXT_ALIAS: Readonly<Record<string, string>> = {
  cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp', hxx: 'cpp',
  h: 'c',
  m: 'objective-c', mm: 'objective-cpp',
  htm: 'html', svg: 'xml',
  patch: 'diff',
  pyi: 'python',
  ex: 'elixir', exs: 'elixir',
  ipynb: 'json',
  gradle: 'groovy',
  psm1: 'powershell',
  cmd: 'bat',
}

/** Extension-less names whose grammar is the file, not a language tag. */
const BASENAME: Readonly<Record<string, string>> = {
  dockerfile: 'dockerfile',
  containerfile: 'dockerfile',
  makefile: 'makefile',
  gemfile: 'ruby',
  rakefile: 'ruby',
  podfile: 'ruby',
}

function basename(value: string): string {
  return (value.split(/[/\\]/).pop() ?? value).toLowerCase()
}

function looksLikeFile(value: string): boolean {
  if (/[/\\]/.test(value)) return true
  const base = basename(value)
  if (BASENAME[base]) return true
  const dot = base.lastIndexOf('.')
  return dot > 0 && dot < base.length - 1
}

function pathFromFenceInfo(value: string): string | null {
  if (!value) return null
  const ranged = value.match(/^\d+:\d+:(.+)$/)
  if (ranged?.[1]) return ranged[1]
  const single = value.match(/^\d+:(.+)$/)
  if (single?.[1] && looksLikeFile(single[1])) return single[1]
  if (looksLikeFile(value)) return value
  return null
}

function languageForPath(filePath: string): string | null {
  const base = basename(filePath)
  const named = BASENAME[base]
  if (named) return named
  const dot = base.lastIndexOf('.')
  if (dot <= 0 || dot === base.length - 1) return null
  return EXT_ALIAS[base.slice(dot + 1)] ?? base.slice(dot + 1)
}

/** Grammar id for a fence info string, or the original tag when it is not a file. */
export function fenceHighlightLanguage(raw: string): string {
  const value = raw.trim()
  const path = pathFromFenceInfo(value)
  if (!path) return value
  return languageForPath(path) ?? value
}
