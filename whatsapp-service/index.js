import makeWASocket, { useMultiFileAuthState, DisconnectReason } from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";
import admin from "firebase-admin";
import fetch from "node-fetch";

// ✅ Telegram Alert Function
async function sendTelegramAlert(msg) {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return console.log("⚠️ Telegram config missing");

    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: msg }),
    });
    console.log("📩 Telegram alert sent:", msg);
  } catch (err) {
    console.error("❌ Telegram alert failed:", err.message);
  }
}

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

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) qrcode.generate(qr, { small: true });
    if (connection === "open") console.log("✅ WhatsApp connected!");
    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      console.log("⚠️ Connection closed:", statusCode);

      if (statusCode === DisconnectReason.loggedOut) {
        await sendTelegramAlert("🚨 WhatsApp Bot *LOGGED OUT*! Please rescan QR to reconnect.");
      } else {
        await sendTelegramAlert("⚠️ WhatsApp Bot *DISCONNECTED*. Attempting to reconnect...");
        connectBot();
      }
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
    await docRef.update({ status: "sent", sentAt: new Date() });
  } catch (err) {
    console.error("❌ Send failed:", err.message);
    await docRef.update({ status: "failed", error: err.message });
  }
}

connectBot();
