import qrcode from "qrcode";
import pkg from "whatsapp-web.js";
import fetch from "node-fetch";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const { Client, LocalAuth } = pkg;

// ============= TELEGRAM CONFIG =============
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;  // e.g. "123456:ABC..."
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;  // your Telegram user id

async function sendToTelegram(qrDataUrl) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error("⚠️ Telegram credentials missing.");
    return;
  }
  try {
    const base64Data = qrDataUrl.replace(/^data:image\/png;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");

    const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendPhoto`, {
      method: "POST",
      body: new URLSearchParams({
        chat_id: TELEGRAM_CHAT_ID,
        caption: "📲 *Scan this QR to link your WhatsApp device*",
        parse_mode: "Markdown"
      }),
    });

    // For sendPhoto, we need to use multipart form:
    const formData = new FormData();
    formData.append("chat_id", TELEGRAM_CHAT_ID);
    formData.append("caption", "📲 Scan this QR to link your WhatsApp device");
    formData.append("photo", buffer, { filename: "qr.png" });
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendPhoto`, {
      method: "POST",
      body: formData,
    });

    console.log("✅ QR sent to Telegram!");
  } catch (err) {
    console.error("❌ Telegram send error:", err);
  }
}

// ----- FIREBASE -----
if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.error("FIREBASE_SERVICE_ACCOUNT env var missing.");
  process.exit(1);
}
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

// ----- WHATSAPP CLIENT -----
const client = new Client({
  authStrategy: new LocalAuth({ clientId: "strenx-bot" }),
  puppeteer: {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
  },
});

client.on("qr", async (qr) => {
  console.log("QR generated — sending to Telegram...");
  const qrDataUrl = await qrcode.toDataURL(qr);
  await sendToTelegram(qrDataUrl);
});

client.on("ready", () => {
  console.log("✅ WhatsApp client ready");
  startQueueListener();
});

client.on("auth_failure", (msg) => console.error("Auth failure:", msg));
client.on("disconnected", (reason) => console.log("WhatsApp disconnected:", reason));

client.initialize();

// ----- QUEUE HANDLER -----
function startQueueListener() {
  console.log("Listening for messageQueue entries...");
  const queueQuery = db.collectionGroup("messageQueue");
  queueQuery.onSnapshot(async (snap) => {
    for (const change of snap.docChanges()) {
      if (change.type === "added") {
        const data = change.doc.data();
        if (data.status === "pending") {
          await processQueueDoc(change.doc.ref, data);
        }
      }
    }
  }, (err) => console.error("Snapshot error:", err));
}

async function processQueueDoc(docRef, data) {
  try {
    let raw = (data.to || data.memberNumber || "").toString().replace(/[^0-9]/g, "");
    if (raw.length === 10) raw = "91" + raw;
    const jid = `${raw}@c.us`;

    const isReg = await client.isRegisteredUser(jid);
    if (!isReg) {
      await docRef.update({ status: "failed", error: "Not WhatsApp", checkedAt: new Date() });
      return;
    }

    await new Promise(r => setTimeout(r, 3000));
    const message = data.message || (`Welcome to Expert Hub Library 📚\nYour Login ID: ${data.loginId}\nPassword: ${data.password}\n\nLogin: https://expert.strenxsoftware.in/auth/login`);
    await client.sendMessage(jid, message);
    await docRef.update({ status: "sent", sentAt: new Date() });

    console.log(`✅ Sent to ${jid}`);
  } catch (err) {
    console.error("Send error:", err);
    try { await docRef.update({ status: "failed", error: String(err) }); } catch (e) {}
  }
}
