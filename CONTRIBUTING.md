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

3. **Start a local server** (no build step — just serve `public/`)
   ```bash
   # Project script (Node)
   npm install && npm start                      # → npx serve -s public (http://localhost:3000)

   # …or any static server, pointed at public/
   python -m http.server 8000 --directory public
   npx http-server public
   ```

4. **Open the app**
   - **Desktop (host):** open the served URL (e.g. `http://localhost:3000`) in a normal-width window.
   - **Mobile (controller):** append `?session=123456` to that URL, or open it on a phone. The view
     is chosen by viewport width (`<= 768px`) or the `?session=` param — there is **no** `?mode=` flag.

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

4. **Commit with [Conventional Commits](https://www.conventionalcommits.org/)** (`feat | fix | refactor | style`)
   ```bash
   git commit -m "feat(controller): add joystick sensitivity setting"
   git commit -m "fix(network): handle mobile connection timeout"
   git commit -m "docs: update local-dev instructions"
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
/* Class names are kebab-case (not BEM); keep them descriptive. */
.joystick-base {
    position: relative;
}

.joystick-handle.dragging {
    transform: scale(1.1);
}

/* Reuse the design tokens in css/variables.css — the palette is teal/gold, not pink. */
.score-value {
    color: var(--color-primary);          /* teal */
    background: var(--color-background);   /* near-black */
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
├── public/                 # Everything that ships (Firebase Hosting serves this)
│   ├── css/                # variables → base → desktop / mobile (load order matters)
│   ├── js/                 # 13 plain <script>s, one shared global scope, no bundler
│   ├── index.html          # both views: desktop host + mobile controller
│   ├── sw.js               # network-first service worker (PWA offline shell)
│   └── manifest.json       # PWA manifest
├── tests/                  # Vitest unit tests for js/logic.js
├── firebase.json           # Firebase Hosting config
├── .github/workflows/      # GitHub Actions CI/CD (auto-deploy on master)
├── CLAUDE.md               # architecture map for contributors & AI agents
└── .agent/                 # deeper semantic index (SOPs, workflows, architecture)
```

### Key Components
- **Game engine** — canvas rendering, movement, collision, and combo logic in `js/game.js`
  (pure math factored into `js/logic.js`, which is unit-tested in `tests/`).
- **Session sync** — Firestore (state/actions) + Realtime Database (joystick), with a
  `localStorage` fallback, in `js/network.js` / `js/controller.js`.
- **Mobile controller** — touch joystick + center ▶ button in `js/controller.js`.
- **Connection** — QR code + 6-digit code; scanning auto-connects via a `?session=` URL param.
- **Feel** — `js/sound.js` (Web Audio SFX), `js/effects.js` (particles/shake), `js/share.js` (score card).

## 🐛 Common Issues & Solutions

### Firebase Connection Problems
```javascript
// The app logs its connection mode on load — look for
// "🚀 Firebase initialized" vs "Running in offline mode with localStorage".
console.log(sessionManager.connectionType); // 'hybrid' or 'localStorage'

// Security rules live in firestore.rules / database.rules.json in this repo
// and are deployed by CI — don't hand-edit them in the Firebase console.
```

### Mobile Controller Not Working
```javascript
// Inspect the live session/connection state
console.log(sessionManager);

// localStorage-fallback keys (single-device mode); <code> is the 6-digit session
localStorage.getItem('currentSession');
localStorage.getItem('session_<code>_state');    // { state, score }
localStorage.getItem('session_<code>_joystick'); // { joystick: {x, y} }
```

### Performance Issues
```javascript
// Joystick updates are throttled via gameConfig.joystickThrottleMs
// (config.js, default 33ms ≈ 30Hz). Raise it to reduce write frequency:
gameConfig.joystickThrottleMs = 100;
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