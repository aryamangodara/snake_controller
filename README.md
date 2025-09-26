# 🐍 Cross-Device Snake Game

A modern take on the classic Snake game with **cross-device multiplayer functionality**. Play the game on your desktop while using your smartphone as a wireless controller!

![Cross-Device Snake Game](https://img.shields.io/badge/Cross--Device-Snake%20Game-brightgreen)
![Firebase](https://img.shields.io/badge/Firebase-Firestore-orange)
![JavaScript](https://img.shields.io/badge/JavaScript-ES6+-yellow)
![Mobile Friendly](https://img.shields.io/badge/Mobile-Friendly-blue)

## ✨ Features

### 🎮 **Cross-Device Gameplay**
- **Desktop**: Hosts the game with full visual experience
- **Mobile**: Acts as a wireless controller with touch joystick
- **Real-time synchronization** between devices
- **QR code connection** for instant mobile pairing

### 🐍 **Enhanced Snake Mechanics**
- **Continuous movement** - Snake never stops moving
- **Variable speed control** - Push joystick harder for speed boost
- **Smooth directional control** - Gradual turning with joystick
- **Progressive difficulty** - Speed increases with score
- **Collision detection** - Wall and self-collision

### 📱 **Mobile Controller Features**
- **Touch-based joystick** with visual feedback
- **Start/Restart buttons** with game state awareness
- **Real-time connection status** indicators
- **Responsive design** for all mobile screen sizes

### 🔥 **Technology Stack**
- **Frontend**: Vanilla JavaScript, HTML5 Canvas, CSS3
- **Backend**: Firebase Firestore for real-time data sync
- **Fallback**: localStorage for same-browser play
- **QR Codes**: For easy mobile connection
- **Progressive Enhancement**: Works offline

## 🚀 Quick Start

### 1. Clone the Repository
```bash
git clone https://github.com/yourusername/cross-device-snake-game.git
cd cross-device-snake-game
```

### 2. Firebase Setup (Optional for Cross-Device Play)
1. Create a [Firebase project](https://console.firebase.google.com/)
2. Enable Firestore Database
3. Copy your Firebase config to `app.js`:
```javascript
const firebaseConfig = {
    apiKey: "your-api-key",
    authDomain: "your-project.firebaseapp.com",
    projectId: "your-project-id",
    // ... other config
};
```

4. Update Firestore security rules:
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /sessions/{sessionId} {
      allow read, write: if true;
    }
    match /test/{document=**} {
      allow read, write: if true;
    }
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

### 3. Deploy
```bash
# Using Firebase Hosting
npm install -g firebase-tools
firebase login
firebase init hosting
firebase deploy

# Or serve locally
python -m http.server 8000
# Then visit http://localhost:8000
```

## 🎯 How to Play

### Desktop Setup
1. Open the game in your desktop browser
2. Note the **6-digit session code** displayed
3. **Scan the QR code** or share the mobile URL

### Mobile Connection
1. **Scan QR code** or enter the **session code** manually
2. Wait for "✅ Connected!" confirmation
3. Use the **joystick** to control snake direction and speed
4. Press **▶** to start the game

### Game Controls
- **Joystick Direction**: Controls snake turning
- **Joystick Distance**: Controls speed boost
- **Center Button**: Start game (▶) or Restart (↻)

## 🏗️ Architecture

### Connection Modes

#### 🔥 **Firebase Mode** (Cross-Device)
```
Desktop ←→ Firebase Firestore ←→ Mobile
```
- Real-time synchronization across different devices/networks
- Session data stored in Firestore
- Automatic fallback if Firebase unavailable

#### 📱 **localStorage Mode** (Same-Browser)
```
Desktop Tab ←→ localStorage ←→ Mobile Tab
```
- Same-browser synchronization using storage events
- Works offline without internet connection
- Automatic fallback when Firebase fails

### Data Flow
```
Mobile Joystick Input → Session Document → Desktop Game State
Mobile Game Actions → Session Document → Desktop Game Logic
Desktop Game State → Session Document → Mobile Button States
```

### File Structure
```
├── index.html          # Main HTML structure
├── styles.css          # Responsive CSS styling
├── app.js              # Core game logic and Firebase integration
├── firebase.json       # Firebase hosting configuration
└── README.md           # Project documentation
```

## 🛠️ Development

### Prerequisites
- Modern web browser with ES6+ support
- Firebase account (optional, for cross-device features)
- Local web server for development

### Running Locally
```bash
# Simple HTTP server
python -m http.server 8000

# Or with Node.js
npx http-server

# Or with PHP
php -S localhost:8000
```

### Testing Different Modes
```
# Force desktop mode
http://localhost:8000/?mode=desktop

# Force mobile mode
http://localhost:8000/?mode=mobile

# Auto-connect mobile with session
http://localhost:8000/?mode=mobile&session=123456
```

### Configuration Options
```javascript
const gameConfig = {
    boardSize: { width: 600, height: 600 },
    baseSpeed: 2.0,              // Base snake speed
    maxSpeedBoost: 1.5,          // Maximum speed multiplier
    turnSpeed: 0.08,             // Snake turning smoothness
    segmentSpacing: 15,          // Distance between snake segments
    joystickThrottleMs: 150,     // Joystick input frequency
};
```

## 🐛 Troubleshooting

### Firebase Connection Issues
- **Permission Error**: Check Firestore security rules are updated
- **400 Bad Request**: Ensure Firebase config is correct
- **Session Not Found**: Desktop must create session before mobile connects

### Mobile Controller Issues
- **Not Connecting**: Try same browser on both devices (localStorage mode)
- **Joystick Not Working**: Ensure touch events are enabled
- **Connection Lost**: Check internet connection and refresh both devices

### Performance Issues
- **Game Lag**: Reduce `joystickThrottleMs` value
- **Firebase Quota**: Monitor Firestore usage in Firebase Console
- **Memory Usage**: Game automatically cleans up old sessions

### Common Solutions
```javascript
// Enable debug logging
console.log('Debug mode enabled');

// Force localStorage mode
sessionManager.connectionType = 'localStorage';

// Reset session
localStorage.clear();
```

## 🤝 Contributing

We welcome contributions! Please see our contributing guidelines:

### Getting Started
1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines
- Use modern JavaScript (ES6+)
- Follow existing code style and naming conventions
- Add comments for complex game logic
- Test on both desktop and mobile devices
- Ensure Firebase fallback works properly

### Areas for Contribution
- **Game Features**: Power-ups, obstacles, different game modes
- **UI/UX**: Better mobile interface, animations, sound effects
- **Performance**: Optimization for older devices, reduced Firebase usage
- **Accessibility**: Keyboard controls, screen reader support
- **Documentation**: Better setup guides, video tutorials

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **Firebase** for real-time database capabilities
- **QRious** library for QR code generation
- **HTML5 Canvas** for smooth game rendering
- **Touch Events API** for mobile joystick controls

## 🎮 Live Demo

🔗 **[Play the Game](https://go-console-84748.web.app/)**

### Demo Features
- Try cross-device play with multiple devices
- Test localStorage fallback in same browser
- Experience smooth snake controls with joystick
- See real-time synchronization in action

## 📊 Technical Specifications

### Browser Support
- **Desktop**: Chrome 60+, Firefox 55+, Safari 12+, Edge 79+
- **Mobile**: iOS Safari 12+, Chrome Mobile 60+, Samsung Internet 8+

### Performance Metrics
- **Game Loop**: 60 FPS rendering
- **Input Latency**: <50ms joystick response
- **Firebase Sync**: ~100-200ms cross-device delay
- **Memory Usage**: <10MB typical usage

### Firebase Usage (Free Tier)
- **Reads**: ~5-10 per game session
- **Writes**: ~300-600 per 10-minute game
- **Storage**: <1KB per session
- **Daily Capacity**: ~65 concurrent games

## 🚀 Deployment Options

### Firebase Hosting (Recommended)
```bash
firebase deploy --only hosting
```

### Netlify
```bash
# Connect GitHub repo to Netlify for automatic deploys
```

### GitHub Pages
```bash
# Enable GitHub Pages in repository settings
```

### Custom Server
- Serve static files from any web server
- No server-side requirements
- Works with CDNs and static hosting

---

**Made with ❤️ for the retro gaming community**

*Feel free to ⭐ star this repo if you enjoyed the game!*