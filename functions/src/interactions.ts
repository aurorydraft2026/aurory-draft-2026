import * as admin from 'firebase-admin';
import { onRequest } from 'firebase-functions/v2/https';
import * as nacl from 'tweetnacl';

// ═══════════════════════════════════════════════════════
//  RUNIE — DISCORD INTERACTIONS (Slash Commands)
// ═══════════════════════════════════════════════════════

// Discord Public Key (safe to hardcode — this is a public verification key, not a secret)
const DISCORD_PUBLIC_KEY = 'd97d23321bcd603d169410a67f43ad64f3f06b211585e8219e12ea4a6a214f9e';

// Interaction Types
const PING = 1;
const APPLICATION_COMMAND = 2;

// Response Types
const PONG = 1;
const CHANNEL_MESSAGE = 4;

/**
 * Discord Interactions Endpoint
 * This function receives slash command interactions from Discord,
 * verifies their authenticity, and responds accordingly.
 */
export const discordInteraction = onRequest(
    {
        cors: true,
        maxInstances: 10,
        timeoutSeconds: 30,
        memory: '256MiB',
        region: 'us-central1'
    },
    async (req, res) => {
        // Only accept POST
        if (req.method !== 'POST') {
            res.status(405).send('Method Not Allowed');
            return;
        }

        // ─── SIGNATURE VERIFICATION ───
        const signature = req.headers['x-signature-ed25519'] as string;
        const timestamp = req.headers['x-signature-timestamp'] as string;
        const rawBody = JSON.stringify(req.body);

        if (!signature || !timestamp) {
            res.status(401).send('Missing signature headers');
            return;
        }

        try {
            const isVerified = nacl.sign.detached.verify(
                Buffer.from(timestamp + rawBody),
                Buffer.from(signature, 'hex'),
                Buffer.from(DISCORD_PUBLIC_KEY, 'hex')
            );

            if (!isVerified) {
                res.status(401).send('Invalid request signature');
                return;
            }
        } catch (err) {
            console.error('Signature verification error:', err);
            res.status(401).send('Invalid request signature');
            return;
        }

        // ─── HANDLE INTERACTION ───
        const interaction = req.body;

        // Discord sends a PING to validate the endpoint
        if (interaction.type === PING) {
            res.status(200).json({ type: PONG });
            return;
        }

        // Handle slash commands
        if (interaction.type === APPLICATION_COMMAND) {
            const commandName = interaction.data?.name;

            switch (commandName) {
                case 'balance':
                    await handleBalance(interaction, res);
                    break;
                case 'wealth':
                    await handleWealth(interaction, res);
                    break;
                case 'leaderboard':
                    await handleLeaderboard(interaction, res);
                    break;
                default:
                    res.status(200).json({
                        type: CHANNEL_MESSAGE,
                        data: {
                            content: '❓ Unknown command. Try `/balance`, `/wealth`, or `/leaderboard`.',
                            flags: 64 // Ephemeral (only visible to the user)
                        }
                    });
            }
            return;
        }

        res.status(400).send('Unknown interaction type');
    }
);

// ═══════════════════════════════════════════════════════
//  /balance — Check Valcoin Balance
// ═══════════════════════════════════════════════════════

