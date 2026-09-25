/**
 * Host wake prompts that exist only to resume the model: download / artifact
 * receipts and collaboration mailbox wakes. The tool row or status-bar inbox
 * already shows the human side, so the transcript keeps no bubble for them.
 * A scheduled prompt (Grok cron) also arrives as a wake but is user-authored
 * and stays visible.
 */
const MODEL_ONLY_WAKE = new RegExp(
  '^(?:<task_notification source="(?:browser_download|artifact_sync)"'
  + '|A collaboration mailbox message is ready\\.'
  + '|A user-approved collaboration link is active with SuperOne session )',
)

/** Callers must also require `source === 'task-notification'`; user text is never hidden. */
export function isModelOnlyHostWake(text: string): boolean {
  return MODEL_ONLY_WAKE.test(text.trimStart())
}
