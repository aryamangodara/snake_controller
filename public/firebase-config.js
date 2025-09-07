// Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyAt8mVTh9N8zziPCSwhxxRbkcqh93CrNhI",
    authDomain: "go-console-84748.firebaseapp.com",
    databaseURL: "https://go-console-84748-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "go-console-84748",
    storageBucket: "go-console-84748.firebasestorage.app",
    messagingSenderId: "301266921160",
    appId: "1:301266921160:web:482979b81d409acd92a7fd",
    measurementId: "G-0DFSB38H21"
  };
  
  // Initialize Firebase
  import { initializeApp } from 'firebase/app';
  import { getDatabase } from 'firebase/database';
  
  const app = initializeApp(firebaseConfig);
  const database = getDatabase(app);
  
  export { database };
  