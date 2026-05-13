# CLAUDE.md — apps/video (Remotion)

Remotion entry that mounts compositions from `@superone/video-compositions`. The actual scenes (`ChatStream`, `ToolBlockScene`, …) live in `packages/video-compositions/src/`. The chat streaming reveal logic that all chat scenes share lives in `packages/desktop-mocks/src/desktop/chat-mock.tsx`.

## Streaming reveal — render token-by-token, not character-by-character

When mocking an LLM streaming its response (any scene that gradually reveals assistant text), the reveal must look like a real model: **chunks of multiple characters appear at once, with uneven inter-chunk gaps**. Do not advance one character per tick — that produces an unnaturally smooth typewriter effect that immediately reads as fake.

**Why this matters**

A real model emits tokens, not characters. Each token is typically:
- ~1 Chinese character (CJK)
- ~3–6 Latin characters (one wordpiece)
- 1–2 characters for punctuation / code symbols

And token arrival is bursty — the network + decoder produce visible jitter between tokens (tens of ms to a few hundred ms), occasionally pausing for longer on harder predictions. A perfectly even per-character interpolation has none of that texture, so the eye reads it as a CSS animation rather than as generation.

**What is currently wrong**

`packages/desktop-mocks/src/desktop/chat-mock.tsx`:

- L248: `const durationMs = total === 0 ? 0 : (total / opts.typingCps) * 1000` — duration computed in characters-per-second.
- L258: `const chars = Math.max(1, Math.floor(total * ratio))` — `chars` advances continuously with `frame`, one character per ~`fps / typingCps` frames.
- L175 / L222: `text.slice(0, chars)` — slices at character granularity.

Result: at `typingCps=90` and `fps=30`, each frame reveals exactly 3 characters with zero jitter. Too smooth.

**What to do instead**

Quantize the reveal to token boundaries with realistic jitter. Two layers:

1. **Tokenize the target text once** (memoized, deterministic) into an array of chunks. A cheap approximation that matches a real BPE tokenizer well enough visually:
   - Split CJK into 1-char tokens.
   - Split Latin runs into 3–5 char chunks (prefer word boundaries — slice on whitespace, then chunk long words).
   - Punctuation, single symbols, newlines: their own 1-char tokens.
   - Markdown fences / code: chunk by symbol (` ``` `, `\n`, identifiers as 1 token, operators as 1 token).
   - The output is a `string[]` whose `.join("")` equals the original text.

2. **Schedule each token's arrival time** deterministically from `(messageId, tokenIndex)` so it's stable across frames and renders (Remotion requires determinism). Around a mean inter-token delay derived from `typingCps`, add per-token jitter and occasional long pauses:
   - `meanMs = 1000 / (typingCps / avgCharsPerToken)` — keep `typingCps` as the **user-visible knob** but treat it as characters-per-second of the underlying text, not as a render rate.
   - `delayMs = meanMs * lerp(0.4, 1.8, hash01(messageId, i))` — uniform-ish jitter.
   - Every ~12–20 tokens, inject a longer pause (e.g. `meanMs * 3–5`) to mimic the model "thinking" before a sentence boundary.

   Then `tokenEndMs[i] = streamStartMs + sum(delayMs[0..i])`. At the current `frame` time, reveal tokens whose `tokenEndMs <= currentMs`, i.e. `visibleText = tokens.slice(0, k).join("")` for the largest `k` satisfying the predicate.

   Use a small seeded hash (e.g. mulberry32 seeded by a string hash of `messageId + ":" + i`) — never `Math.random()`. Remotion renders the same frame many times across preview / render / scrubbing, and any non-deterministic source desyncs them.

**Knob semantics (preserve `typingCps` as the public prop)**

`ChatStreamProps.typingCps` and `ChatMockProps.typingCps` stay the same — externally they still describe characters-per-second on average. Internally the math just changes from "advance N chars / frame" to "schedule M tokens whose average size × rate ≈ N chars / sec". Total reveal duration should still be `≈ totalChars / typingCps`, so existing `CHAT_STREAM_DURATION_IN_FRAMES` budgets remain valid.

**Caret blink**

Keep the caret. With token chunking the caret will now sit still between tokens (instead of crawling across the line every frame) and jump forward when the next token lands — which is exactly how Claude/ChatGPT/Codex CLIs feel.

**Where this rule applies**

Anywhere a frame-driven `text.slice(0, chars)` pattern reveals assistant text:

- `packages/desktop-mocks/src/desktop/chat-mock.tsx` (`revealBlock`, `revealMessage`, `computeReveal`)
- Any future scene that streams its own block outside `ChatMock` (subagent transcripts, plan text, thinking blocks)

User-typed input does **not** follow this rule — those are typed by a human and a smoother per-keystroke reveal is fine (and arguably more honest).

## Conventions specific to this app

- Compositions are declared in `src/Root.tsx`; props default values live next to each scene in `packages/video-compositions/src/<Scene>/index.tsx` as `xxxDefaultProps`.
- `BrandScope` must wrap any chat / desktop-shell preview so the brand-hue tokens are stamped (see root `CLAUDE.md` → "brand-hue 在 React 钩子外失效" — Remotion is a non-React-app consumer, so the entry must inject hue manually via `BrandScope`, which the scenes already do).
- All randomness must be seeded by deterministic inputs (messageId, frame index, props). Never call `Math.random()` / `Date.now()` / `crypto.randomUUID()` inside a composition.
