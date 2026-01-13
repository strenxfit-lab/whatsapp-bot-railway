

const qrcode = require('qrcode-terminal');
const { Client, LocalAuth } = require('whatsapp-web.js');
const admin = require('firebase-admin');
const cron = require('node-cron');
const serviceAccount = require('./serviceAccountKey.json');

// Initialize Firebase Admin SDK
try {
    if (!admin.apps.length) {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
        });
        console.log("🔥 Firebase Admin Initialized Successfully.");
    }
} catch (error) {
    console.error("❌ Firebase Initialization Error:", error.message);
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

// --- Message Templates ---

const getPaymentConfirmationMessage = (memberName, amount, nextDueDate) => {
    const formattedDate = nextDueDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
    return `✅ Payment Confirmation
Hello ${memberName},

Your payment of ₹${amount} has been successfully submitted.

Your next due date is ${formattedDate}.

Thank you,
The Expert Hub Library`;
};


const getExpiringSoonMessage = (memberName, expiryDate, amount, libraryName) => {
    const formattedDate = expiryDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
    return `📚 The Expert Hub Library
Hello ${memberName},

This is a reminder that your library membership will expire on ${formattedDate}.

💰 Membership Fee: ₹${amount}

Please renew on time to avoid any interruption in services.

— The Expert Hub Library Team`;
};

const getExpiringTodayMessage = (memberName, amount, libraryName) => {
    return `⚠️ The Expert Hub Library – Important
Hello ${memberName},

Your library membership is expiring today.

💰 Renewal Fee: ₹${amount}

Kindly renew today to continue uninterrupted access.

Thank you,
The Expert Hub Library`;
};

const getExpiredMessage = (memberName, expiryDate, amount, libraryName) => {
    const formattedDate = expiryDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
    return `❌ The Expert Hub Library
Hello ${memberName},

Your library membership expired on ${formattedDate}.

💰 Pending Renewal Fee: ₹${amount}

Please note that services will remain inactive until renewal is completed.

For renewal, contact the library office.

— The Expert Hub Library`;
};


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
        
        // Start listening to the welcome message queue
        listenToMessageQueue();

        // Start listening to the payment message queue
        listenToPaymentMessageQueue();

        // Schedule the daily reminder check
        // Runs every day at 10:00 AM (India Standard Time)
        console.log("⏰ Scheduling daily membership reminder checks for 10:00 AM IST.");
        cron.schedule('0 10 * * *', checkAndSendReminders, {
            scheduled: true,
            timezone: "Asia/Kolkata"
        });

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
    console.log("🚀 Listening to Firestore message queue for new members...");

    db.collectionGroup('messageQueue').onSnapshot(snapshot => {
        snapshot.docChanges().forEach(change => {
            if (change.type === 'added') {
                const data = change.doc.data();
                if (data.status === 'pending') {
                    console.log(`📩 New welcome message in queue for ${data.memberName}.`);
                    processWelcomeMessage(change.doc.ref, data);
                }
            }
        });
    });
}

function listenToPaymentMessageQueue() {
    console.log("💰 Listening to Firestore payment message queue...");

    db.collectionGroup('paymentMessageQueue').onSnapshot(snapshot => {
        snapshot.docChanges().forEach(change => {
            if (change.type === 'added') {
                const data = change.doc.data();
                if (data.status === 'pending') {
                    console.log(`💳 New payment message in queue for ${data.memberName}.`);
                    processPaymentMessage(change.doc.ref, data);
                }
            }
        });
    });
}

