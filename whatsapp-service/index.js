import express from "express";
import qrcode from "qrcode-terminal";
import pkg from "whatsapp-web.js";
import { readFileSync } from "fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const app = express();

app.get("/", (req, res) => res.send("✅ WhatsApp Bot Active"));
app.listen(process.env.PORT || 3000, () => console.log("Server Live"));

const { Client, LocalAuth } = pkg;

// ----- 1) Load Firebase service account from ENV -----
if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.error("FIREBASE_SERVICE_ACCOUNT env var is missing. Add service account JSON as env var.");
  process.exit(1);
}
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

// Initialize Firebase Admin
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

// ----- 2) Initialize WhatsApp client -----
const client = new Client({
  authStrategy: new LocalAuth({ clientId: "strenx-bot" }), // session saved under .local-auth
  puppeteer: {
    headless: true, // set false for debugging locally
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage"
    ],
  },
});

client.on("qr", (qr) => {
  console.log("---- QR (scan this from your phone > WhatsApp > Linked devices > Link a device) ----");
  qrcode.generate(qr, { small: true });
  console.log("---- End QR ----");
});

client.on("ready", () => {
  console.log("✅ WhatsApp client ready");
  startQueueListener();
});

client.on("auth_failure", (msg) => {
  console.error("Auth failure:", msg);
});
client.on("disconnected", (reason) => {
  console.log("WhatsApp disconnected:", reason);
});

client.initialize();

// ----- 3) Queue listener -----
function startQueueListener() {
  console.log("Listening for messageQueue entries (collectionGroup)...");
  const queueQuery = db.collectionGroup("messageQueue");
  queueQuery.onSnapshot(async (snap) => {
    for (const change of snap.docChanges()) {
      if (change.type === "added") {
        const data = change.doc.data();
        if (data.status === "pending") {
          // process
          await processQueueDoc(change.doc.ref, data);
        }
      }
    }
  }, (err) => {
    console.error("Snapshot error:", err);
  });
}

async function processQueueDoc(docRef, data) {
  try {
    // normalize number -> ensure full E.164 without +, e.g. 919876543210
    let raw = (data.to || data.memberNumber || data.memberNumberRaw || data.memberNumberString || data.toString || "").toString();
    raw = raw.replace(/[^0-9]/g, "");
    if (raw.length === 10) raw = "91" + raw; // assume India
    const jid = `${raw}@c.us`;

    console.log(`Attempting send to ${jid} for ${data.memberName || data.name || "member"}`);

    // check registration
    const isReg = await client.isRegisteredUser(jid);
    if (!isReg) {
      console.log(`Not a WhatsApp number: ${jid}`);
      await docRef.update({ status: "failed", error: "Not a WhatsApp number", checkedAt: new Date() });
      return;
    }

    // throttle short delay
    await new Promise(r => setTimeout(r, 3000));

    const message = data.message || (`Welcome to Expert Hub Library 📚\nYour Login ID: ${data.loginId || data.memberId}\nPassword: ${data.password}\n\nLogin: https://expert.strenxsoftware.in/auth/login`);

    await client.sendMessage(jid, message);
    console.log(`✅ Sent to ${jid}`);
    await docRef.update({ status: "sent", sentAt: new Date() });
  } catch (err) {
    console.error("Send error:", err);
    try { await docRef.update({ status: "failed", error: String(err) }); } catch(e){ console.error("Failed to update doc:", e); }
  }
}
