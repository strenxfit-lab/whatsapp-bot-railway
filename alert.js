// alert.js
import axios from "axios";

const TELEGRAM_BOT_TOKEN = "8445228246:AAEjlvBb_umDbIEoroqswE3mCYZYh_UQMsc"; // Step 1 ka token
const TELEGRAM_CHAT_ID = "5132081198";     // Step 2 ka ID

export async function sendAlert(message) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  await axios.post(url, {
    chat_id: TELEGRAM_CHAT_ID,
    text: `⚠️ ${message}`,
  });
}
