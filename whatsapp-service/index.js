import express from "express";
import qrcode from "qrcode-terminal";
import pkg from "whatsapp-web.js";
import fetch from "node-fetch";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const { Client, LocalAuth } = pkg;

// ====== 1) Telegram Setup ======
const TELEGRAM_BOT_TOKEN = "8445228246:AAEjlvBb_umDbIEoroqswE3mCYZYh_UQMsc";
const TELEGRAM_CHAT_ID = "5132081198";

// ====== 2) Express Server ======
const app = express();
const PORT = process.env.PORT || 3000;
app.get("/", (req, res) => res.send("✅ WhatsApp Bot + Firebase Queue Active"));
app.listen(PORT, () => console.log(`🌐 Server running on port ${PORT}`));

// ====== 3) Firebase Setup ======
if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  console.error("❌ FIREBASE_SERVICE_ACCOUNT env var missing.");
  process.exit(1);
}
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

// ====== 4) WhatsApp Client ======
const client = new Client({
  authStrategy: new LocalAuth({ clientId: "strenx-bot" }),
  puppeteer: {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
  },
});

// ====== BUILD WELCOME MESSAGE (NO LOGIN MESSAGE EVER) ======
function buildWelcomeMessage(data) {
  const join = data.joiningDate.toDate();
  const next = new Date(join);
  next.setDate(next.getDate() + 30);

  const formatted = next.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  const lines = [];

  lines.push(
    `Thanks for Joining The Expert’s Hub Library Munirka New Delhi. Received your fees for ${data.planName}. Your next due date is on ${formatted}.`
  );

  // FEE BREAKDOWN
  lines.push(
    `\n${data.planName} - ${data.membershipAmount}rs`
  );

  if (data.registrationFee > 0)
    lines.push(`Registration fees - ${data.registrationFee}rs`);

  if (data.securityFee > 0)
    lines.push(
      `Security fees - ${data.securityFee}rs (refundable only if you text 15 days before your due date that you are leaving the library)`
    );

  // POLICY
  lines.push(`
Any indiscipline will lead to cancellation of your admission without any refund.

The fees is non refundable in any situation.

Note:- 200rs security only refundable in case if you’re leaving the library and texting on WhatsApp 15 days before your due date, and it will be adjustable if you went to vacation without any information and with information post your due date it will be adjustable and you have to pay again whenever you join again.

Once you take the security refund you have to pay registration and security fees again whenever you join again.`);

  return lines.join("\n");
}

// ====== 5) QR Send to Telegram ======
async function sendToTelegram(qr) {
  try {
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(
      qr
    )}&size=400x400`;

    const response = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          photo: qrUrl,
          caption: "📲 Scan this QR to connect your WhatsApp bot.",
        }),
      }
    );

    const result = await response.json();
    if (!result.ok) console.error("❌ Telegram API error:", result);
    else console.log("✅ QR sent to Telegram successfully!");
  } catch (err) {
    console.error("❌ Telegram send error:", err);
  }
}

// ====== 6) WhatsApp Events ======
client.on("qr", async (qr) => {
  console.log("QR generated — sending to Telegram...");
  qrcode.generate(qr, { small: true });
  await sendToTelegram(qr);
});

client.on("ready", () => {
  console.log("✅ WhatsApp client ready");
  startQueueListener();
});

client.on("auth_failure", (msg) => {
  console.error("❌ Auth failure:", msg);
});
client.on("disconnected", (reason) => {
  console.log("⚠️ WhatsApp disconnected:", reason);
});

client.initialize();

// ====== 7) Firestore Message Queue ======
function startQueueListener() {
  console.log("🔁 Listening for messageQueue entries...");
  const queueQuery = db.collectionGroup("messageQueue");

  queueQuery.onSnapshot(
    async (snap) => {
      for (const change of snap.docChanges()) {
        if (change.type === "added") {
          const data = change.doc.data();
          if (data.status === "pending") {
            await processQueueDoc(change.doc.ref, data);
          }
        }
      }
    },
    (err) => {
      console.error("🔥 Snapshot error:", err);
    }
  );
}

async function processQueueDoc(docRef, data) {
  try {
    // 🚫 BLOCK ANY LOGIN FIELDS
    delete data.loginId;
    delete data.password;
    delete data.memberId;

    // Normalize phone number
    let raw = (data.to || data.memberNumber || "").toString();
    raw = raw.replace(/[^0-9]/g, "");
    if (raw.length === 10) raw = "91" + raw;
    const jid = `${raw}@c.us`;

    console.log(`📤 Sending message to ${jid} (${data.memberName})...`);

    const isReg = await client.isRegisteredUser(jid);
    if (!isReg) {
      console.log(`🚫 Not a WhatsApp number: ${jid}`);
      await docRef.update({
        status: "failed",
        error: "Not WhatsApp user",
        checkedAt: new Date(),
      });
      return;
    }

    // Always use welcome message
    const message = buildWelcomeMessage(data);

    await new Promise((r) => setTimeout(r, 2000));
    await client.sendMessage(jid, message);

    console.log(`✅ Sent successfully to ${jid}`);

    await docRef.update({ status: "sent", sentAt: new Date() });
  } catch (err) {
    console.error("❌ Send error:", err);
    await docRef.update({ status: "failed", error: String(err) });
  }
}
