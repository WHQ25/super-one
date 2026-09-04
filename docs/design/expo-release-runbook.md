# Expo release runbook

Status: **Android APK/OTA emulator-verified; iOS build and production OTA complete; TestFlight submission and physical release pending**
Plan: `docs/design/flutter-to-expo-migration-plan.md` WP-29

The release owner completed Apple Developer login/2FA and let EAS manage the signing
assets. iOS production build `f9243fb7-367e-4a96-b823-6e0eb9b57d9a` (version 1.0.0,
build 4) finished on 2026-09-04. The first App Store Connect submission still needs
one interactive run to create/select the app; after that, persist its numeric
`ascAppId` in the production submit profile so later submissions can be non-interactive.
Production update group `25c7b31b-47a2-4c0a-abde-57220f3b1411` publishes commit
`19ad04e3` for Android and iOS at runtime `1.0.0`, matching iOS build 4. It includes
the Flutter-aligned reconnect, peer-return, shutdown, and terminal recovery behavior.
EAS Submit still has no iOS submission record; finish the first App Store Connect
login/app setup before adding the numeric `ascAppId` to the production submit profile.

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
