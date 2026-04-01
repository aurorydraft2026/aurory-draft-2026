import * as functions from 'firebase-functions/v1';
import fetch from 'node-fetch';

/**
 * Discord Configuration
 * Note: For production, it's safer to use Firebase secrets, 
 * but for now we use the provided URL for immediate setup.
 */
const RAFFLE_WEBHOOK_URL = 'https://discord.com/api/webhooks/1488618433569489159/vFkiaYCtoi_eoFEWxWRc_LKBDjS0k1Z8ga1-7iRIB33JzunuWvCeqjKvE10VewQETsUK';
const MATCHUP_WEBHOOK_URL = 'https://discord.com/api/webhooks/1488913883010699326/ZpuxD5BhbdpE5N78k0rsSW2oP3DryTKEIIE-oONR48-G0LAvPi-inp0aUJ3A67Bj0Kvv';

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
            const priceText = raffle.isFree ? '🆓 FREE ENTRY' : `🎟️ ${raffle.entryFee} AURY`;
            
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
            const embed = {
                title: `🎫 NEW RAFFLE: ${raffle.itemType}`,
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
                    text: 'Asgard Duels • Automated Announcement',
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
            console.log(`📣 Raffle Winner Selected: ${after.winner.displayName} for ${after.itemType}`);

            try {
                const winnerName = after.winner.displayName || 'Unknown Winner';
                const prizeName = after.itemType || 'Unknown Prize';
                const participantsCount = after.participantsCount || 0;

                // Build the Discord Success Embed (Success Green: #2ECC71)
                const embed = {
                    title: `🎊 RAFFLE WINNER ANNOUNCED! 🎊`,
                    description: `The lucky winner of the **${prizeName}** has been chosen!`,
                    color: 0x2ECC71, 
                    fields: [
                        {
                            name: '🏆 Winner',
                            value: `**${winnerName}**`,
                            inline: false
                        },
                        {
                            name: '🎁 Prize',
                            value: prizeName,
                            inline: true
                        },
                        {
                            name: '👥 Total Entries',
                            value: `${participantsCount} Participants`,
                            inline: true
                        }
                    ],
                    footer: {
                        text: 'Asgard Duels • Fair & Honest Raffles',
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
                    text: 'Asgard Duels • Tournament Matchups',
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
                        text: 'Asgard Duels • Official Results',
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
