import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { GoogleGenerativeAI } from '@google/generative-ai';

// API Configuration is handled via .env (GEMINI_API_KEY)
// Version: 1.0.2 - Forcing redeploy to activate new token

const SUPER_ADMIN_UIDS = ['wgPwCyYGuYUAokSklV1LNsjCrGA3'];

const SPEED_MATRIX: number[][] = [
    [16, 8, 9, 10, 11, 12, 14], // Sleipnir Swift
    [11, 12, 14, 16, 8, 9, 10], // Jörmungandr
    [9, 10, 11, 12, 14, 16, 8], // Ironbound Hulk
    [12, 14, 16, 8, 9, 10, 11], // Hugin's Shadow
    [14, 16, 8, 9, 10, 11, 12], // Drakkar Prime
    [8, 9, 10, 11, 12, 14, 16], // Freyja's Chariot
    [10, 11, 12, 14, 16, 8, 9], // Norse Raider
];

/** Prophecy Weighted Random Helper */
function selectWeightedPrize(prizes: any[], noWinWeight = 0) {
    const prizesWeight = prizes.reduce((sum, p) => sum + (p.weight ?? 1), 0);
    const totalWeight = prizesWeight + (noWinWeight || 0);
    if (totalWeight <= 0) return null;

    let random = Math.random() * totalWeight;
    if (random < noWinWeight) return null;
    random -= noWinWeight;

    for (const prize of prizes) {
        const weight = prize.weight ?? 1;
        if (weight <= 0) continue;
        random -= weight;
        if (random <= 0) return prize;
    }
    return prizes.filter(p => (p.weight ?? 1) > 0).pop() || null;
}

