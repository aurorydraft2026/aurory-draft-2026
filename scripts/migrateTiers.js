const admin = require('firebase-admin');

// IMPORTANT: Requires serviceAccountKey.json in the same directory, or GOOGLE_APPLICATION_CREDENTIALS
// set in the environment.
const serviceAccount = require('./serviceAccountKey.json'); // Provide your own key

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

async function migrateUsers() {
  console.log('Starting user migration for Tier & Referral system...');
  const usersSnapshot = await db.collection('users').get();
  
  const existingCodes = new Set();
  
  // First pass: collect all existing codes
  usersSnapshot.forEach(doc => {
    const data = doc.data();
    if (data.referralCode) {
      existingCodes.add(data.referralCode);
    }
  });

  let updatedCount = 0;
  
  for (const userDoc of usersSnapshot.docs) {
    const data = userDoc.data();
    const updates = {};
    
    if (!data.tier) {
      updates.tier = 1;
    }
    
    if (!data.referralCode) {
      let code = '';
      let attempts = 0;
      do {
        code = generateCode();
        attempts++;
      } while (existingCodes.has(code) && attempts < 100);
      
      existingCodes.add(code);
      updates.referralCode = code;
    }
    
    if (Object.keys(updates).length > 0) {
      await userDoc.ref.update(updates);
      console.log(`Updated user ${userDoc.id} with`, updates);
      updatedCount++;
    }
  }
  
  console.log(`Migration complete! Updated ${updatedCount} users.`);
}

migrateUsers().catch(console.error);
