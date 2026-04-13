const admin = require('firebase-admin');
admin.initializeApp({
  projectId: 'asgard-duels' // Use project ID directly for google-auth-library default credentials, or just initializeApp if FIREBASE_CONFIG is present
});
const db = admin.firestore();

async function check() {
  const users = await db.collection('users').limit(1).get();
  console.log('Users count:', users.size);
}
check().catch(console.error);
