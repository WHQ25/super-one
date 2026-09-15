# Video guidance

Remotion mounts compositions from `@superone/video-compositions`.
`src/Root.tsx` registers scenes; scene defaults live with each composition.
Shared chat previews use `packages/desktop-mocks/src/desktop/chat-mock.tsx`.

- Frame rendering must be deterministic. Seed randomness from stable props or
  message ids; do not use wall-clock time or unseeded randomness in a composition.
- Wrap chat/desktop previews in `BrandScope` from `@superone/desktop-mocks` so
  hue-derived CSS tokens resolve in the preview scope.
- When changing assistant streaming, prefer uneven multi-character chunks over
  a smooth typewriter effect. Preserve `typingCps` as average characters per second
  and existing duration budgets. User-typed input can use keystroke animation.
  [Streaming reveal](docs/streaming-reveal.md) records the current baseline and an
  optional implementation approach; it is not work required for every scene edit.

Root commands: `bun run dev:video`, `bun run render:video`, `bun run still:video`.
Verify changed compositions at relevant frames and transitions, using seeded
inputs. Root UI-story rules apply when shared UI components change.
