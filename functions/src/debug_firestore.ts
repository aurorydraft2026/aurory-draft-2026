
import * as admin from 'firebase-admin';
import * as fs from 'fs';

// Initialize with service account if available, or application default credentials
// For local script, we might not have credentials easily available unless user has gcloud auth
// But let's try with admin.initializeApp() which picks up GOOGLE_APPLICATION_CREDENTIALS

if (!admin.apps.length) {
    // Try to load service account key if it exists in expected locations
    // Otherwise rely on default credentials
    admin.initializeApp();
}

const db = admin.firestore();

async function checkRecentDrafts() {
    console.log('Checking recent completed drafts...');
    try {
        const snapshot = await db.collection('drafts')
            .where('status', '==', 'completed')
            .orderBy('completedAt', 'desc')
            .limit(5)
            .get();

        if (snapshot.empty) {
            console.log('No completed drafts found.');
            return;
        }

        snapshot.forEach(doc => {
            const data = doc.data();
            console.log(`\nDraft ID: ${doc.id}`);
            console.log(`Title: ${data.title}`);
            console.log(`Draft Type: ${data.draftType}`);
            console.log(`Status: ${data.status}`);
            console.log(`Verification Status: ${data.verificationStatus}`);
            console.log(`Last Verification Check: ${data.lastVerificationCheck ? data.lastVerificationCheck.toDate().toISOString() : 'Never'}`);
            console.log(`Pool Amount: ${data.poolAmount}`);
            console.log(`Payout Complete: ${data.payoutComplete}`);
            console.log(`Winner: ${data.overallWinner}`);
            if (data.matchResults) {
                console.log(`Match Results count: ${data.matchResults.length}`);
                data.matchResults.forEach((r: any, i: number) => {
                    console.log(`  Result ${i}: Status=${r.status}, Winner=${r.winner}`);
                });
            } else {
                console.log('No match results.');
            }
        });

    } catch (error) {
        console.error('Error querying drafts:', error);
    }
}

checkRecentDrafts();
