import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyDKQ4M_fIsgtoH3c7neUDlNm2D2LMzQ-U4",
  authDomain: "among-us-ff423.firebaseapp.com",
  databaseURL: "https://among-us-ff423-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "among-us-ff423",
  storageBucket: "among-us-ff423.firebasestorage.app",
  messagingSenderId: "315937133517",
  appId: "1:315937133517:web:3dcc60c9ba368bf7e22a84"
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);