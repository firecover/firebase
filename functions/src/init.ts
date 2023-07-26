import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

initializeApp({
  storageBucket: "firecover-dev.appspot.com",
  credential: applicationDefault(),
});

export const bucket = getStorage().bucket();
export const firestore = getFirestore();
