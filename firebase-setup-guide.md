# Complete Firebase Setup Guide for Snake Game

This guide will walk you through deploying your snake game with mobile controller to Firebase, starting from project creation to live deployment.

## Prerequisites

Before starting, ensure you have:
- A Google account
- Node.js installed (version 14 or higher)
- npm (comes with Node.js)
- The snake game code files ready

## Step 1: Create Firebase Project

1. **Go to Firebase Console**
   - Visit [https://console.firebase.google.com/](https://console.firebase.google.com/)
   - Sign in with your Google account

2. **Create New Project**
   - Click "Create a project" or "Add project"
   - Enter project name (e.g., "snake-game-controller")
   - Click "Continue"

3. **Configure Google Analytics (Optional)**
   - Choose whether to enable Google Analytics
   - If enabled, select or create an Analytics account
   - Click "Create project"

4. **Wait for Project Creation**
   - Firebase will set up your project (takes 30-60 seconds)
   - Click "Continue" when ready

## Step 2: Set Up Firebase Realtime Database

1. **Navigate to Realtime Database**
   - In Firebase Console, go to "Build" → "Realtime Database"
   - Click "Create Database"

2. **Choose Database Location**
   - Select a location closest to your users
   - Click "Next"

3. **Set Security Rules**
   - Choose "Start in test mode" for development
   - **Important**: Test mode allows public read/write access
   - Click "Enable"

4. **Note Your Database URL**
   - Copy the database URL (looks like: `https://your-project-default-rtdb.firebaseio.com/`)
   - You'll need this later

## Step 3: Enable Firebase Hosting

1. **Navigate to Hosting**
   - Go to "Build" → "Hosting"
   - Click "Get started"

2. **Follow Setup Instructions**
   - Firebase will show you CLI installation steps
   - We'll cover these in detail below

## Step 4: Install and Configure Firebase CLI

1. **Install Firebase CLI**
   ```bash
   npm install -g firebase-tools
   ```

2. **Login to Firebase**
   ```bash
   firebase login
   ```
   - This will open your browser
   - Sign in with the same Google account used for Firebase Console
   - Grant necessary permissions

3. **Verify Installation**
   ```bash
   firebase --version
   ```

## Step 5: Prepare Your Project Files

1. **Create Project Directory**
   ```bash
   mkdir snake-game-firebase
   cd snake-game-firebase
   ```

2. **Add Your Game Files**
   Create the following structure:
   ```
   snake-game-firebase/
   ├── public/
   │   ├── index.html
   │   ├── style.css
   │   ├── app.js
   │   └── firebase-config.js
   ├── firebase.json
   └── .firebaserc
   ```

3. **Update Your Game Code for Firebase**

   Create a new file `public/firebase-config.js`:
   ```javascript
   // Firebase configuration
   const firebaseConfig = {
     apiKey: "your-api-key",
     authDomain: "your-project.firebaseapp.com",
     databaseURL: "https://your-project-default-rtdb.firebaseio.com/",
     projectId: "your-project-id",
     storageBucket: "your-project.appspot.com",
     messagingSenderId: "123456789",
     appId: "your-app-id"
   };

   // Initialize Firebase
   import { initializeApp } from 'firebase/app';
   import { getDatabase } from 'firebase/database';

   const app = initializeApp(firebaseConfig);
   const database = getDatabase(app);

   export { database };
   ```

## Step 6: Get Firebase Configuration

1. **Add Web App to Firebase Project**
   - In Firebase Console, click the web icon (`</>`) on project overview
   - Give your app a nickname (e.g., "Snake Game Web")
   - Check "Also set up Firebase Hosting"
   - Click "Register app"

2. **Copy Configuration**
   - Firebase will show your config object
   - Copy all the values to replace in your `firebase-config.js`

## Step 7: Update Game Code for Firebase Integration

1. **Modify app.js to use Firebase Realtime Database**
   
   Add to the top of your `app.js`:
   ```javascript
   import { database } from './firebase-config.js';
   import { ref, set, onValue, push } from 'firebase/database';
   ```

2. **Replace Session Management**
   
   Replace the in-memory session management with Firebase:
   ```javascript
   // Generate and store session in Firebase
   function generateNewSession() {
       const sessionCode = generateSessionCode();
       const sessionRef = ref(database, `sessions/${sessionCode}`);
       
       set(sessionRef, {
           created: Date.now(),
           connected: false,
           lastDirection: null
       });
       
       sessionManager.currentSession = sessionCode;
       document.getElementById('session-code').textContent = sessionCode;
       generateQRCode(sessionCode);
       
       // Listen for mobile connections
       onValue(sessionRef, (snapshot) => {
           const data = snapshot.val();
           if (data && data.lastDirection) {
               handleDirectionChange(data.lastDirection);
           }
       });
   }
   
   // Handle mobile input
   function sendDirectionToFirebase(sessionCode, direction) {
       const sessionRef = ref(database, `sessions/${sessionCode}`);
       set(sessionRef, {
           connected: true,
           lastDirection: direction,
           timestamp: Date.now()
       });
   }
   ```

3. **Update Mobile Controller**
   
   Modify mobile controller functions:
   ```javascript
   function connectToSession(sessionCode) {
       const sessionRef = ref(database, `sessions/${sessionCode}`);
       
       // Check if session exists
       onValue(sessionRef, (snapshot) => {
           if (snapshot.exists()) {
               sessionManager.connectedSession = sessionCode;
               showConnectionSuccess();
           } else {
               showConnectionError();
           }
       });
   }
   
   function sendDirection(direction) {
       if (sessionManager.connectedSession) {
           sendDirectionToFirebase(sessionManager.connectedSession, direction);
       }
   }
   ```

## Step 8: Initialize Firebase in Your Project

1. **Initialize Firebase**
   ```bash
   firebase init
   ```

2. **Select Features**
   - Use arrow keys to navigate
   - Press space to select "Hosting" and "Realtime Database"
   - Press Enter to continue

3. **Select Project**
   - Choose "Use an existing project"
   - Select your project from the list

4. **Configure Database Rules**
   - Choose to use default database rules file
   - We'll modify security rules later

5. **Configure Hosting**
   - Set public directory as "public"
   - Configure as single-page app: "Yes"
   - Don't overwrite index.html if it exists

## Step 9: Configure Database Security Rules

1. **Edit database.rules.json**
   ```json
   {
     "rules": {
       "sessions": {
         "$sessionId": {
           ".read": true,
           ".write": true,
           ".validate": "newData.hasChildren(['connected', 'lastDirection', 'timestamp'])"
         }
       }
     }
   }
   ```

2. **Deploy Rules**
   ```bash
   firebase deploy --only database
   ```

## Step 10: Test Locally

1. **Serve Locally**
   ```bash
   firebase serve
   ```
   
2. **Test Your App**
   - Open `http://localhost:5000`
   - Test desktop game and mobile controller
   - Verify real-time communication works

## Step 11: Deploy to Production

1. **Build and Deploy**
   ```bash
   firebase deploy
   ```

2. **Access Your Live App**
   - Firebase will provide two URLs:
     - `https://your-project-id.web.app`
     - `https://your-project-id.firebaseapp.com`

## Step 12: Configure Custom Domain (Optional)

1. **In Firebase Console**
   - Go to "Hosting" → "Add custom domain"
   - Follow the DNS configuration steps

## Security Considerations

1. **Update Database Rules for Production**
   ```json
   {
     "rules": {
       "sessions": {
         "$sessionId": {
           ".read": "auth != null || (now - data.child('created').val()) < 3600000",
           ".write": "auth != null || (now - data.child('created').val()) < 3600000",
           ".validate": "newData.hasChildren(['connected', 'lastDirection', 'timestamp'])"
         }
       }
     }
   }
   ```

2. **Set Up Session Cleanup**
   - Create a Firebase Function to clean up old sessions
   - Or implement client-side cleanup logic

## Troubleshooting

### Common Issues:

1. **CORS Errors**
   - Ensure you're serving files through Firebase (not file://)
   - Use `firebase serve` for local development

2. **Database Permission Errors**
   - Check your database rules
   - Ensure test mode is enabled during development

3. **Build Errors**
   - Verify all Firebase imports are correct
   - Check that firebase-config.js has correct values

4. **Mobile Connection Issues**
   - Ensure both devices are on same network for testing
   - Check browser console for JavaScript errors

### Getting Help:

- Firebase Documentation: [https://firebase.google.com/docs](https://firebase.google.com/docs)
- Firebase Support: [https://firebase.google.com/support](https://firebase.google.com/support)
- Stack Overflow: Search for "firebase hosting" or "firebase realtime database"

## Next Steps

1. **Add Firebase Analytics** to track usage
2. **Set up Firebase Functions** for server-side logic
3. **Implement user authentication** for personalized experiences
4. **Add Firebase Performance Monitoring** to optimize your app
5. **Set up automated backups** for your database

Your snake game is now live on Firebase with real-time mobile controller functionality!