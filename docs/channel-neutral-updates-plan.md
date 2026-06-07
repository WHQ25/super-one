# Channel-Neutral Updates — Design & Migration Plan

Status: **proposed / not started.** Captures how to decouple version identity from
update channel so a tested build can be promoted across channels without a rebuild.

**Validated baseline (v0.40.2-alpha, 2026-05-31):** the current decoupled pipeline —
`promote` (archive-only) + `set-latest` (writes the channel ymls + fixed links on R2)
— and end-to-end R2 auto-update are confirmed on a real device: an alpha client
updated 0.40.1→0.40.2 from `dl.super-one.dev` reading the set-latest-written
`alpha-mac.yml`, the differential download succeeded (R2 serves blockmaps correctly,
unlike the legacy GitHub path), and it relaunched into 0.40.2-alpha. This plan builds
on that proven foundation; only the version/channel **decoupling** below is unstarted.

## Why

Today the `-alpha` suffix is **both** the version identity **and** the channel, and
electron-builder bakes that channel into the ASAR's `app-update.yml` at build time.
Consequences:

1. **"Test what you ship" is violated.** A stable release is a *fresh recompile* of
   the same source with a suffix-less version — not byte-identical to the alpha
   binary that was actually tested (dependency float, timestamps, toolchain drift).
2. **No RC→GA promotion.** You cannot take one artifact and move it across channels;
   every channel transition needs a new build + version string.

Goal: version = plain monotonic semver (`0.41.0`), channel = a runtime setting +
server-side manifest pointer. Then `set-latest <version> stable` promotes the
**exact tested bits** to stable with zero rebuild ("build once, promote everywhere").

## What stays the same (already shipped)

- `promote.yml` archive-only; `set-latest.yml` publishes a version to a channel with
  cascade + fixed links + rollback (`scripts/set-latest.ts`, `scripts/lib/channels.ts`).
- Client channel override: `updateChannel` app-setting → `autoUpdater.channel`
  (`apps/desktop/src/main/updater.ts`), selector in `AppSettingsPage.tsx`.
- Server-side cascade is **what we ship today**: `set-latest` writes the target channel
  **plus every less-stable one** (`cascadeTargets` → alpha+beta+latest), so each channel's
  pointer is maintained explicitly. electron-builder *also* documents a **native
  client-side cascade** (channel=alpha reads beta+latest and picks the highest), which
  could let Phase 3 drop the server-side fan-out — but it is **not yet validated in our
  setup**. Validate it first (publish a higher version to `latest` only, confirm an
  `alpha` client picks it up) before relying on it; until then, keep server-side cascade.

## The ordering rule (linchpin)

The migration shim **must ship and reach high adoption BEFORE switching to neutral
builds.** Existing alpha users have `updateChannel = null` and rely on the baked
`alpha` channel. A neutral build bakes `latest`, so a null setting would resolve to
stable → they silently fall off alpha. The shim pins their channel first.

Note the exact mechanism: when `updateChannel == null`, `initUpdater` does **not**
override `autoUpdater.channel`, so the effective channel is the one **baked into
`app-update.yml`** (`channelFromVersion` is only the settings-UI *display* default).
The shim persists `updateChannel = 'alpha'` so a later neutral build (baked `latest`)
gets an explicit override back to alpha.

## Phases

### Phase 0 — migration shim (ship on a final `-alpha` build first)

- In `initUpdater` / app boot: `if updateChannel == null → saveAppSettings({ updateChannel: channelFromVersion(appVersion) })`.
  Today the default is computed at read-time (`updateChannel ?? channelFromVersion(...)`);
  the shim **persists** it so it survives the version losing its suffix.
- Files: `apps/desktop/src/main/updater.ts` (or app boot), `app-settings-service.ts`.
- Optional robustness: also persist the running version into `app_meta` each launch
  (`database-migrations.ts` has the table), so a later neutral build can infer "was
  on a prerelease" for users who skipped the shim build. Does **not** cover users on
  builds older than this code — see "Migration tail".
- **Wait for adoption** before Phase 1.

### Phase 1 — neutral version scheme

- Stop using `-alpha`. Versions become `0.41.0`, `0.41.1`, … single monotonic line.
- electron-builder with no suffix bakes `channel: latest` automatically; set
  `publish.channel: latest` explicitly in `apps/desktop/electron-builder.yml` to pin
  it. Verify once with `build:mac-dev` that `app-update.yml` channel = `latest`.
- `/release` skill: the channel argument no longer changes the version string — it
  only selects which channel `set-latest` publishes to.

### Phase 2 — runtime default channel

- `updateChannel == null` → default stable (= baked `latest`; just don't override).
- Remove the `channelFromVersion(appVersion)` default-inference in
  `AppSettingsPage.tsx` (meaningless once versions are neutral); default display =
  `updateChannel ?? 'stable'`.
- Existing alpha users keep `updateChannel = 'alpha'` (persisted in Phase 0) → tracked.

### Phase 3 — set-latest manifest source

- Neutral builds emit only `latest-*.yml`. `nativeYmlChannel(version)` degenerates to
  always `latest`; simplify `scripts/set-latest.ts` to read `latest-*.yml` from the
  GitHub Release regardless of target channel, then write the chosen channel's yml.
  Cascade + backfill unchanged.

### Phase 4 — UI: explicit channel + opt-in

- Widen `AVAILABLE_UPDATE_CHANNELS` (`packages/shared/src/update-channels.ts`) to all
  three once channels are populated.
- Settings shows the current channel explicitly (version no longer signals it).
- New-tester onboarding doc: "install → Settings → switch to Alpha."

### Phase 5 — RC→GA promotion (the payoff)

```
build 0.41.0 (neutral) → promote (archive) → set-latest 0.41.0 alpha   # alpha test
  …verified…
set-latest 0.41.0 stable                                               # same bits → stable, zero rebuild
```

- Split `/release` into "ship an RC" (build + `set-latest alpha`) and "promote to
  stable" (`set-latest stable` on an existing tag).

### Phase 6 — staged rollout (optional)

- `set-latest` writes `stagingPercentage` into the channel yml; gate-advance.

## Migration tail (the one irreducible risk)

Users on a `-alpha` build **older than any version-tracking code**, jumping straight
to a neutral build, can't be auto-detected and will default to stable. Mitigation:
ship the shim, wait for high adoption, then switch; accept that a small tail of very
stale users must re-toggle Alpha manually. The cost scales with tester population —
**doing this while the alpha group is small is materially cheaper.**

## Recommended sequence

Phase 0 (shim) → wait for adoption → Phases 1–4 together in one neutral release →
Phase 5 (`/release` rework) → Phase 6 if needed.
