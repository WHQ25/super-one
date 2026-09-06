# Paired UI smoke tests

These are manual integration checks against a real development desktop, relay,
and Expo development client. They supplement the offline Maestro suite in
`README.maestro.md`; they are not physical-device release acceptance.

## Setup

Run the normal mobile development server, not native preview:

```bash
bun --filter @superone/mobile dev --port 8083
```

Open the development client against that Metro port, connect an existing desktop
pairing, and select the test project. Keep pairing secrets out of logs and notes.
Use a separate test session. These checks make real model calls.

## Question and ownership round trip

1. From mobile, send:

   ```text
   Smoke test: only call AskUserQuestion: Approve mobile round trip? Options Confirm/Cancel. Then reply MOBILE_ROUNDTRIP_OK and my answer.
   ```

2. Select Confirm and submit. Check that the native sheet closes, the tool row
   becomes Complete, and the assistant echoes Confirm with the marker.
3. Ask another question and dismiss it. Check that the pending sheet disappears
   and the assistant receives dismissal rather than an answer.
4. Return to the session list. The desktop must regain its composer. Leaving a
   session sends `leave_session` (release plus unsubscribe); `unsubscribe_session`
   alone does not release remote ownership. The mobile runtime must be cleared
   so reconnect cannot reopen the session after navigation away.
5. From desktop, ask another marked question; open that session on mobile while
   it is pending. The same question must appear in the native sheet. Desktop
   enters observation mode while mobile controls/subscribes to the session.
6. Click desktop Disconnect. Mobile must close its sheet, return to the session
   list, and show the disconnect reason. This removes session access, not the
   device pairing. Desktop can now answer the still-pending question.
7. After desktop finishes, reopen the session on mobile. Verify there is no old
   pending sheet and that every completed turn, including the latest marker,
   appears in the transcript. Return to the list to release the session again.

## Latest validation: 2026-09-05

Android 16 / Medium Phone API 36.1 emulator, normal Metro on 8083, local relay
on 8787, development desktop on `feat/migrate-to-expo`:

- Mobile-origin Confirm: passed; `MOBILE_ROUNDTRIP_OK` and Confirm returned.
- Mobile dismissal: passed; the tool failed/dismissed and no choice was sent.
- Desktop-origin pending question restored on mobile: passed.
- Mobile Back releases ownership: passed after replacing unsubscribe with leave;
  the server records `release` with `reason: self_leave` and then `unsubscribe`.
- Desktop Disconnect with a question open: failed initially (stale sheet);
  passed after handling `session_kicked` and clearing runtime/native prompts.
- Desktop answer after taking control: passed; `HANDOFF_FIX_OK` and Confirm
  appeared on desktop. Reopening mobile did not resurrect the pending sheet.
- **Transcript restoration remains failing:** after the second desktop turn,
  repeated mobile opens show only the first turn. Server trace reports four
  history messages, `hasMore: false`, idle status, and zero pending interactions.
  Investigate the history payload and RN-to-WebView rendering path next; do not
  count this as a successful full history round trip.
- Cached session-list badges may still show Streaming after a desktop turn ends;
  list refresh is a separate follow-up.

Local diagnostic session: `5ec1a25f-b582-4f75-8e52-c1b2ca2af3d2`.
Trace evidence is in ignored `apps/desktop/event-trace.db`; screenshots/videos
remain local device-tool artifacts and must not enter Git.

Focused automated checks: `session-exit.test.ts`,
`mobile-relay-connection.test.ts`, and `runtime.test.ts`: 15 tests passed.
Mobile TypeScript check passed. Existing desktop leave-session integration
checks also passed (three focused cases).

Plan/permission live approvals, disconnect during submission, iOS paired flows,
and physical-device release acceptance remain additional coverage.