export const chatWithRunie = onCall({
    memory: '256MiB',
    maxInstances: 10,
    region: 'us-central1'
}, async (request) => {
    const auth = request.auth;
    const userMessage = (request.data.message || '').trim().toLowerCase();

    // --- PRIVATE COMMAND: /drakkarbet ---
    if (userMessage === '/drakkarbet') {
        if (!auth || !SUPER_ADMIN_UIDS.includes(auth.uid)) {
            return { reply: "The winds of fate are hidden from those without the Valkyrie's sight.", engine: 'system' };
        }

        try {
            const rtdb = admin.database();
            const stateSnap = await rtdb.ref('drakkar_race/state').get();
            const state = stateSnap.val();

            if (!state || state.phase !== 'betting') {
                return { reply: "The ships are not currently preparing for departure, High Traveler. Wait for the next betting window.", engine: 'drakkar_engine' };
            }

            const { shipIndices, weatherIndices, ships } = state;
            if (!shipIndices || !weatherIndices) return { reply: "The runes are cloudy. I cannot see the path yet.", engine: 'drakkar_engine' };

            const scores = shipIndices.map((sIdx: number, i: number) => {
                let totalSpeed = 0;
                weatherIndices.forEach((wIdx: number) => {
                    totalSpeed += SPEED_MATRIX[sIdx][wIdx];
                });
                return { name: ships[i].name, color: ships[i].color, score: totalSpeed };
            });

            scores.sort((a: any, b: any) => b.score - a.score);
            const winner = scores[0];

            const replies = [
                `I have consulted the hidden currents of Midgard... The winds favor **${winner.name}** for the upcoming voyage.`,
                `The Norns whisper that **${winner.name}** carries the strongest blessing this hour.`,
                `I see a vision of **${winner.name}** cutting through the fog more swiflty than the rest. Bet with courage!`
            ];

            return { reply: replies[Math.floor(Math.random() * replies.length)], engine: 'valkyrie_vision' };
        } catch (err: any) {
            return { reply: "The runes have shattered! I cannot see the ships. (Error: " + err.message + ")", engine: 'system' };
        }
    }

    // --- PRIVATE COMMANDS: /slotprophecy & /boxprophecy ---
    if (userMessage === '/slotprophecy' || userMessage === '/boxprophecy') {
        if (!auth || !SUPER_ADMIN_UIDS.includes(auth.uid)) {
            return { reply: "Only those touched by Odin can see the threads of the future.", engine: 'system' };
        }

        const gameType = userMessage === '/slotprophecy' ? 'slotMachine' : 'treasureChest';
        const db = admin.firestore();

        try {
            // 1. Fetch Config
            const configSnap = await db.collection('settings').doc('mini_games').get();
            const config = configSnap.data()?.[gameType];
            if (!config) return { reply: "The machine's souls are resting. I cannot see into them right now.", engine: 'system' };

            // 2. Pre-roll outcome
            const outcome = selectWeightedPrize(config.prizes || [], config.noWinWeight || 0);

            // 3. Store outcome
            await db.collection('users').doc(auth.uid).update({
                [`pendingMiniGameOutcomes.${gameType}`]: outcome || { id: 'none', rarity: 'none', name: 'None' }
            });

            // 4. Mysterious Response
            const rarity = outcome?.rarity || 'none';
            if (rarity === 'legendary') {
                return { reply: "A blinding golden light appears in the well of souls... Your next attempt holds a relic of the High Gods.", engine: 'valkyrie_vision' };
            } else if (rarity === 'epic' || rarity === 'rare') {
                return { reply: "The threads of fate shimmer with a rare brilliance. A notable treasure awaits your next venture.", engine: 'valkyrie_vision' };
            } else if (rarity === 'uncommon') {
                return { reply: "The Norns are active. A small but meaningful gift is being woven into your path.", engine: 'valkyrie_vision' };
            } else {
                return { reply: "The tides of Midgard are calm. Your next journey will be steady and humble.", engine: 'valkyrie_vision' };
            }

        } catch (err: any) {
            console.error('Prophecy Error:', err);
            return { reply: "The crystal ball has cracked! (Error: " + err.message + ")", engine: 'system' };
        }
    }

    // 1. Basic Validation
    if (!userMessage || typeof userMessage !== 'string') {
        throw new HttpsError('invalid-argument', 'Message is required and must be a string.');
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw new HttpsError('failed-precondition', 'Gemini API Key is not configured in .env.');
    }

    try {
        // 2. Fetch Context
        const db = admin.firestore();
        const knowledgeSnapshot = await db.collection('chatbot_knowledge').orderBy('order', 'asc').get();
        const knowledgeItems = knowledgeSnapshot.docs.map(doc => doc.data());
        const knowledgeContext = knowledgeItems.map(item => `Topic: ${item.label}\nResponse: ${item.response}`).join('\n\n');

        const PLATFORM_GUIDE = `
ASGARD DUELS - PLATFORM GUIDE & STRUCTURE:

1. CORE IDENTITY:
Asgard Duels is a premier competitive platform for Amiko Legends. Users earn Valcoins, climb Tiers, and participate in legendary tournaments and mini-games.

2. SITE NAVIGATION & PAGES:
- HOME: The central hub. Features include Active Tournaments, Latest News, Leaderboards (Wealth/Referrals), and Matchup summaries.
- MATCHUPS: Real-time game voting and historical records. Clicking a player's name opens their Condensed Profile.
- TOURNAMENTS: View brackets (Single Elimination or Round Robin), check-in for matches, and read specific tournament rules.
- RAFFLES: Buy entries for a chance to win exclusive rewards and Valcoins.
- PROFILE: Accessed via the character icon in the top-right. Displays your Tier, EXP progress, Daily Earned stats, and social interactions (Likes/Comments).
- ARMORY: A place to view and equip your cosmetics, including Auras and Banners.

3. ECONOMIC & PROGRESSION SYSTEMS:
- VALCOINS: Earned via mini-games, check-ins, and tournaments. Used for betting and raffle entries.
- TIERS: Progression from Bronze -> Silver -> Gold -> Platinum -> Diamond -> Masters -> Grandmasters -> Valhalla. higher tiers increase your Valcoin storage limits.
- EXP: Earned through activity to level up your Tier.
- COSMETICS: Includes Auras (visual effects around your avatar) and Banners (custom profile backgrounds).

4. MINI-GAMES:
- DRAKKAR RACE: Competitive ship racing with shared reward pools.
- NORNS' FATE: A game where destiny meets luck.
- ASGARD TRIALS (ARCADE): Various skill-based games to earn Valcoins.

5. SOCIAL FEATURES:
- PROFILES: Users can "Like" each other's profiles and leave "Comments". 
- NOTIFICATIONS: Users see a badge on their profile when they have new comments.
- REFERRALS: Invite friends to earn rewards and climb the Referral Leaderboard.
- SOCIAL FEED: Read the "Valkyrie's Feed" on the home page for real-time win announcements and site activity.

6. MINI-GAME MECHANICS:
- DRAKKAR RACE: A parimutuel betting game. 7 ships race across Midgard. You can place multiple bets (max 30k total) on various ships. Winners share the entire pool minus a small 'Valkyrie's Cut' (10%).
- NORNS' FATE: High-stakes card prediction. Guess which of the three fates will be revealed. 
- ODIN'S RIDDLE: A trivia trial. Correct answers earn you Valcoins. It is a test of both mythology and Aurory knowledge.
`;

        const systemPrompt = `You are Runie, the helpful Valkyrie Guide for Asgard Duels.
Your goal is to guide warriors through Midgard with wisdom and grace.

PLATFORM KNOWLEDGE:
${knowledgeContext}

SITE STRUCTURE & RULES:
${PLATFORM_GUIDE}

INSTRUCTIONS:
1. Be concise but maintain your Valkyrie persona.
2. Use the "SITE STRUCTURE" to help users navigate the platform.
3. If a user asks about rules or systems (Tiers, EXP, etc.), refer to the GUIDE.
4. If you don't know something, suggest they check the official Discord (link in footer).
5. Always be encouraging to the warriors.

User: ${userMessage}`;

        // 3. Direct REST Call to v1 (Bypassing SDK v1beta issues)
        const https = require('https');

        const postData = JSON.stringify({
            contents: [{ parts: [{ text: systemPrompt }] }],
            generationConfig: { maxOutputTokens: 1024, temperature: 0.7 }
        });

        const options = {
            hostname: 'generativelanguage.googleapis.com',
            port: 443,
            path: `/v1/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const resultText = await new Promise<string>((resolve, reject) => {
            const req = https.request(options, (res: any) => {
                let body = '';
                res.on('data', (d: any) => body += d);
                res.on('end', () => {
                    if (res.statusCode !== 200) {
                        reject(new Error(`API Error ${res.statusCode}: ${body}`));
                    } else {
                        try {
                            const parsed = JSON.parse(body);
                            const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
                            resolve(text || "I'm not sure how to answer that right now.");
                        } catch (e) {
                            reject(new Error("Failed to parse API response"));
                        }
                    }
                });
            });

            req.on('error', (e: any) => reject(e));
            req.write(postData);
            req.end();
        });

        return {
            reply: resultText.trim(),
            engine: 'gemini-1.5-flash'
        };

    } catch (error: any) {
        console.error('Runie AI REST Failure:', error);
        throw new HttpsError('internal', `Runie is feeling a bit magical today. (Error: ${error.message}). Try again later!`);
    }
});
