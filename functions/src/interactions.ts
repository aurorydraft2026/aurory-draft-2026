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
                case 'leaderboard':
                    await handleLeaderboard(interaction, res);
                    break;
                default:
                    res.status(200).json({
                        type: CHANNEL_MESSAGE,
                        data: {
                            content: '❓ Unknown command. Try `/balance` or `/leaderboard`.',
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

    if (!discordUserId) {
        res.status(200).json({
            type: CHANNEL_MESSAGE,
            data: {
                content: '❌ Could not identify your Discord account.',
                flags: 64
            }
        });
        return;
    }

    try {
        // Find the Asgard user linked to this Discord ID
        const db = admin.firestore();
        const usersSnap = await db.collection('users')
            .where('discordId', '==', discordUserId)
            .limit(1)
            .get();

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
        const valBalance = userData.valcoin || 0;
        const displayName = userData.displayName || 'Warrior';
        const avatar = userData.auroryProfilePicture || userData.photoURL || '';

        res.status(200).json({
            type: CHANNEL_MESSAGE,
            data: {
                embeds: [{
                    title: `💰 ${displayName}'s Balance`,
                    description: `You have **${valBalance.toLocaleString()} Valcoins** in your vault.`,
                    color: 0xD4AF37,
                    thumbnail: avatar ? { url: avatar } : undefined,
                    footer: {
                        text: 'Runie • Your Asgard Companion',
                        icon_url: 'https://asgard-duels.web.app/favicon.ico'
                    }
                }],
                flags: 64 // Only visible to the requesting user
            }
        });
    } catch (error: any) {
        console.error('Balance command error:', error.message);
        res.status(200).json({
            type: CHANNEL_MESSAGE,
            data: {
                content: '⚠️ Something went wrong while fetching your balance. Try again later.',
                flags: 64
            }
        });
    }
}

// ═══════════════════════════════════════════════════════
//  /leaderboard — Show Top Earners
// ═══════════════════════════════════════════════════════

async function handleLeaderboard(interaction: any, res: any) {
    try {
        const rtdb = admin.database();

        // Fetch top 10 all-time earners (Valcoins, all games)
        const snapshot = await rtdb.ref('leaderboards/earnings/val/all/all_time')
            .orderByChild('score')
            .limitToLast(10)
            .once('value');

        if (!snapshot.exists()) {
            res.status(200).json({
                type: CHANNEL_MESSAGE,
                data: {
                    content: '📊 No leaderboard data yet. Be the first to earn Valcoins!',
                }
            });
            return;
        }

        // Convert to sorted array (RTDB returns ascending, we want descending)
        const entries: { name: string; score: number }[] = [];
        snapshot.forEach((child: any) => {
            const data = child.val();
            entries.push({
                name: data.displayName || 'Unknown',
                score: data.score || 0
            });
        });
        entries.sort((a, b) => b.score - a.score);

        // Build the leaderboard text
        const medals = ['🥇', '🥈', '🥉'];
        const leaderboardText = entries.map((entry, i) => {
            const prefix = i < 3 ? medals[i] : `\`${i + 1}.\``;
            return `${prefix} **${entry.name}** — ${entry.score.toLocaleString()} Valcoins`;
        }).join('\n');

        res.status(200).json({
            type: CHANNEL_MESSAGE,
            data: {
                embeds: [{
                    title: '🏆 Asgard Leaderboard — All Time',
                    description: leaderboardText,
                    color: 0xF1C40F,
                    footer: {
                        text: 'Runie • Your Asgard Companion',
                        icon_url: 'https://asgard-duels.web.app/favicon.ico'
                    },
                    timestamp: new Date().toISOString()
                }]
            }
        });
    } catch (error: any) {
        console.error('Leaderboard command error:', error.message);
        res.status(200).json({
            type: CHANNEL_MESSAGE,
            data: {
                content: '⚠️ Something went wrong while fetching the leaderboard. Try again later.',
                flags: 64
            }
        });
    }
}
