import data from './file-icons.generated.json'

const files: Record<string, string> = data.files
const extensions: Record<string, string> = data.extensions
const folders: Record<string, string> = data.folders
const artwork: Record<string, string> = data.artwork
const own = (map: Record<string, string>, key: string) => Object.hasOwn(map, key) ? map[key] : undefined

export function fileIconId(path: string, directory = false): string {
  const name = path.replace(/[/\\]+$/, '').split(/[/\\]/).pop() ?? ''
  if (directory) return own(folders, name) ?? data.defaultFolder
  const lower = name.toLowerCase()
  const named = own(files, lower)
  if (named) return named
  const parts = lower.split('.')
  // Symbols tries two-part suffixes before longer ones, then the final extension.
  for (let index = parts.length - 2; index >= 0; index--) {
    const match = own(extensions, parts.slice(index).join('.'))
    if (match) return match
  }
  const extension = parts.length > 1 ? own(extensions, parts.at(-1)!) : undefined
  return extension ?? data.defaultFile
}

export function fileIconSvg(path: string, directory = false): string {
  return artwork[fileIconId(path, directory)]!
}
