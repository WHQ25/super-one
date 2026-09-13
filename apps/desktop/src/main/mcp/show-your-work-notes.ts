/**
 * Reminders that ride with every screenshot and recording a built-in tool hands
 * back. The artifact is the only thing in the loop the user can look at, and
 * the moment it is returned is the only moment the reminder is certain to be
 * read — the manual chapter these point at is not. One copy, so the browser,
 * device and computer surfaces say the same thing.
 *
 * Select captures by their value to the reply, not why they were first taken.
 * Inspection captures can become evidence; a tool result alone is no reason
 * to embed every screenshot or recording.
 */

const SEE = 'See read_manual product/show-your-work.'

function evidenceNote(field: string, caption: string): string {
  return `If the user requested this capture or it directly supports a visual claim in your reply, `
    + `embed ${field} with ![${caption}](<path>), angle brackets around the path, and say what to look at. `
    + `Reuse a relevant inspection capture as evidence. Omit captures that only document navigation or content extraction unless requested. ${SEE}`
}

/** For a result whose screenshot path sits in `field` (e.g. `image.path`, `screenshot.path`). */
export function imageNote(field: string): string {
  return evidenceNote(field, 'what to look at')
}

/** For a result whose clip path sits in `field` (e.g. `recording.savedPath`). */
export function recordingNote(field: string): string {
  return evidenceNote(field, 'what happens in it')
}
