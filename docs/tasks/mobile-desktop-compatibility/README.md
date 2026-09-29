# Minimum desktop version for mobile connections

Status: planned · Updated: 2026-09-30
Goal: Give the mobile app an explicit supported desktop-version range and a clear upgrade path for older hosts.
Long-term docs affected: [mobile-remote-control.md](../../architecture/mobile-remote-control.md), [transport.md](../../../apps/mobile/docs/agent-reference/transport.md)

## Agreed policy

The mobile app should have a minimum supported desktop version. Keep and test
protocol fallbacks needed by versions inside that range; compatibility does not
mean supporting every desktop release indefinitely. Hosts below the floor should
receive a clear upgrade-required outcome instead of partial session failures.

This task is planning only. The user requested completion of the documentation
cleanup first; no connection gate, floor constant or protocol change is included.
Physical-device smoke remains advisory and is recorded in the mobile release
manual/skill, so it is no longer an open policy decision.

## Current behavior

The relay/LAN connection path does not convey a desktop application version for
this check. `StartupData.appVersion` belongs to desktop startup IPC, not the
mobile handshake. `restoreSession` supports subscriptions with or without the
progressive history page/snapshot. Existing restore tests retain that coverage.

## Implementation scope

1. Define the authenticated host-version/capability payload for both LAN and
   relay. Bind it to the active host/connection generation; a relay socket alone
   is not evidence that the desktop is present or compatible.
2. Choose the concrete minimum desktop version from the release that establishes
   the required protocol contract. Define stable/alpha/dev comparison and the
   behavior of missing or malformed versions before adding the gate. Do not
   guess a version from an unversioned peer.
3. Gate session loading and mutation before entering the connected workspace.
   Show current/minimum versions where known and an upgrade action. Preserve
   pairing data, offline drafts and the ability to reconnect after upgrading.
   Incompatibility must not enter a repeated network-retry loop.
4. Publish version-reporting desktop support before a mobile build/OTA enforces
   the floor, or explicitly define a transition probe for supported older hosts.
5. Keep fallbacks required by supported versions and remove obsolete ones only
   when the floor makes them unreachable. Update long-term docs with actual
   behavior and delete this task folder when implemented.

## Verification

Cover below/equal/above-floor versions, prerelease/dev builds, unknown versions,
LAN/relay parity, offline relay peers, reconnect/transport switch, stale host
replies and preserved drafts. Keep cold/cached legacy restore, modern bootstrap
and failure-buffer cleanup tests. Add connection-screen stories/native preview
states and verify the upgrade-required flow before release.

## Decisions needed when implementation begins

- Concrete desktop floor and treatment of development/prerelease versions.
- Transition behavior for desktops that predate version reporting.
- Where the floor is owned and how a future release advances it.
