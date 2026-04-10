import * as functions from 'firebase-functions/v1';
import fetch from 'node-fetch';

/**
 * Discord Configuration
 * Runie — The Asgard Bot
 */
const RAFFLE_WEBHOOK_URL = 'https://discord.com/api/webhooks/1488618433569489159/vFkiaYCtoi_eoFEWxWRc_LKBDjS0k1Z8ga1-7iRIB33JzunuWvCeqjKvE10VewQETsUK';
const MATCHUP_WEBHOOK_URL = 'https://discord.com/api/webhooks/1488913883010699326/ZpuxD5BhbdpE5N78k0rsSW2oP3DryTKEIIE-oONR48-G0LAvPi-inp0aUJ3A67Bj0Kvv';
const DRAFT_WEBHOOK_URL = 'https://discord.com/api/webhooks/1489938404849352786/JYPXpsImnGS5Z19ZwO6c8qf66cjNBsKCmVcx4THjRpeoWqs56M5_VMKgkmII8ypA4DLB';
const GENERAL_WEBHOOK_URL = 'https://discord.com/api/webhooks/1492129011391008908/yiO-SAMvjoJXFync1kQoYnwFutN8-3Ig8srB4Ei0FFTPBAxX7WgvVMheObUg6Jaj8kWt';

// ─── RUNIE IDENTITY ───
const RUNIE_IDENTITY = {
    username: 'Runie',
    avatar_url: 'https://asgard-duels.web.app/favicon.ico' // TODO: Replace with Runie's custom avatar URL
};

// ─── RUNIE'S TIPS ───
const RUNIE_TIPS = [
    'Running low on Valcoins? Head to **Asgard Trials** and test your luck. Choose Odin\'s Fortune, Loot Box, or Drakkar Race and see what fate has in store for you. ⚔️',
    'Don\'t forget your **daily check-in**! Build your streak and earn even more Valcoins over time. 🔥',
    'Always check **Fate Draw**. The Gods might be feeling generous today. 🎰',
    'Our tournaments aren\'t just about power. **Strategy is key.** Join in, compete, and prove your mastery of your Amikos. 🏆',
    'New to Amiko Legends? Visit our Discord and explore our guides. Our **Wardens** are ready to help you get started. 🛡️',
    'Stay updated by following our socials. Never miss an event, announcement, or drop. 📢',
    'The Asgard Site is built for fun and rewards. Earn Aury, collect Amikos, and enjoy being part of the community. 🌟',
    'Keep an eye on the **news section** for upcoming events, major updates, and surprises. 📰',
];

/**
 * Trigger: When a new raffle is created in Firestore
 * Goal: Automatically announce it to the Discord server
 */
