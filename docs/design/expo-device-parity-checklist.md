# Expo release smoke checklist

Status: **physical-device smoke pending**
Plan: `docs/design/flutter-to-expo-migration-plan.md` WP-29

Run once with release-mode builds on one physical iPhone and one physical Android.
Record the short result under gitignored `docs/temp/`; screenshots and videos never
enter git.

- [ ] Scan the desktop QR, pair, relaunch, and restore the pairing.
- [ ] Open a session, send a prompt, watch it stream, and stop mid-stream.
- [ ] Enter Chinese Pinyin; Return never submits a partial composition.
- [ ] Complete one permission, AskUserQuestion, and plan approval sheet.
- [ ] Disable networking for 10 seconds mid-stream; rehydrate once without duplicates.
- [ ] Claim a terminal, run `pwd`, and render its output.
- [ ] Attach one image and receive one shared file.
- [ ] On iPad at ≥768 pt, rotate with a sheet open; master/detail remains intact.
- [ ] Run the 200-turn corpus once and confirm peak RSS stays below 250 MB.

If RSS exceeds the limit, tighten the 24/40 DOM window and repeat the single run.
