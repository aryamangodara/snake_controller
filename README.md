# 🐍 Cross-Device Snake Game

A modern take on the classic Snake game where you play on your desktop and use your smartphone as a wireless controller!

[![Play Demo](https://img.shields.io/badge/🎮-Play_Live_Demo-FF4B4B?style=for-the-badge&logoColor=white)](https://go-console-84748.web.app/)
[![Firebase](https://img.shields.io/badge/Firebase-Firestore-orange?style=flat-square)](https://console.firebase.google.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](LICENSE)

---

## 🎮 How to Play

### 1. Host on Desktop
Open the [Live Demo](https://go-console-84748.web.app/) on your computer. A unique **6-digit session code** and QR code will appear.

### 2. Connect Mobile
Scan the QR code with your phone or enter the session code manually.

### 3. Control
- **Joystick**: Rotate to turn, pull further for a **speed boost**.
- **Play Button (▶)**: Start the game.
- **Restart Button (↻)**: Play again after a crash.

---

## 🚀 Local Development

If you want to run the project locally or contribute:

### Prerequisites
- Node.js (v16+)
- [Firebase account](https://console.firebase.google.com/) (optional, for cross-device features)

### Setup
1. **Clone & Install**
   ```bash
   git clone https://github.com/yourusername/snake-game.git
   cd snake-game
   npm install
   ```

2. **Configuration**
   Add your Firebase credentials to `public/js/config.js`.

3. **Run**
   ```bash
   npm start
   # Visit http://localhost:3000
   ```

---

## 🔥 Key Features
- **Zero Latency**: Real-time sync via Firebase Firestore.
- **Cross-Platform**: Works on any modern browser (iOS, Android, Windows, macOS).
- **Smart Fallback**: Automatic `localStorage` mode for testing on a single device.
- **Responsive Design**: Custom-built touch joystick for mobile controllers.

---

**Made with ❤️ for the retro gaming community.**  
*Feel free to ⭐ star this repo if you enjoyed the game!*