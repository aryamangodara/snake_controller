<div align="center">

# 🐍 Cross-Device Snake

**Play on your desktop. Steer with your phone.**
Scan a QR code and your phone becomes a wireless, analog joystick.

[![Play the live demo](https://img.shields.io/badge/▶_Play-Live_Demo-19c3b2?style=for-the-badge)](https://go-console-84748.web.app/)

[![PWA](https://img.shields.io/badge/PWA-installable-22d3c5?style=flat-square)](https://go-console-84748.web.app/)
[![Vanilla JS](https://img.shields.io/badge/Vanilla_JS-no_bundler-f7df1e?style=flat-square)](#-tech)
[![Firebase](https://img.shields.io/badge/Firebase-Firestore_+_RTDB-ffa000?style=flat-square)](https://firebase.google.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)

</div>

---

## 🎮 How to play

1. **Host** — open the [demo](https://go-console-84748.web.app/) on a computer. A glowing QR code + 6-digit code appears.
2. **Connect** — scan the QR with your phone camera (or type the code). It **auto-connects** — no app, no install.
3. **Play** — tap **▶** to start, then tilt the joystick to steer. Push further to go faster.

> The snake **never stops** — you steer it at any angle (not just up/down/left/right), and speed scales with how far you push the stick. Eat food quickly to build a 🔥 **combo** (up to ×6) before the streak timer drains.

---

## ✨ Features

- 📱 **Phone-as-controller** — a custom touch joystick streamed to the desktop in near real-time over Firebase.
- 🎯 **Analog, continuous-angle movement** — steer by angle; magnitude controls speed. No grid-snapping.
- ⚔️ **2–3 player versus** — friends scan the *same* QR to join; one shared fruit, distinct snake colors, bite a rival and *you* die — **last snake standing wins** ("I defeated…" bragging cards included).
- 🔥 **Combo streaks** — chain quick eats for a score multiplier, shown as a draining yellow timer badge.
- 🎆 **Juice** — particle bursts, ripples, floating score pops, and screen shake on impact.
- 🔊 **Synthesized sound** — Web Audio SFX whose pitch climbs with your combo; one-tap mute.
- 🏆 **Global leaderboard** — pick a handle and compete worldwide; see "You ranked #N globally" after every run.
- 📳 **Haptics + loss flash** — the phone buzzes on loss (Android; best-effort iOS) with an on-screen shake where it can't.
- 🤳 **Flex your score** — share to WhatsApp, X, Facebook, or Instagram straight from your phone.
- ⚡ **Offline-ready PWA** — installable, with a network-first service worker.
- 🛟 **Single-device fallback** — a `localStorage` mode kicks in automatically when Firebase isn't available.
- 📊 **Audience analytics** — Google Analytics 4 for audience + campaign insight, tagged desktop-host vs. phone-controller. IP-anonymized, and it never blocks gameplay.

---

## 🕹️ Controls

| Control | Action |
| --- | --- |
| 🕹️ **Joystick** | Rotate to steer (any angle) · push further to speed up |
| ▶ **Center button** | Start the game (turns into 🐍 while playing) |
| ⌨️ **Space / Enter** *(desktop)* | Restart after a crash |
| 🔁 **Play Again** *(phone)* | Restart from the game-over share card |
| 🏆 **Trophy button** *(desktop)* | View the global Top-10 leaderboard |

---

## 🛠️ Tech

Vanilla **JavaScript** (no bundler, no modules) · HTML5 **Canvas** · **Firebase** Firestore *(session + game state)* + Realtime Database *(joystick stream)* + **Analytics (GA4)** · **PWA** *(installable, offline shell)* · **Firebase Hosting** with auto-deploy via GitHub Actions.

---

## 💻 Local development

There's **no build step** — just serve the static `public/` folder.

```bash
npm install      # dev tooling only: firebase-tools, eslint, vitest, prettier
npm start        # → npx serve -s public   (http://localhost:3000)
```

Any static server works too, e.g. `python -m http.server 8000 --directory public`.

- Open on a **desktop-width** window to host the game.
- Append **`?session=123456`** to the URL (or open on a phone) to load the **controller** view in a second tab/device.

```bash
npm run lint     # ESLint
npm test         # Vitest unit tests (tests/)
npm run format   # Prettier
```

**Deploys are automatic** on push to `master` (GitHub Actions → `firebase deploy --only hosting,firestore,database`) — the site **and** both security-rule sets ship together; the rules files in this repo are the source of truth.

---

## 📐 Architecture

Plain `<script>` files share **one global scope**, loaded in a fixed order — there's no import graph. The **desktop** owns the game loop, rendering, and collision; the **phone** captures the joystick. They pair over a 6-digit code / QR via Firebase, with a `localStorage` fallback for single-device use.

> 🤖 Full map for contributors and AI agents lives in **[CLAUDE.md](CLAUDE.md)**, with a deeper index under **[`.agent/`](.agent/)**.

---

## 🤝 Contributing

PRs welcome — see **[CONTRIBUTING.md](CONTRIBUTING.md)**. We use [Conventional Commits](https://www.conventionalcommits.org/) (`feat | fix | refactor | style`) and branch as `feature/…`, `bugfix/…`, `docs/…`.

---

<div align="center">

Made with ❤️ by **[Aryaman Godara](https://www.linkedin.com/in/aryamangodara/)** · ⭐ the repo if you enjoyed it!

</div>
