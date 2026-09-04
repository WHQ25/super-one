# Expo release runbook

Status: **Android internal APK built and emulator-smoked; iOS signing and physical release pending**
Plan: `docs/design/flutter-to-expo-migration-plan.md` WP-29

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
   smoke checklist.
6. Publish one matching EAS Update and verify that both installed builds receive it.
7. Archive `super-one-flutter` read-only after both platform smokes pass.
