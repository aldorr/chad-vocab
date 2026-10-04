# Chad Vocab — Hacktoberfest Weekend Challenge draft

**Tag:** `#hf26challenge`  
**Prize categories:** Best Use of Gemma · Best Use of ElevenLabs · Best Use of Entire

## Summary

Chad Vocab is a self-hosted vocabulary trainer built for **Chad** while he learns **Polish**. English cues, Polish answers. Each card can be typed or spoken. Spoken answers use optional **ElevenLabs Scribe** when a key is set, otherwise open Whisper via **Scriberr**. Near-miss grading uses **Gemma** through **LM Studio**. Textbook photos go through Gemma vision and are reviewed before import.

## Who it’s for

Chad — a friend learning Polish.

## Why open matters

- Speech and textbook photos never leave the household laptop
- No cloud AI subscription required to practice
- Swap models in LM Studio without rewriting the app
- MIT license + self-host docs so others can run the same stack

## Demo

- Live: https://vocab.slotify.work/
- Username: `chad`
- Password: see `.demo-credentials` (not in git)

## Stack

- Vite + React UI, Hono API, SQLite
- Scriberr (`openai_whisper` / WhisperX) for STT
- LM Studio + Gemma for fuzzy grading and photo OCR
- Optional ElevenLabs (per-account key) for accented TTS / Scribe

## Links

- Repo: https://github.com/aldorr/chad-vocab
- Live demo: https://vocab.slotify.work/
