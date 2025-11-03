// alert.js
import axios from "axios";

const TELEGRAM_BOT_TOKEN = "8499533147:AAEU0mkA7l0plfMHoK9zuYYmRdr_YOE-hik"; // Step 1 ka token
const TELEGRAM_CHAT_ID = "6077248442";     // Step 2 ka ID

export async function sendAlert(message) {
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  await axios.post(url, {
    chat_id: TELEGRAM_CHAT_ID,
    text: `⚠️ ${message}`,
  });
}
