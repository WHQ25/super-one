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
- [ ] Android: create the alpha keystore (`eas credentials -p android`, alpha
      profile, interactive) before the first CI alpha build.
- [x] iOS: "SuperOne Remote Alpha" app in App Store Connect
      (`6821560971`, `submit.alpha.ios.ascAppId`); alpha icon with the desktop's
      ALPHA badge.
- [ ] iOS: first build credentials with `eas credentials -p ios` (alpha
      profile, interactive); add an external TestFlight group (Beta App Review
      once) and set `TESTFLIGHT_URL_ALPHA` in `release-mobile.yml` to its
      public link.
- [ ] Incident: re-point stable Android `latest.json` to build 35
      (`release-mobile.yml` `build_id`, `android_profile=internal`) until stable
      desktop 0.73.0 ships; then the stable cut publishes both stable apps.
- [ ] First alpha builds; tell alpha-desktop users to install "SuperOne Alpha"
      and re-pair.
- [ ] Desktop: Android/iOS download links and QR codes, read from the R2
      pointers (`artifact.url` / `testflightUrl`).
- [ ] When done: delete this plan (the design already lives in
      `native-builds.md` and the release skill).
