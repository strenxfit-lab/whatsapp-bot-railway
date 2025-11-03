import express from "express";
import qrcode from "qrcode-terminal";
import { Client, LocalAuth } from "whatsapp-web.js";
import fetch from "node-fetch";

// Telegram credentials
const TELEGRAM_BOT_TOKEN = "8499533147:AAEU0mkA7l0plfMHoK9zuYYmRdr_YOE-hik";
const TELEGRAM_CHAT_ID = "6077248442";

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ UptimeRobot monitor route
app.get("/", (req, res) => res.send("✅ WhatsApp Bot Active & Running"));
app.listen(PORT, () => console.log(`🌐 Server running on port ${PORT}`));

// ✅ WhatsApp setup
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  },
});

// ✅ Send QR to Telegram as image
async function sendToTelegram(qr) {
  try {
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=400x400`;

    const response = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          photo: qrUrl,
          caption: "📱 Scan this QR to connect your WhatsApp bot.",
        }),
      }
    );

    const result = await response.json();
    if (!result.ok) {
      console.error("❌ Telegram API error:", result);
    } else {
      console.log("✅ QR sent to Telegram successfully!");
    }
  } catch (err) {
    console.error("❌ Telegram send error:", err);
  }
}

client.on("qr", async (qr) => {
  console.log("QR generated — sending to Telegram...");
  qrcode.generate(qr, { small: true }); // show in console too
  await sendToTelegram(qr);
});

client.on("ready", () => {
  console.log("✅ WhatsApp bot is ready!");
});

client.initialize();