async function processPaymentMessage(docRef, data) {
    console.log(`⚙️ Processing payment message for: ${data.memberName} (${data.to})`);

    if (!data.to || !data.memberName || !data.amount || !data.nextDueDate) {
        console.error(`❌ Invalid payment message data for doc ${docRef.id}. Missing required fields.`);
        await docRef.update({ status: 'failed', error: 'Missing required data fields for payment message.' });
        return;
    }

    try {
        const phoneNumber = data.to.replace(/\D/g, ''); // Remove non-digits
        if (phoneNumber.length < 10) {
            throw new Error("Invalid phone number format.");
        }
        
        const finalNumber = `91${phoneNumber.slice(-10)}`;
        const jid = `${finalNumber}@c.us`;
        
        const message = getPaymentConfirmationMessage(data.memberName, data.amount, data.nextDueDate.toDate());

        const isRegistered = await client.isRegisteredUser(jid);

        if (isRegistered) {
            await new Promise(res => setTimeout(res, 2000));
            await client.sendMessage(jid, message);
            console.log(`✅ Payment message sent successfully to ${data.memberName} (${finalNumber})`);

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
        console.error(`💥 Error processing payment message for ${data.memberName}:`, error.message);
        await docRef.update({
            status: 'failed',
            error: error.message,
        });
    }
}


// Rewritten function to generate the detailed, conditional welcome message
const getWelcomeMessage = (data) => {
    // Rule: Calculate date as exactly 30 days later
    const joiningDate = data.joiningDate.toDate();
    const nextDueDate = new Date(joiningDate);
    nextDueDate.setDate(nextDueDate.getDate() + 30);
    const formattedDueDate = nextDueDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });

    const seatType = data.seatType; // 'Fixed' or 'Random'
    const planName = data.planName || ''; // e.g., "3 Hours", "Random Seat 24hrs"

    // Determine the seat description for the fee breakdown
    let seatDescriptionForFee;
    if (planName.toLowerCase().includes('3hrs')) {
        seatDescriptionForFee = "3hrs Random Seat";
    } else if (planName.toLowerCase().includes('6hrs')) {
        seatDescriptionForFee = planName.toLowerCase().includes('unrestricted') 
            ? "6hrs Random Seat (No Restrictions)" 
            : "6hrs Random Seat";
    } else if (planName.toLowerCase().includes('corner')) {
        seatDescriptionForFee = "Corner Fixed Seat";
    } else if (seatType === 'Fixed') {
        seatDescriptionForFee = "Fixed Seat";
    } else { // Default to Random
        seatDescriptionForFee = "24hrs Random Seat";
    }

    // Header
    const line1 = `Thanks for Joining The Expert’s Hub Library Munirka New Delhi. Received your fees for ${planName}.\nyour next due date is on ${formattedDueDate}.`;

    // Fee breakdown
    const membershipLine = `${seatDescriptionForFee}-${data.membershipAmount}rs`;
    const registrationLine = data.registrationFee > 0 ? `Registration fees-${data.registrationFee}rs` : null;
    const securityLine = data.securityFee > 0 ? `Security fees-${data.securityFee}rs(refundable) only if you text 15 days before your due date that you are leaving the library` : null;
    
    const feeBreakdown = [membershipLine, registrationLine, securityLine].filter(Boolean).join('\n');

    // Policy text (static)
    const policyText = `Any indiscipline will lead to cancellation of your admission without any refund.\n\nThe fees is non refundable in any situation.\n\nNote:- 200rs security only refundable in case if you’re leaving the library and texting on WhatsApp 15 days before your due date, and it will adjustable if you went to vacation without any information and with information post your due date it will be adjustable and you have to pay again whenever you join again.\n\nOnce you take the security refund you have to pay registration and security fees again whenever you join again.`;
    
    // Conditional restrictions text
    let restrictionsText = '';
    if (data.accessRestriction && data.accessRestriction.hasRestriction) {
        restrictionsText = '\n\nRestrictions between 12pm-4:30pm( You can’t come and sit at this time)';
    }

    // Assemble the final message
    return `${line1}\n\n${feeBreakdown}\n\n${policyText}${restrictionsText}`;
};