export const onRaffleCreated = functions.firestore
    .document('raffles/{raffleId}')
    .onCreate(async (snap, context) => {
        const raffle = snap.data();
        const raffleId = context.params.raffleId;

        if (!raffle) {
            console.log('No data associated with the raffle creation event');
            return;
        }

        console.log(`📣 New Raffle Detected: ${raffle.itemType} (${raffleId})`);

        try {
            // 1. Format pricing and dates
            const currency = raffle.entryFeeCurrency || 'AURY';
            const priceText = raffle.isFree ? '🆓 FREE ENTRY' : `🎟️ ${raffle.entryFee} ${currency}`;
            
            let endDateText = 'TBD';
            if (raffle.endDate) {
                const date = raffle.endDate.toDate ? raffle.endDate.toDate() : new Date(raffle.endDate);
                endDateText = date.toLocaleString('en-US', { 
                    month: 'short', 
                    day: 'numeric', 
                    year: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                    timeZoneName: 'short'
                });
            }

            // 2. Build the Discord Embed
            // Using a Gold/Amber color (#F0B232) for premium prize feel
            const displayItemType = (raffle.itemType === 'aury' || raffle.itemType === 'usdc') 
                ? `${raffle.itemType === 'aury' ? raffle.auryAmount : raffle.usdcAmount} ${raffle.itemType.toUpperCase()}`
                : raffle.itemType;

            const embed = {
                title: `🎫 NEW RAFFLE: ${displayItemType}`,
                description: raffle.description || 'No description provided.',
                url: `https://asgard-duels.web.app/`, // Update with your actual production domain
                color: 0xF0B232, 
                fields: [
                    {
                        name: '💰 Entry Fee',
                        value: priceText,
                        inline: true
                    },
                    {
                        name: '👥 Max Slots',
                        value: `${raffle.maxParticipants || 'Unlimited'} Entries`,
                        inline: true
                    },
                    {
                        name: '⏲️ Ends At',
                        value: endDateText,
                        inline: false
                    }
                ],
                footer: {
                    text: 'Asgard • Automated Announcement',
                    icon_url: 'https://asgard-duels.web.app/favicon.ico'
                },
                timestamp: new Date().toISOString()
            };

            // Add thumbnail if raffle has an image
            if (raffle.itemImage) {
                // Determine if it's base64 or URL
                if (raffle.itemImage.startsWith('http')) {
                    (embed as any).thumbnail = { url: raffle.itemImage };
                }
            }

            // 3. Send to Discord via Webhook
            const response = await fetch(RAFFLE_WEBHOOK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    content: '🚀 **A new raffle has just been posted!**',
                    embeds: [embed]
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Discord Webhook failed with status ${response.status}: ${errorText}`);
            }

            console.log(`✅ Successfully announced raffle ${raffleId} to Discord`);
        } catch (error: any) {
            console.error(`❌ Error announcing raffle ${raffleId} to Discord:`, error.message);
        }
    });

/**
 * Trigger: When a raffle is updated and a winner is chosen
 * Goal: Automatically announce the winner to Discord
 */
export const onRaffleWinnerSet = functions.firestore
    .document('raffles/{raffleId}')
    .onUpdate(async (change, context) => {
        const after = change.after.data();
        const before = change.before.data();
        const raffleId = context.params.raffleId;

        if (!after || !before) return;

        // Condition Check: Raffle status becomes 'completed' (when the wheel stops and completeRaffle is called)
        const wasNotCompleted = before.status !== 'completed';
        const isNowCompleted = after.status === 'completed';
        const hasWinnerSet = !!after.winner;

        if (wasNotCompleted && isNowCompleted && hasWinnerSet) {
            const winnerName = after.winner.playerName || after.winner.displayName || 'Unknown Winner';
            console.log(`📣 Raffle Winner Selected: ${winnerName} for ${after.itemType}`);

            try {
                const displayPrizeName = (after.itemType === 'aury' || after.itemType === 'usdc')
                    ? `${after.itemType === 'aury' ? after.auryAmount : after.usdcAmount} ${after.itemType.toUpperCase()}`
                    : (after.itemType || 'Unknown Prize');
                const participantsCount = after.participantsCount || 0;

                // Build the Discord Success Embed (Success Green: #2ECC71)
                const embed = {
                    title: `🎊 RAFFLE WINNER ANNOUNCED! 🎊`,
                    description: `The lucky winner of the **${displayPrizeName}** has been chosen!`,
                    color: 0x2ECC71, 
                    fields: [
                        {
                            name: '🏆 Winner',
                            value: `**${winnerName}**`,
                            inline: false
                        },
                        {
                            name: '🎁 Prize',
                            value: displayPrizeName,
                            inline: true
                        },
                        {
                            name: '👥 Total Entries',
                            value: `${participantsCount} Participants`,
                            inline: true
                        }
                    ],
                    footer: {
                        text: 'Asgard • Fair & Honest Raffles',
                        icon_url: 'https://asgard-duels.web.app/favicon.ico'
                    },
                    timestamp: new Date().toISOString()
                };

                // Add prize image as a large image if available
                if (after.itemImage && after.itemImage.startsWith('http')) {
                    (embed as any).image = { url: after.itemImage };
                }

                // Send to Discord via Webhook
                const response = await fetch(RAFFLE_WEBHOOK_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        content: `🎉 **Congratulations to our latest winner!** 🎊`,
                        embeds: [embed]
                    })
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`Discord Webhook failed with status ${response.status}: ${errorText}`);
                }

                console.log(`✅ Successfully announced winner of ${raffleId} to Discord`);

                // ─── ADD IN-APP NOTIFICATION ───
                const admin = require('firebase-admin');
                const adminDb = admin.firestore();
                const winnerUid = after.winner.uid;
                
                if (winnerUid) {
                    const notifyId = `win_${raffleId}`;
                    const notifyRef = adminDb.collection('users').doc(winnerUid).collection('notifications').doc(notifyId);
                    
                    // Use set() to ensure idempotency
                    await notifyRef.set({
                        title: '🎊 YOU WON A RAFFLE! 🎊',
                        message: `Congratulations! You won the ${displayPrizeName} raffle. Your prize has been automatically credited!`,
                        type: 'raffle',
                        icon: '🏆',
                        link: `/raffle/${raffleId}`,
                        read: false,
                        createdAt: admin.firestore.FieldValue.serverTimestamp()
                    });
                    console.log(`✅ Successfully sent in-app notification to winner ${winnerUid}`);
                }
            } catch (error: any) {
                console.error(`❌ Error announcing winner of ${raffleId} to Discord:`, error.message);
            }
        }
    });

/**
 * Trigger: When a new matchup or tournament is created in Firestore
 * Goal: Announce it to the Discord server
 */
export const onMatchupCreated = functions.firestore
    .document('matchups/{matchupId}')
    .onCreate(async (snap, context) => {
        const matchup = snap.data();
        const matchupId = context.params.matchupId;

        if (!matchup) return;

        console.log(`📣 New Matchup Detected: ${matchup.title} (${matchupId})`);

        try {
            // 1. Format pricing
            const poolPrize = matchup.poolPrize || 0;
            const entryFee = (matchup.entryFeeAmount || 0) / 1e9;
            const priceText = matchup.requiresEntryFee ? `🎟️ ${entryFee} AURY` : '🆓 FREE';

            // 2. Format Matchup Names (Player vs Player)
            let matchTitle = matchup.title || 'New Tournament';
            if (matchup.format === 'individual' && matchup.participants && matchup.participants.length === 2) {
                const uids = matchup.participants;
                const userDocs = await Promise.all(uids.map((uid: string) => 
                    require('firebase-admin').firestore().collection('users').doc(uid).get()
                ));
                const names = userDocs.map(doc => doc.exists ? (doc.data()?.displayName || 'Unknown') : 'Unknown');
                matchTitle = `🆚 ${names[0]} vs ${names[1]}`;
            }

            // 3. Build the Discord Embed (Azure Blue: #3498DB)
            const embed = {
                title: matchTitle,
                description: matchup.description || 'No description provided.',
                url: `https://asgard-duels.web.app/matchup/${matchupId}`,
                color: 0x3498DB,
                fields: [
                    {
                        name: '💰 Prize Pool',
                        value: `${poolPrize} AURY`,
                        inline: true
                    },
                    {
                        name: '🎟️ Entry',
                        value: priceText,
                        inline: true
                    },
                    {
                        name: '⚔️ Mode',
                        value: matchup.draftType || 'TBD',
                        inline: true
                    }
                ],
                footer: {
                    text: 'Asgard • Tournament Matchups',
                    icon_url: 'https://asgard-duels.web.app/favicon.ico'
                },
                timestamp: new Date().toISOString()
            };

            // 4. Send to Discord
            await fetch(MATCHUP_WEBHOOK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    content: '🚀 **A new Tournament Matchup has been posted!**',
                    embeds: [embed]
                })
            });

            console.log(`✅ Successfully announced matchup ${matchupId} to Discord`);
        } catch (error: any) {
            console.error(`❌ Error announcing matchup ${matchupId} to Discord:`, error.message);
        }
    });

