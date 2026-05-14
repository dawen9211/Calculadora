import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

// Esta configuración debes sacarla de tu archivo firebase-applet-config.json 
// que usamos en la aplicación web principal.
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID
};

console.log("Initializing Firebase in Vercel function...");
export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
