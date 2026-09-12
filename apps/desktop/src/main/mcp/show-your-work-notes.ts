/**
 * Reminders that ride with every screenshot and recording a built-in tool hands
 * back. The artifact is the only thing in the loop the user can look at, and
 * the moment it is returned is the only moment the reminder is certain to be
 * read — the manual chapter these point at is not. One copy, so the browser,
 * device and computer surfaces say the same thing.
 */

const SEE = 'See read_manual product/show-your-work.'

/** For a result whose screenshot path sits in `field` (e.g. `image.path`, `screenshot.path`). */
export function imageNote(field: string): string {
  return `Show this to the user when you report what you found: embed ${field} with `
    + `![what to look at](<path>), angle brackets around the path. ${SEE}`
}

/** For a result whose clip path sits in `field` (e.g. `recording.savedPath`). */
export function recordingNote(field: string): string {
  return `Show this to the user when you report the result: embed ${field} with `
    + `![what happens in it](<path>), angle brackets around the path. ${SEE}`
}
