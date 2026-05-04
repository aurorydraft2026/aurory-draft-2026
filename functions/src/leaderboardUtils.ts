import * as admin from 'firebase-admin';

/**
 * Update various leaderboard timeframes in RTDB. 
 * Weekly reset is Tuesday UTC 00:00.
 */
export async function updateLeaderboardStats(uid: string, name: string, avatar: string, amount: number, currency: string, gameId: string, eventDate?: Date) {
    if (!uid || amount <= 0) return;

    try {
        const rtdb = admin.database();
        const targetDate = eventDate || new Date();
        
        // 1. Timeframe Keys (UTC strict)
        const dailyKey = targetDate.toISOString().split('T')[0]; // YYYY-MM-DD
        const monthlyKey = `${targetDate.getUTCFullYear()}-${String(targetDate.getUTCMonth() + 1).padStart(2, '0')}`; // YYYY-MM
        
        // Weekly Key (Tuesday Start UTC 00:00)
        const day = targetDate.getUTCDay();
        // If today is Tuesday (2) or later, subtract (day - 2) days.
        // If today is Sunday (0) or Monday (1), subtract (day + 5) days.
        const diffToTuesday = day >= 2 ? day - 2 : day + 5;
        const tuesday = new Date(targetDate);
        tuesday.setUTCDate(targetDate.getUTCDate() - diffToTuesday);
        const weekStartKey = tuesday.toISOString().split('T')[0];

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