async function processWelcomeMessage(docRef, data) {
    console.log(`⚙️ Processing welcome message for: ${data.memberName} (${data.to})`);

    // Validation for the new data structure
    if (!data.to || !data.memberName || !data.planName || !data.joiningDate || data.membershipAmount === undefined) {
        console.error(`❌ Invalid message data for doc ${docRef.id}. Missing required fields.`);
        await docRef.update({ status: 'failed', error: 'Missing required data fields for welcome message.' });
        return;
    }

    try {
        const phoneNumber = data.to.replace(/\D/g, ''); // Remove non-digits
        if (phoneNumber.length < 10) {
            throw new Error("Invalid phone number format.");
        }
        
        const finalNumber = `91${phoneNumber.slice(-10)}`;
        const jid = `${finalNumber}@c.us`;
        
        // Call the rewritten message generation function
        const welcomeMessage = getWelcomeMessage(data);

        console.log(`➡️ Verifying number and preparing to send welcome message to ${finalNumber}...`);

        const isRegistered = await client.isRegisteredUser(jid);

        if (isRegistered) {
            // Adding a small delay to make sending seem more natural
            await new Promise(res => setTimeout(res, 3000));

            await client.sendMessage(jid, welcomeMessage);
            console.log(`✅ Welcome message sent successfully to ${data.memberName} (${finalNumber})`);

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
        console.error(`💥 Error processing welcome message for ${data.memberName}:`, error.message);
        await docRef.update({
            status: 'failed',
            error: error.message,
        });
    }
}


// --- Automatic Reminder Logic ---

async function checkAndSendReminders() {
    console.log("\n-------------------------------------------");
    console.log(`[${new Date().toLocaleString('en-IN')}] 🏃‍♂️ Running daily membership reminder check...`);
    const librariesSnapshot = await db.collection('library').get();
    
    for (const libraryDoc of librariesSnapshot.docs) {
        const libraryId = libraryDoc.id;
        const libraryData = libraryDoc.data();
        const libraryName = libraryData.businessName || "The Expert Hub Library";

        console.log(`\n🔍 Checking library: ${libraryName} (${libraryId})`);

        const membersSnapshot = await db.collection('library').doc(libraryId).collection('members').get();
        if (membersSnapshot.empty) {
            console.log("   -> No members found in this library. Skipping.");
            continue;
        }

        for (const memberDoc of membersSnapshot.docs) {
            const member = memberDoc.data();
            member.id = memberDoc.id;
            const expiryDate = member.expiry_at?.toDate();

            if (!expiryDate || member.status !== 'Active') continue;

            const now = new Date();
            now.setHours(0, 0, 0, 0); // Normalize to start of day
            const expiry = new Date(expiryDate);
            expiry.setHours(0, 0, 0, 0); // Normalize to start of day

            const diffDays = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
            
            let reminderType = null;
            let message = null;

            if (diffDays === 7) {
                reminderType = 'expiring_7_days';
                message = getExpiringSoonMessage(member.name, expiryDate, member.amount || 0, libraryName);
            } else if (diffDays === 0) {
                reminderType = 'expiring_today';
                message = getExpiringTodayMessage(member.name, member.amount || 0, libraryName);
            } else if (diffDays < 0 && Math.abs(diffDays) === 1) { // Only send 'expired' message on the first day after expiry
                reminderType = 'expired_1_day';
                message = getExpiredMessage(member.name, expiryDate, member.amount || 0, libraryName);
            }

            if (reminderType && message) {
                const logCollection = db.collection('library').doc(libraryId).collection('members').doc(member.id).collection('whatsapp_logs');
                const logSnapshot = await logCollection.where('type', '==', reminderType).get();
                
                if (logSnapshot.empty) {
                    console.log(`   -> 📲 Queuing '${reminderType}' reminder for ${member.name}.`);
                    await sendWhatsAppMessage(member, message, logCollection, reminderType);
                } else {
                    // console.log(`   -> 🤫 Skipping '${reminderType}' for ${member.name} (already sent).`);
                }
            }
        }
    }
    console.log("✅ Daily reminder check finished.");
    console.log("-------------------------------------------\n");
}

async function sendWhatsAppMessage(member, message, logCollection, type) {
    try {
        const phoneNumber = member.contact.replace(/\D/g, '');
        if (phoneNumber.length < 10) throw new Error("Invalid phone number.");
        
        const finalNumber = `91${phoneNumber.slice(-10)}`;
        const jid = `${finalNumber}@c.us`;

        const isRegistered = await client.isRegisteredUser(jid);
        if (isRegistered) {
            await client.sendMessage(jid, message);
            await logCollection.add({
                type: type,
                status: 'sent',
                sentAt: admin.firestore.FieldValue.serverTimestamp(),
                message: message
            });
            console.log(`      ✅ Message sent to ${member.name}`);
        } else {
             await logCollection.add({
                type: type,
                status: 'failed',
                reason: 'Not a registered WhatsApp number',
                sentAt: admin.firestore.FieldValue.serverTimestamp(),
                message: message
            });
            console.log(`      ❌ Failed to send to ${member.name} (not registered).`);
        }
    } catch (error) {
        console.error(`      💥 Error sending message to ${member.name}:`, error.message);
         await logCollection.add({
            type: type,
            status: 'failed',
            reason: error.message,
            sentAt: admin.firestore.FieldValue.serverTimestamp(),
            message: message
        });
    }
}

