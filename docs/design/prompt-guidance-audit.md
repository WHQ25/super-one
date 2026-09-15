# SuperOne prompt guidance audit

Based on OpenAI's [Rethinking skills and prompts for GPT-6 Astra](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra), published September 11, 2026. Audit performed September 14, 2026.

## Decisions

- **Skill discovery:** narrow descriptions to the actual task. A repository containing
  shadcn configuration should not activate UI guidance for unrelated work. Release
  guidance applies to SuperOne's release workflows, not every use of “publish”.
- **Progressive disclosure:** make tool, harness, and shadcn entrypoints routers.
  Keep protocol, permission, and integration detail in task-specific references.
  Release already had desktop/mobile routing, so retain that structure.
- **Tool selection:** reuse known ids and relevant manual content. Keep follow-up
  tool names and terminal result conditions explicit. A video job id is not a
  completed video; polling remains necessary to save the result.
- **Completion:** continue authorized implementation through relevant verification.
  Mini-app setup can choose routine defaults from the request and project context;
  ask about unresolved requirements or visibility choices that change the result.
- **Boundaries:** preserve host confirmations, feature gates, main-thread-only
  tools, cancellation semantics, and installation trust. Removing redundant prose
  does not grant additional execution permissions.
- **Prompt maintenance:** share 39 exported tool/field description constants between
  desktop and remote descriptors. Split the 3,112-line remote catalog into family
  modules, preserving its order and public export.

## Changed surfaces

| Surface | Change |
|---|---|
| `.agents/skills/{superone-tool,superone-harness,shadcn,release}` | Precise descriptions; conditional reference routing; retain invocation metadata |
| `packages/shared/src/superone-system-prompt.ts` | Move note-writing detail to the existing memory manual; add completion boundary; make widgets and renaming task-driven |
| `apps/desktop/src/main/agent/superone-system-prompt.ts` | Condense Codex plan status guidance without changing its completion requirement |
| `packages/shared/src/superone-tool-descriptions.ts` | Shared description source for desktop and remote tool/schema registration |
| `apps/desktop/src/main/mcp/guides/overview.md` | Mini-app defaults, scope decisions, and completion criteria |
| `apps/desktop/src/main/mcp/guides/media/overview.md` | Provider-task routing and common result contract |
| `apps/desktop/src/main/mcp/guides/product/show-your-work.md` | Remove an introductory blanket capture expectation that conflicted with selective evidence guidance |
| `apps/desktop/CLAUDE.md` | Align the full-suite rule with the root policy: only when explicitly requested |

Entrypoint source size (characters, not tokens; references load separately):

| Skill | Before | After |
|---|---:|---:|
| superone-tool | 31,755 | 2,327 |
| superone-harness | 14,550 | 1,902 |
| shadcn | 18,020 | 2,044 |
| release | 5,643 | 5,214 |

These measurements describe loading size, not a measured latency or quality gain.
The shared system-prompt source decreased from 5,474 to 5,028 characters.

## Retained constraints

The vendored dsh/Cordis presets and their skills retain their upstream runtime
contracts. Their host/preset separation, service isolation, and mount-validation
rules address concrete failure modes; changing them requires runtime evidence.
Provider-specific media options, device state/permission rules, collaboration
launch approval, and release execution checkpoints were not relaxed. No model
selection, permission implementation, or tool input requirements changed.

## Validation

- 207 tests passed across built-in descriptor parity, manual routing, shared system
  prompt, Codex turn injection, ACP host context, OpenCode runtime, and browser tools.
- Desktop main-process TypeScript check passed.
- All 56 non-memory remote descriptors retain names, order, schemas, and metadata
  compared with HEAD, excluding description text. Memory descriptors still use the
  same shared spread.
- Edited skill entrypoint and new reference links resolve; frontmatter keys and
  non-description values are preserved.
- The generic skill validator passes tool and harness skills. It rejects existing
  release/shadcn extension keys (`arguments`, `argument-hint`, `compatibility`,
  `user-invocable`); those were retained rather than changing invocation behavior.
- `git diff --check` passed. No full test suite or live model behavior evaluation
  was run.

A future behavioral comparison should use the same model/settings and tasks:
mini-app creation with an already specified scope, a narrow tool-description edit,
an archive lookup with a known session id, media generation through terminal status,
and a non-UI task in this repository. Compare unnecessary manual reads, repeated
questions, premature stopping, and successful completion; keep permission checks
identical in both variants.

## Project memory follow-up

The subsequent [project memory audit](../development/project-memory-audit.md)
covers all 14 repository-owned `AGENTS.md` / `CLAUDE.md` entrypoints, their
conditional references, and source-verified corrections. It supersedes this
initial audit's limited project-memory coverage.
