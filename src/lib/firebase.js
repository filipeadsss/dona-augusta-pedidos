import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

// Valores públicos do app da Web (não são segredos). A proteção está em firestore.rules.
const cfg = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export const firebaseConfigurado = Boolean(cfg.apiKey && cfg.projectId && cfg.appId);

let cache = null;

// Só inicializa no navegador e só se as variáveis existirem.
export function getFirebase() {
  if (!firebaseConfigurado || typeof window === 'undefined') return null;
  if (!cache) {
    const app = getApps().length ? getApp() : initializeApp(cfg);
    cache = { app, db: getFirestore(app), auth: getAuth(app) };
  }
  return cache;
}
