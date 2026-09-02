# Client memory benchmark

`scripts/bench/` measures how much RAM the app costs a member's browser, per scenario, so a
change that claims to reduce memory can be held to it. It drives real Chrome with Playwright
and reads the numbers from the OS — the interesting memory (WebRTC decode buffers, decoded
`AudioBuffer`s, image bitmaps) never appears on the JS heap, so `performance.memory` would miss
almost all of it.

## Run it

```bash
docker compose -f compose.dev.yaml up -d
bun run build && PORT=3000 bun run preview      # port 3000 — see "Ports" below
node scripts/bench/memory.ts seed               # once per database
node scripts/bench/memory.ts run --label before
# …make the change, rebuild…
node scripts/bench/memory.ts run --label after
node scripts/bench/memory.ts compare before after
```

Results land in `.data/bench/results/<label>.json` (gitignored). `--only chat` or `--only call`
runs half the suite; `--headed` shows the browsers.

## Scenarios

| name                   | what it holds                                                         |
| ---------------------- | --------------------------------------------------------------------- |
| `idle`                 | signed in, the quietest channel open — a floor, but not a zero        |
| `chat`                 | #bench-chat scrolled back until the 150-message render window is full |
| `voice-notes`          | #bench-audio: 8 × 30 s voice messages, all mounted                    |
| `call-audio`           | two members in a voice channel, microphones only                      |
| `call-video`           | the other member's camera on, tile on screen                          |
| `call-video-offscreen` | same call, but reading a text channel — the tile is unmounted         |
| `call-video-return`    | back in the call view — the guard that a paused stream resumes        |
| `no-call-same-channel` | that same text channel, call hung up — the control for the pair       |

The `call-*` numbers come from one browser session in sequence, because that is how a member lives
it; they are cumulative, not independent.

### Read the call pair as a difference, never alone

`call-video-offscreen` is a member in a call, reading a text channel. Its absolute number mixes two
things: what the call still costs with nothing rendering it, and what that text channel costs. A
change that makes _channels_ cheaper moves it just as far as one that makes _calls_ cheaper, so on
its own it can credit the wrong fix — which is exactly what happened when v0.24.0 was first
measured.

`no-call-same-channel` is the control: same session, same channel, same DOM, call hung up from the
sidebar. Subtract it, and the channel cancels:

```
what an unrendered call costs  =  call-video-offscreen  −  no-call-same-channel
```

`run` and `compare` both print that difference under "held by the call while nothing renders it".
That is the line to quote for anything touching subscription or track quality; `gpu` in it is where
WebRTC decode buffers show up.

One wrinkle: the two halves are two visits to the same channel, not a byte-identical DOM (node
counts have differed by ~1 000 between them), so `total` and `renderer` in that difference are good
to a few MB. `gpu` holds no DOM and is unaffected — prefer it.

## What the numbers mean

`total` is the private commit of the whole Chrome process tree — browser, renderers, GPU,
utilities. `renderer` is where DOM, JS heap, decoded images and audio live; `gpu` is where
WebRTC video decode buffers live. `js heap`, `nodes` and `listeners` come from CDP for the
measured page only, as supporting evidence.

Each measurement forces a GC, waits for Chrome to settle, then takes the median of three OS
reads. Expect ±2% run to run; treat anything smaller than that as noise.

## Ports

The call scenarios need the app on **port 3000**. The voice roster is built from LiveKit
webhooks and `livekit.dev.yaml` posts them to `host.docker.internal:3000`; on any other port
the call view renders no tiles at all — media still flows, but there is nothing on screen to
measure. The bench prints a warning if `--base` is not `:3000`.

## Comparability

- Same build mode on both sides. A dev server carries HMR, source maps and unminified chunks;
  its absolute numbers are ~1.5× a production build's and noisier. `mode` is recorded in every
  result file and `compare` shouts if the two disagree.
- Same seeded content. `seed` is idempotent and records what it made in `.data/bench/seed.json`;
  reseeding with `--force` appends more history and invalidates older baselines.
- Same machine, nothing heavy running alongside. The measured browser is the only one sampled,
  but a busy machine still moves the numbers.

## What it has caught so far

v0.24.0's three memory fixes were measured with it — busy channel −28% renderer, voice notes −17%,
and an unrendered call's GPU decode buffers −69% (19.2 → 6.0 MB, read off the pair above), with the
numbers and the caveats in
[progress/verification.md](progress/verification.md). Read that section before trusting a small
delta: the noise floor was established by running the same baseline twice, and `gpu` in particular
moves ±7% on its own.
