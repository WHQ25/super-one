# Expo release runbook

Status: **Android APK/OTA emulator-verified; iOS build 21 ready for internal TestFlight; physical release pending**
Plan: `docs/design/flutter-to-expo-migration-plan.md` WP-29

The release owner completed Apple Developer login/2FA and let EAS manage the signing
assets. The first Expo iOS production build used build number 4, but App Store Connect
already contained Flutter build 20. EAS remote versioning was therefore advanced and
iOS production build `35d269c4-164e-4865-9cce-4fa47b86aa01` (version 1.0.0,
build 21) finished on 2026-09-04. App Store Connect app `6761263268` exists and its
numeric `ascAppId` is pinned in the production submit profile.
Production update group `25c7b31b-47a2-4c0a-abde-57220f3b1411` publishes commit
`19ad04e3` for Android and iOS at runtime `1.0.0`, matching iOS build 4. It includes
the Flutter-aligned reconnect, peer-return, shutdown, and terminal recovery behavior.
Android internal update group `7dc306ae-166f-4a4e-9053-53a1507a8aee` publishes the
same runtime code to the existing installable APK channel, so manual Android testing
does not require another binary build.
Build 21 uses runtime `1.0.0`; no mobile runtime source changed after the latest
production update. EAS generated a least-privilege App Manager API key and keeps its
private material on the credentials service. Submission
`e9fd75c9-1ec2-4eb7-9fe7-c9f46d85a4a8` uploaded build 21 successfully. App Store
Connect reports `VALID` / `READY_FOR_BETA_TESTING`, so it is ready to assign to
internal testers. The obsolete build 4 submission failed as expected because its
build number was lower than the Flutter baseline. Never download, commit, or paste
the private key into chat.

Run EAS commands from `apps/mobile`. Keep `credentials.json`, signing files, build
artifacts, screenshots, and videos out of git.

1. Authenticate the release owner and link the intended Expo project. Review the
   generated project id instead of accepting a duplicate project.
2. Configure signing and `expo-updates`; keep app version as the runtime compatibility
   boundary and regenerate native projects after config changes.
3. Run `bun test`, `bunx expo install --check`, and `bunx expo config --type public`.
4. Build the Android internal APK and iOS production artifact:
   `bunx eas-cli build --platform android --profile internal` and
   `bunx eas-cli build --platform ios --profile production`.
5. Install the APK, submit the iOS artifact to TestFlight, and complete the physical
   smoke checklist. Run the 10-second airplane-mode recovery manually; simulator
   automation is not used for this timing-sensitive gate.
6. Publish one matching EAS Update and verify that both installed builds receive it.
7. Archive `super-one-flutter` read-only after both platform smokes pass.
