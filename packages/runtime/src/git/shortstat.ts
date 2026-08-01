/** Parse `git diff HEAD --shortstat` (tracked changes only). */
export function parseShortstat(shortstat: string): { insertions: number; deletions: number } {
  const insMatch = shortstat.match(/(\d+) insertion/)
  const delMatch = shortstat.match(/(\d+) deletion/)
  return {
    insertions: insMatch ? parseInt(insMatch[1]!, 10) : 0,
    deletions: delMatch ? parseInt(delMatch[1]!, 10) : 0,
  }
}
