/**
 * Provider env keys projected into the Claude Code flag-settings layer.
 *
 * Every settings file the CLI loads (`~/.claude/settings.json`,
 * `.claude/settings.json`, `.claude/settings.local.json`) may carry an `env`
 * block, and the CLI writes that block back into `process.env` at startup — a
 * file value beats the env the harness was spawned with. A user who routes
 * their terminal through a proxy would therefore silently override the
 * provider picked in SuperOne. Mirroring the provider keys into `--settings`
 * (SDK `settings`), which the CLI merges above every file per key, makes ours
 * win while every other key in the user's files stays untouched. Only managed
 * settings outrank it.
 *
 * @param providerEnv the provider overlay only (api key, base url, extraEnv) —
 *   never the full spawn env.
 */
export function providerSettingsEnv(
  providerEnv: Record<string, string | undefined> | undefined,
): Record<string, string> | undefined {
  if (!providerEnv) return undefined
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(providerEnv)) {
    if (value !== undefined) env[key] = value
  }
  // The CLI prefers ANTHROPIC_AUTH_TOKEN over the api key, so a token left in
  // the user's files would authenticate our provider with someone else's
  // credential. Blank it unless the provider supplies its own (platform
  // registry entries that authenticate by bearer set it explicitly).
  if (env.ANTHROPIC_API_KEY && !('ANTHROPIC_AUTH_TOKEN' in env)) env.ANTHROPIC_AUTH_TOKEN = ''
  return Object.keys(env).length > 0 ? env : undefined
}