/**
 * Trigger: When a tournament is completed
 * Goal: Announce the top winners to Discord
 */
export const onMatchupWinner = functions.firestore
    .document('matchups/{matchupId}')
    .onUpdate(async (change, context) => {
        const after = change.after.data();
        const before = change.before.data();
        const matchupId = context.params.matchupId;

        if (!after || !before) return;

        // Check if phase changed to 'completed'
        if (before.phase !== 'completed' && after.phase === 'completed' && after.finalStandings) {
            console.log(`📣 Tournament Completed: ${after.title}`);

            try {
                const standings = after.finalStandings || [];
                // Sort by rank to ensure 1, 2, 3 order
                standings.sort((a: any, b: any) => a.rank - b.rank);

                const winnersText = standings.slice(0, 3).map((s: any) => {
                    const medal = s.rank === 1 ? '🥇' : s.rank === 2 ? '🥈' : '🥉';
                    return `${medal} **${s.playerName || 'Unknown'}**`;
                }).join('\n');

                const embed = {
                    title: `🏆 TOURNAMENT COMPLETED: ${after.title}`,
                    description: `The battles are over! Here are the final rankings:`,
                    color: 0xF1C40F, // Goldish Color
                    fields: [
                        {
                            name: '📊 Final Results',
                            value: winnersText || 'No winners recorded.',
                            inline: false
                        }
                    ],
                    footer: {
                        text: 'Asgard • Official Results',
                        icon_url: 'https://asgard-duels.web.app/favicon.ico'
                    },
                    timestamp: new Date().toISOString()
                };

                await fetch(MATCHUP_WEBHOOK_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        content: '🎉 **Tournament Results are in!** 🎊',
                        embeds: [embed]
                    })
                });

                console.log(`✅ Successfully announced results of ${matchupId} to Discord`);
            } catch (error: any) {
                console.error(`❌ Error announcing results of ${matchupId} to Discord:`, error.message);
            }
        }
    });

/**
 * Trigger: When a new draft is created in Firestore
 * Goal: Announce it to the Discord server
 */
