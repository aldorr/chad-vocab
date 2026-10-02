# Family Vocab — Hacktoberfest Weekend Challenge draft

**Tag:** `#hf26challenge`  
**Prize categories:** Best Use of Gemma · Best Use of Entire

## Summary

Family Vocab is a self-hosted, multi-user vocabulary trainer for people learning *any* language pair. Each family member gets their own account, deck, history, and points. Cues can be shown as text or played from your own recorded voice; answers can be typed or spoken. Spoken answers are transcribed with open Whisper via **Scriberr** on the host machine. Near-miss grading uses **Gemma** (or another open model) through **LM Studio**.

## Who it’s for

Our family and friends learning languages together — starting with Spanish from German cues, but each profile can set English→French, etc.

## Why open matters

- Speech and answers never leave the household laptop
- No cloud AI subscription to practice
- Swap models in LM Studio without rewriting the app
- MIT license + self-host docs so others can run the same stack

## Stack

- Vite + React UI, Hono API, SQLite
- Scriberr (`openai_whisper` / WhisperX) for STT
- LM Studio + Gemma for fuzzy grading
- Cloudflare Tunnel (optional) so family can join remotely without exposing AI ports

## Demo steps

1. Register → set cue/answer languages  
2. Import `hola | hallo` list  
3. Practice typing; wrong → reveal; right ×3 → learned  
4. Speak an answer (Scriberr on)  
5. Show points on Progress  

## Links

- Repo: *(add after push)*  
- Live demo: tunnel URL or LAN  
- Agent session (Entire / DevRelay): *(embed after submit_agent_session)*  
