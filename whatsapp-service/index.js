import qrcode from "qrcode-terminal";
import pkg from "whatsapp-web.js";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { sendAlert } from "./alert.js";
client.on("disconnected", async (reason) => {
  console.log("WhatsApp disconnected:", reason);
  await sendAlert("WhatsApp disconnected! Please rescan QR to reconnect.");
});

const { Client, LocalAuth } = pkg;

// 1. Load Firebase Service Account from Env Variable
if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.error("❌ FIREBASE_SERVICE_ACCOUNT env var missing");
  process.exit(1);
}
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

// 2. WhatsApp Web Client Config
const client = new Client({
  authStrategy: new LocalAuth({ clientId: "expert-hub-bot" }),
  puppeteer: {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  },
});

client.on("qr", (qr) => {
  console.log("📱 Scan this QR to connect WhatsApp →");
  qrcode.generate(qr, { small: true });
});

client.on("ready", () => {
  console.log("✅ WhatsApp bot ready and connected!");
  startQueueListener();
});

client.on("auth_failure", (msg) => console.error("Auth failure:", msg));
client.on("disconnected", (reason) => console.log("Disconnected:", reason));

client.initialize();

// 3. Firestore listener
function startQueueListener() {
  console.log("👂 Listening to Firestore queue...");
  const queueQuery = db.collectionGroup("messageQueue");

  queueQuery.onSnapshot((snap) => {
    snap.docChanges().forEach((change) => {
      if (change.type === "added") {
        const data = change.doc.data();
        if (data.status === "pending") {
          processQueueDoc(change.doc.ref, data);
        }
      }
    });
  });
}

// 4. Send message
async function processQueueDoc(docRef, data) {
  try {
    let raw = (data.to || data.memberNumber || "").toString().replace(/\D/g, "");
    if (raw.length === 10) raw = "91" + raw;
    const jid = `${raw}@c.us`;

    const message =
      data.message ||
      `Welcome to Expert Hub Library 📚\nYour Login ID: ${data.loginId}\nPassword: ${data.password}\nLogin at: https://expert.strenxsoftware.in/auth/login`;

    const isReg = await client.isRegisteredUser(jid);
    if (!isReg) {
      console.log("❌ Not a WhatsApp number:", jid);
      await docRef.update({ status: "failed", error: "Invalid WhatsApp number" });
      return;
    }

    await new Promise((r) => setTimeout(r, 3000)); // 3s delay
    await client.sendMessage(jid, message);
    console.log(`✅ Sent message to ${jid}`);

    await docRef.update({ status: "sent", sentAt: new Date() });
  } catch (err) {
    console.error("Send failed:", err);
    await docRef.update({ status: "failed", error: String(err) });
  }
}