async function handleBalance(interaction: any, res: any) {
    const discordUserId = interaction.member?.user?.id || interaction.user?.id;
    const options = interaction.data?.options || [];
    const typeValue = options.find((opt: any) => opt.name === 'type')?.value || 'valcoins';

    if (!discordUserId) {
        res.status(200).json({
            type: CHANNEL_MESSAGE,
            data: { content: '❌ Could not identify your Discord account.', flags: 64 }
        });
        return;
    }

    try {
        const db = admin.firestore();
        const usersSnap = await db.collection('users').where('discordId', '==', discordUserId).limit(1).get();

        if (usersSnap.empty) {
            res.status(200).json({
                type: CHANNEL_MESSAGE,
                data: {
                    embeds: [{
                        title: '🔗 Account Not Linked',
                        description: 'Your Discord account is not linked to an Asgard account.\n\nLog in at [asgard-duels.web.app](https://asgard-duels.web.app) with Discord to get started!',
                        color: 0xE74C3C
                    }],
                    flags: 64
                }
            });
            return;
        }

        const userData = usersSnap.docs[0].data();
        const uid = usersSnap.docs[0].id;
        const displayName = userData.displayName || 'Warrior';
        const avatar = userData.auroryProfilePicture || userData.photoURL || '';
        
        let title = '';
        let description = '';
        let color = 0xD4AF37;

        if (typeValue === 'valcoins') {
            const valBalance = userData.valcoin || userData.points || 0;
            title = `💰 ${displayName}'s Valcoins`;
            description = `You have **${valBalance.toLocaleString()} Valcoins** in your vault.`;
        } else if (typeValue === 'aury' || typeValue === 'usdc') {
            const walletsSnap = await db.collection('wallets').doc(uid).get();
            const walletData = walletsSnap.exists ? walletsSnap.data() : null;
            if (typeValue === 'aury') {
                const bal = ((walletData?.balance || 0) / 1e9).toFixed(2);
                title = `⚡ ${displayName}'s AURY`;
                description = `You have **${bal} AURY** in your synced wallet.`;
                color = 0x9B59B6;
            } else {
                const bal = ((walletData?.usdcBalance || 0) / 1e6).toFixed(2);
                title = `💲 ${displayName}'s USDC`;
                description = `You have **${bal} USDC** in your synced wallet.`;
                color = 0x2ECC71;
            }
        }

        res.status(200).json({
            type: CHANNEL_MESSAGE,
            data: {
                embeds: [{
                    title,
                    description,
                    color,
                    thumbnail: avatar ? { url: avatar } : undefined,
                    footer: { text: 'Runie • Your Asgard Companion', icon_url: 'https://asgard-duels.web.app/favicon.ico' }
                }],
                flags: 64
            }
        });
    } catch (error: any) {
        console.error('Balance command error:', error.message);
        res.status(200).json({
            type: CHANNEL_MESSAGE,
            data: { content: '⚠️ Something went wrong while fetching your balance.', flags: 64 }
        });
    }
}

// ═══════════════════════════════════════════════════════
//  /wealth — Check Minigame Earnings
// ═══════════════════════════════════════════════════════

async function handleWealth(interaction: any, res: any) {
    const discordUserId = interaction.member?.user?.id || interaction.user?.id;
    const options = interaction.data?.options || [];
    const gameValue = options.find((opt: any) => opt.name === 'game')?.value || 'slotMachine';

    if (!discordUserId) {
        res.status(200).json({
            type: CHANNEL_MESSAGE,
            data: { content: '❌ Could not identify your Discord account.', flags: 64 }
        });
        return;
    }

    try {
        const db = admin.firestore();
        const usersSnap = await db.collection('users').where('discordId', '==', discordUserId).limit(1).get();

        if (usersSnap.empty) {
            res.status(200).json({
                type: CHANNEL_MESSAGE,
                data: {
                    embeds: [{
                        title: '🔗 Account Not Linked',
                        description: 'Your Discord account is not linked to an Asgard account.\n\nLog in at [asgard-duels.web.app](https://asgard-duels.web.app) with Discord to get started!',
                        color: 0xE74C3C
                    }],
                    flags: 64
                }
            });
            return;
        }

        const userData = usersSnap.docs[0].data();
        const uid = usersSnap.docs[0].id;
        const avatar = userData.auroryProfilePicture || userData.photoURL || '';

        const rtdb = admin.database();
        const snap = await rtdb.ref(`leaderboards/earnings/valcoins/${gameValue}/all_time/${uid}`).once('value');
        const data = snap.exists() ? snap.val() : null;
        const score = data?.score || 0;
        
        const gameNames: Record<string, string> = {
            slotMachine: '🎰 Slot Machine',
            treasureChest: '📦 Loot Box',
            drakkarRace: '⛵ Drakkar Race'
        };
        const title = `${gameNames[gameValue] || 'Game'} Earnings`;
        const description = `You have earned a total of **${score.toLocaleString()} Valcoins** from this game!`;
        const color = 0xF1C40F; // Gold

        res.status(200).json({
            type: CHANNEL_MESSAGE,
            data: {
                embeds: [{
                    title,
                    description,
                    color,
                    thumbnail: avatar ? { url: avatar } : undefined,
                    footer: { text: 'Runie • Your Asgard Companion', icon_url: 'https://asgard-duels.web.app/favicon.ico' }
                }],
                flags: 64
            }
        });
    } catch (error: any) {
        console.error('Wealth command error:', error.message);
        res.status(200).json({
            type: CHANNEL_MESSAGE,
            data: { content: '⚠️ Something went wrong while fetching your wealth.', flags: 64 }
        });
    }
}

