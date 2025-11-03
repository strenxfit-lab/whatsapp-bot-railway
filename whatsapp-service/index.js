import * as baileys from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";
import admin from "firebase-admin";
import fetch from "node-fetch";

const { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = baileys;

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
    console.log("📢 Telegram alert sent:", msg);
  } catch (err) {
    console.error("❌ Telegram alert failed:", err.message);
  }
}

// ✅ WhatsApp Connection
async function connectBot() {
  const { state, saveCreds } = await useMultiFileAuthState("auth_info");
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    printQRInTerminal: true,
    auth: state,
  });

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === "open") console.log("✅ WhatsApp connected!");
    else if (connection === "close") {
      const reason = lastDisconnect?.error?.output?.statusCode;
      console.log("⚠️ Connection closed:", reason);
      await sendTelegramAlert("🚨 WhatsApp Bot LOGGED OUT! Please rescan QR.");
      setTimeout(connectBot, 5000);
    }
  });

  sock.ev.on("creds.update", saveCreds);
}

connectBot();
