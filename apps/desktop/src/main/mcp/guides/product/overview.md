# SuperOne — product overview

SuperOne is an Electron desktop meta-app: chat agents (Claude / Codex / Grok), mini-apps, generative media, and an in-app browser.

## Links

| What | URL |
|------|-----|
| **Source repository** | https://github.com/WHQ25/super-one |
| **Issues (bug reports)** | https://github.com/WHQ25/super-one/issues |
| **Website** | https://super-one.dev |
| **Relay (self-host)** | https://github.com/WHQ25/super-one-relay |

## When the user hits a bug

1. Call `read_manual({ domain: "product", topic: "debug" })` — includes **this machine’s** log and data paths.
2. Help them gather: SuperOne version, OS, steps to reproduce, relevant log snippets, screenshots.
3. Draft a GitHub issue at https://github.com/WHQ25/super-one/issues with that package. Create or submit it only when the user explicitly asks.
4. Prefer linking source files in the monorepo (`apps/desktop/...`) when you can map the failure to code.
