import baileys from "@whiskeysockets/baileys";
const { makeWASocket, useMultiFileAuthState, DisconnectReason } = baileys;

import qrcode from "qrcode-terminal";
import admin from "firebase-admin";

// ---------- FIREBASE SETUP ----------
if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.error("❌ FIREBASE_SERVICE_ACCOUNT missing");
  process.exit(1);
}
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// ---------- WHATSAPP CONNECTION ----------
const connectBot = async () => {
  const { state, saveCreds } = await useMultiFileAuthState("./session");

  const sock = makeWASocket({
    printQRInTerminal: true,
    auth: state,
  });

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) qrcode.generate(qr, { small: true });
    if (connection === "open") console.log("✅ WhatsApp connected!");
    if (connection === "close") {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log("⚠️ Connection closed. Reconnecting...", shouldReconnect);
      if (shouldReconnect) connectBot();
    }
  });

  sock.ev.on("creds.update", saveCreds);

  listenFirestore(sock);
};

// ---------- FIRESTORE QUEUE ----------
function listenFirestore(sock) {
  console.log("👂 Listening for new messages...");
  db.collectionGroup("messageQueue").onSnapshot((snap) => {
    snap.docChanges().forEach(async (change) => {
      if (change.type === "added") {
        const data = change.doc.data();
        if (data.status === "pending") {
          await sendMessage(sock, change.doc.ref, data);
        }
      }
    });
  });
}

// ---------- SEND MESSAGE ----------
async function sendMessage(sock, docRef, data) {
  try {
    const number = (data.to || "").replace(/\D/g, "");
    if (number.length < 10) throw new Error("Invalid phone number");
    const jid = `91${number.slice(-10)}@s.whatsapp.net`;

    const text =
      data.message ||
      `Welcome to Expert Hub Library 📚\nLogin ID: ${data.loginId}\nPassword: ${data.password}\nLogin here: https://expert.strenxsoftware.in/auth/login`;

    await sock.sendMessage(jid, { text });
    console.log(`✅ Message sent to ${jid}`);

    await docRef.update({
      status: "sent",
      sentAt: new Date(),
    });
  } catch (err) {
    console.error("❌ Send failed:", err.message);
    await docRef.update({
      status: "failed",
      error: err.message,
    });
  }
}

connectBot();
