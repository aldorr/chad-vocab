# Chad Vocab

Open-source, self-hosted vocabulary trainer built for **Chad** while he learns **Polish** from English cues.

- **English → Polish** (or any language pair you set)
- **Type or speak** — spoken answers go through local [Scriberr](https://github.com/rishikanthc/Scriberr) (Whisper)
- **Fuzzy grading** — [LM Studio](https://lmstudio.ai/) + an open model such as **Gemma** accepts near-misses
- **Photo → deck** — Gemma vision reads a textbook page; you review before import
- **Optional accents** — [ElevenLabs](https://elevenlabs.io/) TTS / Scribe per account (bring your own API key)
- **Mastery queue** — needs-practice first; learned cards rare; last 5 mixed with review

Live demo (while the host machine is awake): [https://vocab.aldorr.net/](https://vocab.aldorr.net/)

MIT licensed. Self-host forever — a later hosted free/paid offering (if any) does not close the source.

## Quick start

### Requirements

- Node.js 20+
- [Scriberr](https://github.com/rishikanthc/Scriberr) running locally (Homebrew: `brew tap rishikanthc/scriberr && brew install scriberr`)
- [LM Studio](https://lmstudio.ai/) with an open model loaded (Gemma recommended) and the local server started
- **Photo → deck:** a **Gemma 3 (or newer) vision** model in LM Studio — look for **Vision Input** in the catalog (e.g. `gemma-3-4b-it`, 12B). Text-only Gemma cannot read textbook photos.

### Install

```bash
git clone https://github.com/aldorr/chad-vocab.git
cd chad-vocab
cp .env.example .env
npm install
```

Edit `.env`:

1. Create an API key in the Scriberr UI (`http://localhost:8080`) → set `SCRIBERR_API_KEY`
2. Confirm `LM_STUDIO_URL` (default `http://127.0.0.1:1234/v1`) and `LM_STUDIO_MODEL`
   - For photo scan, set something vision-capable, e.g. `LM_STUDIO_MODEL=gemma-3-4b-it`
3. Optional: set `INVITE_CODE` so only people with the code can register
4. Public demo tunnel: set `REGISTRATION_ENABLED=false` and seed Chad with `npm run seed:chad`

### Optional: ElevenLabs word audio + speak answers

On **Progress**, each person can paste their own ElevenLabs API key (needs Text to Speech, Speech to Text, Voices Read, Models Read) and pick voices. Instant Voice Clones and Voice Library voices are not usable via the API on the free plan.

New imports then generate MP3 clips automatically; practice generates a silent card on the fly. With a key saved, spoken answers use ElevenLabs Scribe first (falls back to local Scriberr/Whisper).

Changing a voice does not wipe the deck. Use **Regenerate** on a card when you want new clips (that spends characters again).

### Run (development)

```bash
# Terminal A
scriberr

# Terminal B — LM Studio: load Gemma, start server

# Terminal C
npm run dev
```

- App UI: http://localhost:5173  
- API: http://localhost:3001  

### Production-ish (single process)

```bash
npm run build
npm start
```

Serves the built client from the API on `PORT` (default 3001).

### Demo account (optional)

```bash
npm run seed:chad
```

Creates username `chad` (English → Polish) with a short starter deck. Password is written to `.demo-credentials` (gitignored).

Set `REGISTRATION_ENABLED=false` so a public tunnel cannot accept new sign-ups. Leave it unset or `true` for household multi-user self-hosting.

## Optional: faster speak answers

Scriberr’s default WhisperX path can take **minutes** on CPU for a short clip. Chad Vocab waits up to 4 minutes and shows a progress label. If speak times out, the button cools down for 60s (`Try again`) so you can keep typing.

To speed things up in Scriberr’s UI, prefer a smaller Whisper model / faster profile for quick transcription when available. Env hints in `.env`:

```bash
SCRIBERR_MODEL=tiny
SCRIBERR_TIMEOUT_MS=240000
```

## Import format

One pair per line. **Learning language first**, then cue language:

```text
cześć | hello
dziękuję | thank you
proszę | please
```

Separators: `|`, tab, or comma.

## Scan a textbook page (photo → deck)

On **Deck**, use **Take photo** / **Choose image**. The API sends the picture to your local Gemma vision model and returns candidate pairs — you **always review/edit** before import. Nothing is written to the deck until you confirm.

Tips for better extraction:

- Prefer **JPEG/PNG** — the app re-encodes camera photos to JPEG before upload
- Crop tightly to the vocab list, but leave a little **margin** — vision models often resize to ~896×896 and can clip edge lines
- One clear page/list per photo works better than busy multi-column spreads
- Fix misreads in the review table; uncheck junk rows
- If LM Studio logs `ffprobe failed` / `Channel Error`, install ffmpeg (`brew install ffmpeg`), **restart LM Studio**, and try a fresh JPEG/PNG or a screenshot
- On a phone, keep the tab open — scanning is async and can take 1–3+ minutes while Gemma reads the page; the UI polls until results are ready

Photos never leave your machine (same local LM Studio path as fuzzy grading).

## Let family join from other devices

Keep the app + AI on your machine; expose only the app URL.

### Option A — same Wi‑Fi / LAN

1. Find your Mac’s LAN IP (System Settings → Network)
2. Run `npm run dev` or `npm start`
3. Family opens `http://YOUR_LAN_IP:5173` (dev) or `http://YOUR_LAN_IP:3001` (production)

You may need to allow incoming connections in the firewall.

**Note:** Browsers block the microphone on plain `http://` LAN addresses (phones especially). Typing still works; for **Speak**, use Option B’s HTTPS tunnel URL.

### Option B — Cloudflare Tunnel (recommended off-LAN)

1. Install [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/)
2. Start the app (`npm start` on port 3001, or Vite on 5173)
3. Point a named tunnel at the app only (example hostname: `vocab.aldorr.net` → `http://localhost:3001`)

Do **not** tunnel Scriberr (`:8080`) or LM Studio (`:1234`) — the API calls them on localhost.

Optional: set `COOKIE_SECURE=true` in `.env` when serving only over HTTPS.

## Project layout

```text
client/   Vite + React UI
server/   Hono API + SQLite
data/     Database + audio (gitignored)
```

## Hacktoberfest / open AI

Built for private, local open-weight inference: Scriberr for STT fallback, Gemma via LM Studio for grading and textbook photo OCR. Optional ElevenLabs (bring-your-own key) provides educational TTS voices and faster Scribe speech-to-text when configured. Why open matters: without a cloud key, speech answers and page photos stay on your laptop; swap models anytime.

## Roadmap

1. **Now** — Chad’s Polish MVP on a household laptop  
2. **Next** — gamification (leaderboards, play modes)  
3. **Later** — optional hosted tiers (free: text-only, 50 words) while remaining open source for self-hosters  
