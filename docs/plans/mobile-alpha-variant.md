# Mobile alpha variant

## Problem

Android has one self-updating APK and one pointer (`mobile/android/latest.json`).
Build 36 carries `MIN_PHONE_DESKTOP_VERSION = 0.73.0-alpha.1`
(`packages/relay-client/src/phone-version.ts`), which no stable desktop satisfies
(stable is 0.72.2), so every Android user on a stable desktop auto-updated into
a phone that refuses to connect. Android cannot downgrade a `versionCode`, so
re-pointing `latest.json` only protects phones that have not updated yet. iOS
has the same exposure: one TestFlight app and one OTA channel for everyone.

Stores make it worse, not better: auto-update and review delays slow any
rollback. The phone needs the desktop's split.

## Decision

- Mirror the desktop's variant model on both platforms: two application ids,
  not one id on two channels, so one phone can hold both and talk to an alpha
  and a stable desktop at the same time.
- The existing ids stay **stable** (they are what the store listings use).
  Alpha is `<id>.alpha`, "SuperOne Alpha", scheme `superone-alpha`, EAS channel
  `alpha`. On iOS it is a second App Store Connect app, TestFlight only.
- A stable phone must never require a desktop newer than the released stable
  desktop. `release-mobile.yml` refuses to queue a stable build when
  `MIN_PHONE_DESKTOP_VERSION` is above `stable/desktop-mac.yml`.
- Each new Android tag gets a GitHub Release with the APK as an archive. Live
  links (desktop download/QR) read the R2 pointers, not GitHub.

## Steps

- [x] `app-variant.js` variant table; `eas.json` `alpha` profile;
      `assert-release-config.ts` covers both.
- [x] `@superone/shared/mobile-updates` track-aware keys; `update-ports.ts`
      track from `Updates.channel`.
- [x] `publish-mobile-update.ts` `--track`, `--check-stable-floor`.
- [x] `release-mobile.yml` / `update-mobile.yml`: alpha on both platforms by
      default, per-track concurrency, tags, floor check, build-profile guard,
      rollback flag, Android GitHub Release.
- [x] Docs: `native-builds.md`, release skill.
- [x] Android: first alpha APK (build 36) built by CI; EAS generated the
      keystore non-interactively.
- [x] iOS: "SuperOne Remote Alpha" app in App Store Connect
      (`6821560971`, `submit.alpha.ios.ascAppId`); alpha icon with the desktop's
      ALPHA badge.
- [x] iOS: first alpha build (36) built locally with credentials and
      submitted; alpha iOS CI runs without a public link, skipping its manifest.
- [x] iOS: alpha public link set as the `TESTFLIGHT_URL_ALPHA` repository
      variable; the next alpha iOS run publishes `mobile/ios/alpha/latest.json`.
- [x] Incident: stable Android `latest.json` re-pointed to build 34, built
      from v0.72.2's own commit. Build 35 already carries the per-phone channel
      (`d9b3d29dd`, BREAKING), which v0.72.2 cannot serve.
- [ ] Stable desktop 0.73.0, then the stable cut publishes both stable apps
      (recovers the phones already on stable build 36).
- [ ] Tell alpha-desktop users to install "SuperOne Alpha" and re-pair.
- [x] Desktop: Settings → Remote Control → Mobile App, install QR codes for the
      desktop variant's phone track, read from the R2 pointers in main.
- [x] Stable iOS manifest rolled back to build 34 (`build_id`, manifest only).
- [ ] When done: delete this plan (the design already lives in
      `native-builds.md` and the release skill).