// ═══════════════════════════════════════════════════════
//  /leaderboard — Show Top Earners
// ═══════════════════════════════════════════════════════

async function handleLeaderboard(interaction: any, res: any) {
    const options = interaction.data?.options || [];
    const category = options.find((opt: any) => opt.name === 'category')?.value || 'valcoins';

    try {
        let leaderboardText = '';
        let title = '';
        let color = 0xF1C40F;

        const db = admin.firestore();
        const rtdb = admin.database();
        const medals = ['🥇', '🥈', '🥉'];

        if (category === 'valcoins') {
            const snapshot = await rtdb.ref('leaderboards/earnings/valcoins/all/all_time').orderByChild('score').limitToLast(10).once('value');
            if (!snapshot.exists()) {
                leaderboardText = '📊 No leaderboard data yet.';
            } else {
                const entries: { name: string; score: number }[] = [];
                snapshot.forEach((child: any) => { entries.push({ name: child.val().displayName || 'Unknown', score: child.val().score || 0 }); });
                entries.sort((a, b) => b.score - a.score);
                leaderboardText = entries.map((e, i) => `${i < 3 ? medals[i] : `\`${i + 1}.\``} **${e.name}** — ${e.score.toLocaleString()} Valcoins`).join('\n');
            }
            title = '🏆 Top Valcoin Earners — All Time';

        } else if (category === 'aury' || category === 'usdc') {
            const field = category === 'aury' ? 'balance' : 'usdcBalance';
            const divisor = category === 'aury' ? 1e9 : 1e6;
            const snap = await db.collection('wallets').orderBy(field, 'desc').limit(10).get();
            if (snap.empty) {
                leaderboardText = '📊 No leaderboard data yet.';
            } else {
                const results = await Promise.all(snap.docs.map(async (doc) => {
                    const data = doc.data();
                    const val = (data[field] || 0) / divisor;
                    const uSnap = await db.collection('users').doc(doc.id).get();
                    const uData = uSnap.exists ? uSnap.data() : null;
                    return { name: uData?.auroryPlayerName || uData?.displayName || 'Warrior', score: val };
                }));
                const validResults = results.filter(r => r.score > 0).sort((a, b) => b.score - a.score).slice(0, 10);
                if (validResults.length === 0) leaderboardText = '📊 No leaderboard data yet.';
                else leaderboardText = validResults.map((e, i) => `${i < 3 ? medals[i] : `\`${i + 1}.\``} **${e.name}** — ${e.score.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} ${category.toUpperCase()}`).join('\n');
            }
            title = `💰 Top ${category.toUpperCase()} Balances`;
            color = category === 'aury' ? 0x9B59B6 : 0x2ECC71;

        } else if (category === 'best_players') {
            // Fetch top verified matchups to count wins
            const snap = await db.collection('drafts')
                .where('verificationStatus', 'in', ['complete', 'partial'])
                .orderBy('verifiedAt', 'desc')
                .limit(100)
                .get();

            if (snap.empty) {
                leaderboardText = '📊 No tournament data yet.';
            } else {
                const winCounts: Record<string, { name: string, wins: number }> = {};
                
                snap.docs.forEach(doc => {
                    const data = doc.data();
                    if (!data.overallWinner || data.overallWinner === 'draw') return;
                    
                    const players = data.matchPlayers || (data.finalAssignments ? data.finalAssignments.map((a:any) => ({ team: a.team, uid: a.participant?.uid || a.participant?.id, displayName: a.participant?.displayName || a.participant?.auroryPlayerName })) : []);
                    
                    players.forEach((p: any) => {
                        if (p.team === data.overallWinner) {
                            const uid = p.uid || p.id;
                            if (uid) {
                                if (!winCounts[uid]) winCounts[uid] = { name: p.displayName || p.auroryPlayerName || 'Warrior', wins: 0 };
                                winCounts[uid].wins += 1;
                            }
                        }
                    });
                });

                const entries = Object.values(winCounts).sort((a, b) => b.wins - a.wins).slice(0, 10);
                if (entries.length === 0) leaderboardText = '📊 No tournament winners yet.';
                else leaderboardText = entries.map((e, i) => `${i < 3 ? medals[i] : `\`${i + 1}.\``} **${e.name}** — ${e.wins} Wins`).join('\n');
            }
            title = '⚔️ Best Players — Recent Tournaments';
            color = 0xE67E22;
        } else if (category === 'slotMachine' || category === 'treasureChest' || category === 'drakkarRace') {
            const gameNames: Record<string, string> = {
                slotMachine: '🎰 Slot Machine',
                treasureChest: '📦 Loot Box',
                drakkarRace: '⛵ Drakkar Race'
            };
            const snapshot = await rtdb.ref(`leaderboards/earnings/valcoins/${category}/all_time`).orderByChild('score').limitToLast(10).once('value');
            if (!snapshot.exists()) {
                leaderboardText = `📊 No ${gameNames[category]} data yet.`;
            } else {
                const entries: { name: string; score: number }[] = [];
                snapshot.forEach((child: any) => { entries.push({ name: child.val().displayName || 'Unknown', score: child.val().score || 0 }); });
                entries.sort((a, b) => b.score - a.score);
                leaderboardText = entries.map((e, i) => `${i < 3 ? medals[i] : `\`${i + 1}.\``} **${e.name}** — ${e.score.toLocaleString()} Valcoins`).join('\n');
            }
            title = `🏆 Top ${gameNames[category]} Earners`;
            color = 0xF1C40F;
        } else if (category === 'referral') {
            const snap = await db.collection('users').orderBy('referralCount', 'desc').limit(10).get();
            if (snap.empty) {
                leaderboardText = '📊 No referral data yet.';
            } else {
                const results = snap.docs.map(doc => {
                    const data = doc.data();
                    return { name: data.displayName || 'Warrior', score: data.referralCount || 0 };
                });
                const validResults = results.filter(r => r.score > 0);
                if (validResults.length === 0) leaderboardText = '📊 No referrals recorded yet.';
                else leaderboardText = validResults.map((e, i) => `${i < 3 ? medals[i] : `\`${i + 1}.\``} **${e.name}** — ${e.score} Recruits`).join('\n');
            }
            title = '🤝 Top Recruiters — All Time';
            color = 0x3498DB;
        }

        res.status(200).json({
            type: CHANNEL_MESSAGE,
            data: {
                embeds: [{
                    title,
                    description: leaderboardText,
                    color,
                    footer: { text: 'Runie • Your Asgard Companion', icon_url: 'https://asgard-duels.web.app/favicon.ico' },
                    timestamp: new Date().toISOString()
                }]
            }
        });
    } catch (error: any) {
        console.error('Leaderboard command error:', error.message);
        res.status(200).json({
            type: CHANNEL_MESSAGE,
            data: { content: '⚠️ Something went wrong while fetching the leaderboard.', flags: 64 }
        });
    }
}
