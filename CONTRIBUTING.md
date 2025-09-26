# Contributing to Cross-Device Snake Game

Thank you for your interest in contributing! We welcome contributions from developers of all skill levels.

## 🚀 Getting Started

### Prerequisites
- Modern web browser (Chrome 60+, Firefox 55+, Safari 12+)
- Git for version control
- Firebase account (optional, for cross-device features)
- Basic knowledge of JavaScript, HTML5, and CSS

### Setting Up Development Environment

1. **Fork the repository**
   ```bash
   # Click "Fork" on GitHub, then clone your fork
   git clone https://github.com/YOUR_USERNAME/cross-device-snake-game.git
   cd cross-device-snake-game
   ```

2. **Set up Firebase (optional)**
   ```bash
   npm install -g firebase-tools
   firebase login
   firebase init hosting
   ```

3. **Start local development server**
   ```bash
   # Using Python
   python -m http.server 8000
   
   # Using Node.js
   npx http-server
   
   # Using PHP
   php -S localhost:8000
   ```

4. **Test the application**
   - Desktop: `http://localhost:8000?mode=desktop`
   - Mobile: `http://localhost:8000?mode=mobile`

## 🎯 How to Contribute

### Reporting Bugs
1. Check existing [issues](../../issues) to avoid duplicates
2. Use the bug report template
3. Include:
   - Steps to reproduce
   - Expected vs actual behavior
   - Browser/device information
   - Console errors (if any)

### Suggesting Features
1. Open an issue with the feature request template
2. Describe the feature and its benefits
3. Include mockups or examples if applicable

### Submitting Code Changes

#### Branch Naming Convention
- `feature/description` - New features
- `bugfix/description` - Bug fixes
- `docs/description` - Documentation updates
- `refactor/description` - Code refactoring

#### Pull Request Process
1. **Create a feature branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes**
   - Follow existing code style
   - Add comments for complex logic
   - Test on both desktop and mobile

3. **Test thoroughly**
   - Test Firebase connection
   - Test localStorage fallback
   - Test on different screen sizes
   - Verify joystick functionality

4. **Commit with clear messages**
   ```bash
   git commit -m "Add: New joystick sensitivity setting"
   git commit -m "Fix: Mobile connection timeout issue"
   git commit -m "Update: README installation instructions"
   ```

5. **Push and create PR**
   ```bash
   git push origin feature/your-feature-name
   ```
   - Open PR on GitHub
   - Fill out the PR template
   - Link related issues

## 📝 Code Style Guidelines

### JavaScript
```javascript
// Use modern ES6+ syntax
const gameConfig = {
    speed: 2.0,
    maxPlayers: 2
};

// Use descriptive variable names
const joystickInput = { x: 0.5, y: -0.3 };
const isGameRunning = true;

// Add JSDoc comments for functions
/**
 * Handles joystick input from mobile controller
 * @param {Object} input - Joystick coordinates {x, y}
 */
function handleJoystickInput(input) {
    // Function implementation
}
```

### CSS
```css
/* Use BEM methodology for CSS classes */
.joystick__base {
    position: relative;
}

.joystick__handle--dragging {
    transform: scale(1.1);
}

/* Use CSS custom properties for themes */
:root {
    --primary-color: #ff1493;
    --background-color: #0a0a0a;
}
```

### HTML
```html
<!-- Use semantic HTML elements -->
<main class="game-container">
    <section class="game-board" aria-label="Snake game board">
        <canvas id="game-canvas" role="img" aria-label="Snake game"></canvas>
    </section>
</main>
```

## 🧪 Testing Guidelines

### Manual Testing Checklist
- [ ] Desktop game loads correctly
- [ ] Mobile controller connects via QR code
- [ ] Mobile controller connects via manual code entry
- [ ] Joystick controls snake direction
- [ ] Joystick pressure controls speed
- [ ] Game start/restart buttons work
- [ ] localStorage fallback works
- [ ] Firebase connection works
- [ ] Game over screen displays correctly
- [ ] Score updates properly

