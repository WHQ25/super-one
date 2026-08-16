# SuperOne — contributing (issues & PRs)

Use this for **any** upstream contribution: bug reports, feature ideas, improvements, docs, DX — not only crashes. **Everyone is welcome.**

Repos: https://github.com/WHQ25/super-one  
Issues: https://github.com/WHQ25/super-one/issues  
New issue: https://github.com/WHQ25/super-one/issues/new  

For log paths, userData, and monorepo layout while diagnosing a failure, also load `read_manual({ domain: "product", topic: "debug" })`.

## Contribution order (issue first, then optional PR)

**Always start with a GitHub issue.** Do not open a contribution PR, start a branch for upstream, or run the PR workflow until an issue exists for this work.

| Step | Gate | What you do |
|------|------|-------------|
| **1. Issue?** | Ask whether they want to file an issue. Create/submit **only** if they say yes. | Draft with the right template below → open on GitHub |
| **2. PR?** | **Only after** the issue is filed (or they already have `#N`). Ask whether they want to open a PR that implements or fixes it. | Everyone is welcome; no is a full stop |
| **3. Work** | Only if they said yes to the PR. | Follow the PR rules below; PR **must** reference the issue |

Suggested asks (adapt to their language):

1. After the idea or problem is clear:  
   > I can draft a GitHub issue (bug / feature / improvement). Want me to file one?

2. **Only after** the issue is open (note `#N`):  
   > Issue #N is filed. Would you like to open a PR for it? The PR will reference #N.  
   > (For bugs: we use red–green — failing test first, then fix.)

If they decline the issue: stop (you may still help locally; do not push the PR path).  
If they file an issue but decline the PR: stop at the issue.  
If they want a PR without an issue: explain that **issue first is required**, help file the issue, then re-ask about the PR.

## If they have no GitHub account

GitHub is the **only** upstream tracker: https://github.com/WHQ25/super-one/issues  
Do **not** invent another channel (email, chat, Discord, in-app ticket).

| Situation | What you do |
|-----------|-------------|
| They can create an account | Finish diagnosis. Draft the issue (templates below). Point them to https://github.com/signup, then https://github.com/WHQ25/super-one/issues/new. After they have an account, ask again whether they want you to file it. |
| They will not create an account now | Finish local diagnosis. Hand them a complete issue draft (title + body) they can paste later. **Stop** — no PR, no “I’ll file it for you later” promise. |

Never file an issue or open a PR under *your* GitHub identity “for” them unless they explicitly ask you to use this session’s authenticated `gh` **and** they understand it will appear under that account.

## Filing an issue

Create or submit **only** when the user explicitly agrees. Prefer linking monorepo paths (`apps/desktop/...`) when you can map the topic to code.

### Bug report template

```markdown
### Summary
<!-- one line -->

### Environment
- SuperOne version:
- OS:
- Agent / harness (Claude, Codex, Grok, …):
- Install: packaged DMG/NSIS vs `bun run dev`

### Steps to reproduce
1.
2.

### Expected
### Actual

### Logs
<!-- paste the last ~50–100 lines from main.log / dev.log around the failure -->
<!-- redact API keys / tokens / absolute home paths if sensitive -->

### Related code (if known)
<!-- e.g. apps/desktop/src/main/... -->
```

Use resolved paths from product/debug **Runtime paths** when available. Summarize the relevant error window; redact credentials, tokens, and private home-directory segments.

### Feature / improvement template

```markdown
### Summary
<!-- what you want and why, one or two sentences -->

### Motivation
<!-- problem today, who it helps, any workaround -->

### Proposal
<!-- concrete behavior or UX; optional mockups / steps -->

### Alternatives considered
<!-- optional -->

### Related code (if known)
<!-- e.g. apps/desktop/src/renderer/... -->
```

## Opening a PR

**All users are welcome** — only **after** an issue exists, and only if they explicitly agree to contribute.

### Prerequisites (hard gates)

1. A GitHub issue exists on https://github.com/WHQ25/super-one (just filed, or the user already provided `#N`).
2. The user explicitly agreed to open a PR.
3. The PR **must** reference that issue (`Fixes #N` / `Closes #N` in the PR body; prefer also in the commit footer when it closes the issue).

Do **not** start a branch, write production code for upstream contribution, or open a PR unless both (1) and (2) are true.

### Bug fix PRs — strict red–green (required)

Do **not** patch production code until a test fails for the right reason.

| Step | What to do | Done when |
|------|------------|-----------|
| **1. Red** | Write or extend an automated test that **reproduces the bug** (expected correct behavior; current code fails). | The test fails. If it passes, the repro is wrong — fix the test, not the product. |
| **2. Green** | Change the **minimum** production code so that test (and existing suite) passes. | The reproducing test passes; no unrelated failures. |
| **3. Open PR** | Branch, commit, push, open PR against https://github.com/WHQ25/super-one. | PR body has **`Fixes #N` / `Closes #N`** and explains red → green. |

Rules for bug fixes:

1. **Issue reference required** — no orphan bugfix PRs without an issue.
2. **Test first** — product-only patches without a regression test that failed before the fix are **not** ready (or document why impossible and get maintainer buy-in).
3. **No green without red** — do not “fix then write a test that already passes.” Confirm the new test fails on the buggy code first.
4. **One logical change** — focused PR; commit style `type(scope): subject` (English).
5. **Right layer** — tests next to the owning workspace (e.g. desktop `bunx vitest run …`, `bun run test:runtime`, relay/cli suites). See product/debug monorepo map.
6. **Secrets** — never commit API keys, tokens, or personal log dumps.

### Feature / improvement PRs

Still **issue first**, explicit yes, and **`Fixes #N` / `Closes #N`** (or `Refs #N` if the PR only partially addresses the issue).

- Add or extend automated tests for the **new** behavior (they should fail before the feature lands, then pass — same red–green discipline where practical).
- Keep the PR scoped to the issue; avoid drive-by refactors.
- Same commit style and secrets rules as above.

### PR body template

```markdown
### Summary
<!-- what this does; one or two sentences -->

### Red (tests)
<!-- path to test file; how it failed before the change (bugs) or covers new behavior (features) -->

### Green (change)
<!-- minimal description of the production / docs change -->

### How to verify
<!-- e.g. bunx vitest run path/to/repro.test.ts -->

Fixes #N
```

(`Fixes #N` / `Closes #N` is **required** when the PR fully resolves the issue. Use the real issue number from step 1.)

### If they cannot run the full suite

Still require a **targeted** automated test for this change. Running only that file is fine for the red–green loop; mention any broader suites not run in the PR.
