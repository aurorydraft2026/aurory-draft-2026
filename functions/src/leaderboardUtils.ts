import * as admin from 'firebase-admin';

/**
 * Update various leaderboard timeframes in RTDB. 
 * Sunday is considered the start of the week.
 */
export async function updateLeaderboardStats(uid: string, name: string, avatar: string, amount: number, currency: string, gameId: string) {
    if (!uid || amount <= 0) return;

    try {
        const rtdb = admin.database();
        const now = new Date();
        
        // 1. Timeframe Keys
        const dailyKey = now.toISOString().split('T')[0]; // YYYY-MM-DD
        const monthlyKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`; // YYYY-MM
        
        // Weekly Key (Sunday Start)
        const sunday = new Date(now);
        sunday.setDate(now.getDate() - now.getDay());
        const weekStartKey = sunday.toISOString().split('T')[0];

        const paths = [
            `leaderboards/earnings/${currency}/${gameId}/all_time/${uid}`,
            `leaderboards/earnings/${currency}/${gameId}/monthly/${monthlyKey}/${uid}`,
            `leaderboards/earnings/${currency}/${gameId}/weekly/${weekStartKey}/${uid}`,
            `leaderboards/earnings/${currency}/${gameId}/daily/${dailyKey}/${uid}`,
            // Also update "all" aggregate
            `leaderboards/earnings/${currency}/all/all_time/${uid}`,
            `leaderboards/earnings/${currency}/all/monthly/${monthlyKey}/${uid}`,
            `leaderboards/earnings/${currency}/all/weekly/${weekStartKey}/${uid}`,
            `leaderboards/earnings/${currency}/all/daily/${dailyKey}/${uid}`
        ];

        for (const path of paths) {
            const ref = rtdb.ref(path);
            await ref.transaction((current) => {
                const data = current || { score: 0, displayName: name, photoURL: avatar };
                return {
                    ...data,
                    score: (data.score || 0) + amount,
                    displayName: name,
                    photoURL: avatar
                };
            });
        }
    } catch (e) {
        console.error('Leaderboard update failed:', e);
    }
}
