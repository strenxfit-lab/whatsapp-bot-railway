import qrcode from "qrcode";
import fetch from "node-fetch";
import FormData from "form-data";
import pkg from "whatsapp-web.js";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const { Client, LocalAuth } = pkg;

// ----------------- ENVIRONMENT VARIABLES -----------------
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.error("❌ FIREBASE_SERVICE_ACCOUNT missing in Railway environment!");
  process.exit(1);
}
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

// ----------------- FIREBASE INIT -----------------
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

// ----------------- TELEGRAM QR SENDER -----------------
async function sendToTelegram(qr) {
  try {
    const qrDataUrl = await qrcode.toDataURL(qr);
    const base64Image = qrDataUrl.split(",")[1];
    const imageBuffer = Buffer.from(base64Image, "base64");

    const formData = new FormData();
    formData.append("chat_id", TELEGRAM_CHAT_ID);
    formData.append("photo", imageBuffer, { filename: "qr.png" });

    const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, {
      method: "POST",
      body: formData,
    });

    if (response.ok) {
      console.log("✅ QR sent to Telegram!");
    } else {
      console.error("❌ Telegram API error:", await response.text());
    }
  } catch (err) {
    console.error("❌ Telegram send error:", err);
  }
}

// ----------------- WHATSAPP CLIENT -----------------
const client = new Client({
  authStrategy: new LocalAuth({ clientId: "strenx-bot" }),
  puppeteer: {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
    ],
  },
});

// ----------------- EVENT HANDLERS -----------------
client.on("qr", (qr) => {
  console.log("QR generated — sending to Telegram...");
  sendToTelegram(qr);
});

client.on("ready", () => {
  console.log("✅ WhatsApp Bot is ready!");
  startQueueListener();
});

client.on("auth_failure", (msg) => {
  console.error("❌ Auth failure:", msg);
});

client.on("disconnected", async (reason) => {
  console.log("⚠️ WhatsApp disconnected:", reason);
  await notifyLogout();
});

// ----------------- FIRESTORE QUEUE LISTENER -----------------
function startQueueListener() {
  console.log("👂 Listening for Firestore queue...");
  const queue = db.collectionGroup("messageQueue");

  queue.onSnapshot(async (snap) => {
    for (const change of snap.docChanges()) {
      if (change.type === "added") {
        const data = change.doc.data();
        if (data.status === "pending") {
          await processMessage(change.doc.ref, data);
        }
      }
    }
  });
}

// ----------------- SEND MESSAGE -----------------
async function processMessage(docRef, data) {
  try {
    let num = (data.to || data.memberNumber || "").replace(/\D/g, "");
    if (num.length === 10) num = "91" + num;
    const jid = `${num}@c.us`;

    const msg =
      data.message ||
      `Welcome to Expert Hub Library 📚\nLogin ID: ${data.loginId}\nPassword: ${data.password}\nLogin here: https://expert.strenxsoftware.in/auth/login`;

    await client.sendMessage(jid, msg);
    console.log(`✅ Sent message to ${jid}`);

    await docRef.update({ status: "sent", sentAt: new Date() });
  } catch (err) {
    console.error("❌ Send failed:", err);
    await docRef.update({ status: "failed", error: String(err) });
  }
}

// ----------------- TELEGRAM ALERT ON LOGOUT -----------------
async function notifyLogout() {
  try {
    const text = "🚨 WhatsApp Bot LOGGED OUT! Please rescan QR to reconnect.";
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text }),
    });
    console.log("📢 Telegram logout alert sent!");
  } catch (err) {
    console.error("❌ Failed to send logout alert:", err);
  }
}

// ----------------- INITIALIZE BOT -----------------
client.initialize();

// ----------------- EXPRESS KEEP-ALIVE (for UptimeRobot) -----------------
import express from "express";
const app = express();
app.get("/", (req, res) => res.send("✅ Strenx WhatsApp Bot Active"));
app.listen(process.env.PORT || 3000, () => console.log("🌐 Server running for uptime monitoring"));
