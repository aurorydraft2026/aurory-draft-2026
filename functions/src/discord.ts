import * as functions from 'firebase-functions/v1';
import fetch from 'node-fetch';

/**
 * Discord Configuration
 * Note: For production, it's safer to use Firebase secrets, 
 * but for now we use the provided URL for immediate setup.
 */
const RAFFLE_WEBHOOK_URL = 'https://discord.com/api/webhooks/1488618433569489159/vFkiaYCtoi_eoFEWxWRc_LKBDjS0k1Z8ga1-7iRIB33JzunuWvCeqjKvE10VewQETsUK';

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
