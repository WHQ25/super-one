import { describe, expect, it } from 'vitest'
import { splitPatchFiles } from './git-patch-files'

const PATCH = `diff --git a/src/a.ts b/src/a.ts
index 1..2 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,2 +1,2 @@
 keep
-old
+new
diff --git a/gone.txt b/gone.txt
deleted file mode 100644
--- a/gone.txt
+++ /dev/null
@@ -1 +0,0 @@
-bye
diff --git a/old name.md b/new name.md
similarity index 90%
rename from old name.md
rename to new name.md
diff --git a/logo.png b/logo.png
new file mode 100644
Binary files /dev/null and b/logo.png differ
`

describe('splitPatchFiles', () => {
  it('splits files and counts their changed lines', () => {
    const files = splitPatchFiles(PATCH)
    expect(files.map((f) => [f.path, f.status, f.additions, f.deletions])).toEqual([
      ['src/a.ts', 'modified', 1, 1],
      ['gone.txt', 'deleted', 0, 1],
      ['new name.md', 'renamed', 0, 0],
      ['logo.png', 'added', 0, 0],
    ])
  })

  it('keeps rename sources and binary markers', () => {
    const files = splitPatchFiles(PATCH)
    expect(files[2].oldPath).toBe('old name.md')
    expect(files[3].binary).toBe(true)
    expect(files[0].diff.startsWith('diff --git a/src/a.ts')).toBe(true)
  })

  it('does not count +++/--- header lines as changes', () => {
    expect(splitPatchFiles(PATCH)[0].additions).toBe(1)
  })

  it('returns nothing for an empty patch', () => {
    expect(splitPatchFiles('')).toEqual([])
  })
})
