export type PatchFileStatus = 'added' | 'deleted' | 'renamed' | 'modified'

/** One file's slice of a `git diff` / `git show` patch. */
export interface PatchFile {
  path: string
  /** Set for renames: where the file came from. */
  oldPath?: string
  status: PatchFileStatus
  binary: boolean
  additions: number
  deletions: number
  /** The file's own section of the patch, header included. */
  diff: string
}

function stripPrefix(path: string): string {
  return path.replace(/^"|"$/g, '').replace(/^[ab]\//, '')
}

function parseFile(section: string): PatchFile {
  const lines = section.split('\n')
  const header = lines[0].match(/^diff --git (\S+) (\S+)$/)
  let oldPath = header ? stripPrefix(header[1]) : ''
  let path = header ? stripPrefix(header[2]) : ''
  let status: PatchFileStatus = 'modified'
  let binary = false
  let additions = 0
  let deletions = 0
  let inHunk = false
  for (const line of lines.slice(1)) {
    if (line.startsWith('@@')) {
      inHunk = true
      continue
    }
    if (inHunk) {
      if (line.startsWith('+')) additions++
      else if (line.startsWith('-')) deletions++
      continue
    }
    if (line.startsWith('new file mode')) status = 'added'
    else if (line.startsWith('deleted file mode')) status = 'deleted'
    else if (line.startsWith('rename from ')) { status = 'renamed'; oldPath = line.slice('rename from '.length) }
    else if (line.startsWith('rename to ')) path = line.slice('rename to '.length)
    else if (line.startsWith('Binary files ') || line === 'GIT binary patch') binary = true
    else if (line.startsWith('+++ ') && line !== '+++ /dev/null') path = stripPrefix(line.slice(4))
    else if (line.startsWith('--- ') && line !== '--- /dev/null' && status === 'deleted') path = stripPrefix(line.slice(4))
  }
  return { path, ...(status === 'renamed' ? { oldPath } : {}), status, binary, additions, deletions, diff: section }
}

/** Split a multi-file unified patch into its files, in patch order. */
export function splitPatchFiles(patch: string): PatchFile[] {
  const sections: string[] = []
  let current: string[] | null = null
  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      if (current) sections.push(current.join('\n'))
      current = [line]
    } else if (current) {
      current.push(line)
    }
  }
  if (current) sections.push(current.join('\n'))
  return sections.map(parseFile)
}
