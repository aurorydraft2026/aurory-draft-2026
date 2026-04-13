import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { GoogleGenerativeAI } from '@google/generative-ai';

// API Configuration is handled via .env (GEMINI_API_KEY)

export const chatWithRunie = onCall({
    memory: '256MiB',
    maxInstances: 10,
    region: 'us-central1'
}, async (request) => {
    // 1. Basic Validation
    const userMessage = request.data.message;
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

        const systemPrompt = `You are Runie, the helpful Valkyrie Guide for Asgard Duels. Answer concisely based on this knowledge:\n${knowledgeContext}\n\nUser: ${userMessage}`;

        // 3. Direct REST Call to v1 (Bypassing SDK v1beta issues)
        const https = require('https');
        
        const postData = JSON.stringify({
            contents: [{ parts: [{ text: systemPrompt }] }],
            generationConfig: { maxOutputTokens: 250, temperature: 0.7 }
        });

        const options = {
            hostname: 'generativelanguage.googleapis.com',
            port: 443,
            path: `/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': postData.length
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
            engine: 'gemini-2.5-flash'
        };

    } catch (error: any) {
        console.error('Runie AI REST Failure:', error);
        throw new HttpsError('internal', `Runie is feeling a bit magical today. (Error: ${error.message}). Try again later!`);
    }
});
