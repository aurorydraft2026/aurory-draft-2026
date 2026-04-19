const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json'); // Assumes credentials exist

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function initSettings() {
  await db.collection('settings').doc('valcoin_rewards').set({
    registerLinked: 10000,
    ownAurorian: 50000,
    joinRaffle: 5000,
    tournamentWinParticipation: 5000,
    dailyCheckIn: 100,
    referralBonus: 20000
  }, { merge: true });
  console.log('Successfully written valcoin_rewards settings.');
}

initSettings().catch(console.error);