### Cross-Device Testing
- [ ] Test on different browsers (Chrome, Firefox, Safari)
- [ ] Test on different devices (iOS, Android)
- [ ] Test network disconnection scenarios
- [ ] Test Firebase quota limits

### Performance Testing
- [ ] Game runs at 60 FPS
- [ ] No memory leaks during long sessions
- [ ] Firebase operations stay within quotas
- [ ] Mobile battery usage is reasonable

## 🏗️ Project Structure

```
├── index.html          # Main HTML structure
├── app.js              # Core game logic and Firebase integration
├── styles.css          # Responsive CSS styling
├── firebase.json       # Firebase hosting configuration
├── .github/
│   ├── workflows/      # GitHub Actions CI/CD
│   └── ISSUE_TEMPLATE/ # Issue templates
└── docs/               # Additional documentation
```

### Key Components
- **Game Engine**: Canvas-based rendering in `app.js`
- **Session Management**: Firebase/localStorage hybrid system
- **Mobile Controller**: Touch-based joystick interface
- **Connection System**: QR code + manual code entry

## 🐛 Common Issues & Solutions

### Firebase Connection Problems
```javascript
// Check Firebase configuration
console.log('Firebase config:', firebaseConfig);

// Verify Firestore rules allow read/write
// Go to Firebase Console → Firestore → Rules
```

### Mobile Controller Not Working
```javascript
// Enable debug logging
sessionManager.debug = true;

// Check localStorage data
console.log('Session data:', localStorage.getItem('snake_session_123456'));
```

### Performance Issues
```javascript
// Reduce joystick update frequency
gameConfig.joystickThrottleMs = 200; // Increase from 150

// Monitor Firebase usage
console.log('Firebase operations:', firestoreOperations);
```

## 🎮 Feature Ideas

We welcome contributions in these areas:

### Game Features
- **Power-ups**: Speed boost, score multiplier, invincibility
- **Obstacles**: Static walls, moving barriers
- **Game Modes**: Timed mode, survival mode, multiplayer
- **Themes**: Different visual themes and color schemes

### Technical Improvements
- **Performance**: WebGL rendering, better collision detection
- **Accessibility**: Keyboard controls, screen reader support
- **PWA Features**: Offline play, app installation
- **Analytics**: Game statistics, user behavior tracking

### Mobile Enhancements
- **Haptic Feedback**: Vibration on collisions and food collection
- **Gestures**: Swipe controls as alternative to joystick
- **Multi-touch**: Support for multiple players on one device
- **Responsive UI**: Better adaptation to different screen sizes

## 📋 Review Process

### What Reviewers Look For
1. **Code Quality**: Clean, readable, well-commented code
2. **Functionality**: Features work as described
3. **Performance**: No significant performance regressions
4. **Compatibility**: Works on target browsers/devices
5. **Documentation**: README and code comments updated

### Review Timeline
- Initial review: 1-3 business days
- Follow-up reviews: 1 business day
- Merge: After approval and CI passes

## 🏆 Recognition

Contributors will be:
- Listed in repository contributors
- Mentioned in release notes for significant contributions
- Given credit in documentation for major features

## ❓ Questions?

- **General Questions**: Open a [Discussion](../../discussions)
- **Bug Reports**: Create an [Issue](../../issues)
- **Feature Requests**: Create an [Issue](../../issues) with feature template
- **Security Issues**: Email maintainers privately

## 📜 Code of Conduct

We follow the [Contributor Covenant](https://www.contributor-covenant.org/version/2/0/code_of_conduct/) to ensure a welcoming environment for all contributors.

### Our Standards
- **Be respectful** of different viewpoints and experiences
- **Be constructive** in feedback and criticism
- **Be collaborative** and help others learn
- **Be inclusive** and welcoming to newcomers

Thank you for contributing to making cross-device gaming accessible and fun! 🎮