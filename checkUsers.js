const admin = require('firebase-admin');
const serviceAccount = require('./functions/lib/serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function check() {
  const users = await db.collection('users').limit(1).get();
  console.log('Users count:', users.size);
}
check();
