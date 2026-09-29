# Mobile open decisions

Status: planned · Updated: 2026-09-30
Goal: Settle two mobile policies where the docs and the shipped process disagree.
Long-term docs affected: [native-builds.md](../../../apps/mobile/docs/agent-reference/native-builds.md), [mobile-remote-control.md](../../architecture/mobile-remote-control.md), [release skill](../../../.agents/skills/release/references/mobile.md)

## 1. Physical-device smoke before release

`native-builds.md` lists a device smoke for native releases, but the release
skill does not run it, and builds 22–29 shipped without a smoke record. The
manual now calls the list a recommendation. Decide whether it becomes a release
gate (add a step to the release skill) or stays advisory.

## 2. Compatibility with older desktop hosts

The Expo network work stated a development-stage policy of no mixed-version
compatibility, yet progressive session loading keeps a `load_session_messages`
fallback for hosts without `subscribe_session{progressive}`
(`packages/relay-client/src/restore.ts`). The long-term docs describe the
fallback as it exists. Decide whether old-host fallbacks are kept and tested, or
removed with a minimum host version.

When both are decided, record the outcome in the long-term docs above and delete
this folder.
