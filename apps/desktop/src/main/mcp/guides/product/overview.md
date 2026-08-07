# SuperOne — product overview

SuperOne is an Electron desktop meta-app: chat agents (Claude / Codex / Grok), mini-apps, generative media, and an in-app browser.

## Links

| What | URL |
|------|-----|
| **Source repository** | https://github.com/WHQ25/super-one |
| **Issues** | https://github.com/WHQ25/super-one/issues |
| **Website** | https://super-one.dev |
| **Relay (self-host)** | https://github.com/WHQ25/super-one-relay |

## Product manual topics

| Topic | When to load |
|-------|----------------|
| `overview` | This page — product identity and routing |
| `contribute` | **Any** GitHub issue or PR (bugs, features, improvements, docs). Issue first, then optional PR. |
| `debug` | Crashes / wrong behavior: log paths, userData, monorepo map, this machine’s runtime paths |
| `collaboration` | Before `session_collab_request` with worktrees / multi-agent implementers & reviewers (`cwd` vs `worktree.enabled`) |

```text
read_manual({ domain: "product", topic: "contribute" })
read_manual({ domain: "product", topic: "debug" })
read_manual({ domain: "product", topic: "collaboration" })
```

## When the user wants to report or change something upstream

Works for bugs **and** feature / improvement ideas:

1. Load `product/contribute` (and `product/debug` if you need logs or code map for a bug).
2. Help them gather enough context (for bugs: version, OS, repro, log snippets; for features: motivation and proposal).
3. **Issue first** — ask whether they want to file a GitHub issue; create/submit only if they agree.
4. **Then optional PR** — only after `#N` exists, ask whether they want a PR. Everyone is welcome. Never start a contribution PR without their yes, and never open a PR without an issue. PR **must** reference the issue. Bugfix PRs: strict red–green (details in contribute).

## When the user hits a bug (local diagnosis)

1. Load `product/debug` for **this machine’s** log and data paths.
2. Gather: SuperOne version, OS, steps to reproduce, relevant log snippets, screenshots; link monorepo files when you can map the failure.
3. When they are ready to report or fix upstream, continue with **contribute** (issue → optional PR) — do not treat issue/PR as debug-only.