export const onDraftCreated = functions.firestore
    .document('drafts/{draftId}')
    .onCreate(async (snap, context) => {
        const draft = snap.data();
        const draftId = context.params.draftId;

        if (!draft) return;

        // Ensure this draft is related to a matchup (not a direct challenge friendly match)
        if (!draft.matchupId) return;

        console.log(`📣 New Draft Detected: ${draft.title} (${draftId})`);

        try {
            const teamA = draft.teamNames?.team1 || 'Player 1';
            const teamB = draft.teamNames?.team2 || 'Player 2';
            const draftType = draft.draftType || 'Unknown Mode';
            const tournamentName = draft.title?.split(' — ')[0] || 'Tournament Match';

            // Build the Discord Embed (Purple: 0x9B59B6)
            const embed = {
                title: `⚔️ NEW DRAFT READY`,
                description: `A tournament draft is about to begin!`,
                url: `https://asgard-duels.web.app/tournament/${draftId}`,
                color: 0x9B59B6,
                fields: [
                    {
                        name: '🏆 Tournament',
                        value: tournamentName,
                        inline: false
                    },
                    {
                        name: '🆚 Matchup',
                        value: `**${teamA}** vs **${teamB}**`,
                        inline: true
                    },
                    {
                        name: '⚔️ Mode',
                        value: draftType,
                        inline: true
                    }
                ],
                footer: {
                    text: 'Asgard • Automated Announcement',
                    icon_url: 'https://asgard-duels.web.app/favicon.ico'
                },
                timestamp: new Date().toISOString()
            };

            // Send to Discord
            const response = await fetch(DRAFT_WEBHOOK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    content: '🚀 **A new Tournament Draft is ready!**',
                    embeds: [embed]
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Discord Webhook failed with status ${response.status}: ${errorText}`);
            }

            console.log(`✅ Successfully announced draft ${draftId} to Discord`);
        } catch (error: any) {
            console.error(`❌ Error announcing draft ${draftId} to Discord:`, error.message);
        }
    });

// ═══════════════════════════════════════════════════════
//  RUNIE — SCHEDULED TIPS
// ═══════════════════════════════════════════════════════

/**
 * Trigger: Runs every 6 hours via Cloud Scheduler
 * Goal: Randomly post a helpful tip to Discord (50% chance per run = ~2 tips/day)
 */
export const scheduledRunieTips = functions.pubsub
    .schedule('every 6 hours')
    .onRun(async () => {
        // 50% chance to post — makes the timing feel organic
        if (Math.random() > 0.5) {
            console.log('Runie decided to stay quiet this time. 🤫');
            return;
        }

        const tip = RUNIE_TIPS[Math.floor(Math.random() * RUNIE_TIPS.length)];

        try {
            const embed = {
                title: '💡 Runie\'s Tip of the Day',
                description: tip,
                color: 0xD4AF37, // Gold
                footer: {
                    text: 'Runie • Your Asgard Companion',
                    icon_url: 'https://asgard-duels.web.app/favicon.ico'
                },
                timestamp: new Date().toISOString()
            };

            await fetch(GENERAL_WEBHOOK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...RUNIE_IDENTITY,
                    embeds: [embed]
                })
            });

            console.log('✅ Runie posted a tip!');
        } catch (error: any) {
            console.error('❌ Runie tip failed:', error.message);
        }
    });

// ═══════════════════════════════════════════════════════
//  RUNIE — WELCOME NEW USERS
// ═══════════════════════════════════════════════════════

/**
 * Trigger: When a new user document is created in Firestore
 * Goal: Announce the new warrior in Discord
 */
export const onNewUserWelcome = functions.firestore
    .document('users/{uid}')
    .onCreate(async (snap) => {
        const user = snap.data();
        if (!user) return;

        const displayName = user.displayName || 'A new warrior';
        const avatar = user.auroryProfilePicture || user.photoURL || '';

        try {
            const embed = {
                title: '⚔️ A New Warrior Enters Asgard!',
                description: `Welcome **${displayName}** to the halls of Asgard! May the runes favor your journey. 🛡️`,
                color: 0x3498DB, // Blue
                thumbnail: avatar ? { url: avatar } : undefined,
                footer: {
                    text: 'Runie • Your Asgard Companion',
                    icon_url: 'https://asgard-duels.web.app/favicon.ico'
                },
                timestamp: new Date().toISOString()
            };

            await fetch(GENERAL_WEBHOOK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...RUNIE_IDENTITY,
                    embeds: [embed]
                })
            });

            console.log(`✅ Runie welcomed ${displayName} to Asgard!`);
        } catch (error: any) {
            console.error(`❌ Runie welcome failed:`, error.message);
        }
    });
