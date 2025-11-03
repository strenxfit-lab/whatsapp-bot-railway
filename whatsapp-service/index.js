
const qrcode = require('qrcode-terminal');
const { Client, LocalAuth } = require('whatsapp-web.js');
const admin = require('firebase-admin');

// Load Firebase Service Account from env
let serviceAccount;
try {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} catch (err) {
  console.error("❌ FIREBASE_SERVICE_ACCOUNT env variable missing or invalid.");
  process.exit(1);
}


const db = admin.firestore();

// Initialize WhatsApp Client
const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: 'whatsapp-session'
    }),
    puppeteer: {
        headless: true, // Run in background
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

// WhatsApp Event Listeners
client.on('qr', async (qr) => {
    console.log("📲 QR Code received. Scan to log in:");
    qrcode.generate(qr, { small: true });
    try {
        await db.collection('whatsapp-status').doc('connection').set({
            status: 'qr',
            qr: qr,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log("✅ QR code saved to Firestore.");
    } catch (e) {
        console.error("❌ Error saving QR code to Firestore:", e.message);
    }
});

client.on('ready', async () => {
    console.log("✅ WhatsApp Client is ready!");
    try {
        await db.collection('whatsapp-status').doc('connection').set({
            status: 'ready',
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        console.log("✅ Connection status set to 'ready' in Firestore.");
        listenToMessageQueue();
    } catch (e) {
        console.error("❌ Error updating connection status in Firestore:", e.message);
    }
});

client.on('auth_failure', async (msg) => {
    console.error('❌ Authentication Failed:', msg);
    try {
        await db.collection('whatsapp-status').doc('connection').set({ status: 'auth_failure', error: msg, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    } catch (e) {
        console.error("❌ Error updating auth_failure status in Firestore:", e.message);
    }
});

client.on('disconnected', async (reason) => {
    console.log('⚠️ WhatsApp disconnected:', reason);
    try {
        await db.collection('whatsapp-status').doc('connection').set({ status: 'disconnected', reason: reason, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    } catch (e) {
        console.error("❌ Error updating disconnected status in Firestore:", e.message);
    }
});

client.initialize().catch(err => console.error("❌ Client initialization failed:", err));


function listenToMessageQueue() {
    console.log("🚀 Listening to Firestore message queue...");

    db.collectionGroup('messageQueue').onSnapshot(snapshot => {
        snapshot.docChanges().forEach(change => {
            if (change.type === 'added') {
                const data = change.doc.data();
                if (data.status === 'pending') {
                    console.log(`📩 New message in queue for ${data.memberName}.`);
                    processMessage(change.doc.ref, data);
                }
            }
        });
    });
}

async function processMessage(docRef, data) {
    console.log(`⚙️ Processing message for: ${data.memberName} (${data.to})`);
    
    // Validate required data
    if (!data.to || !data.memberName || !data.loginId || !data.password) {
        console.error(`❌ Invalid message data for doc ${docRef.id}. Missing fields.`);
        await docRef.update({ status: 'failed', error: 'Missing required data fields.' });
        return;
    }

    try {
        const phoneNumber = data.to.replace(/\D/g, ''); // Remove non-digits
        if (phoneNumber.length < 10) {
             throw new Error("Invalid phone number format.");
        }
        
        const finalNumber = `91${phoneNumber.slice(-10)}`; // Ensure +91 format
        const jid = `${finalNumber}@c.us`;

        const message = `Welcome to Expert Hub Library 📚\n\nYour Login ID: ${data.loginId}\nPassword: ${data.password}\n\nLogin to manage your account: https://expert.strenxsoftware.in/auth/login`;

        console.log(`➡️ Verifying number and preparing to send to ${finalNumber}...`);

        const isRegistered = await client.isRegisteredUser(jid);

        if (isRegistered) {
            await new Promise(res => setTimeout(res, 3000)); // Delay to avoid rate-limiting

            await client.sendMessage(jid, message);
            console.log(`✅ Message sent successfully to ${data.memberName} (${finalNumber})`);

            await docRef.update({
                status: 'sent',
                sentAt: admin.firestore.FieldValue.serverTimestamp(),
            });
        } else {
            console.log(`❌ Number ${finalNumber} is not registered on WhatsApp.`);
            await docRef.update({
                status: 'failed',
                error: 'Not a registered WhatsApp number.',
            });
        }
    } catch (error) {
        console.error(`💥 Error processing message for ${data.memberName}:`, error.message);
        await docRef.update({
            status: 'failed',
            error: error.message,
        });
    }
}
