/**
 * pvpRewards.ts
 * Scheduled Cloud Function that polls the Aurory player-matches API
 * for every linked user, detects new real PvP wins, and awards Valcoins + EXP.
 *
 * Runs every 10 minutes. Cost-optimized:
 *  - Early exit if no linked users
 *  - Small memory footprint (256MiB)
 *  - Only fetches 1 page (10 matches) per user per cycle
 *  - Processes users in batches of 10 to stay within rate limits
 */

import * as admin from 'firebase-admin';
import fetch from 'node-fetch';
import { clampPointsToTierMax } from './tierAndReferral';
import { updateLeaderboardStats } from './leaderboardUtils';

const AURORY_API = 'https://aggregator-api.live.aurory.io';
const CURRENT_EVENT = 'APRIL_2026';


// ─── DEFAULTS (overridable via settings/pvp_rewards) ───
const DEFAULT_REWARD   = 20;   // Valcoins per PvP win
const DEFAULT_MIN_SECS = 120;  // Minimum battle duration in seconds

interface PvpMatch {
  created_at: string;
  result: string;
  opponent: { id: string; player_name: string };
  event: string;
  data?: {
    end_game_reason?: string;
    duration?: number; // The correct property name
    battle_duration_in_seconds?: number; // Legacy/fallback
    players_match_data?: any[];
  };
}

interface PvpSettings {
  rewardPerWin: number;
  minMatchDuration: number;
  enabled: boolean;
}

/**
 * Load admin-configurable settings from Firestore.
 */
async function loadSettings(): Promise<PvpSettings> {
  try {
    const snap = await admin.firestore().doc('settings/pvp_rewards').get();
    if (snap.exists) {
      const d = snap.data()!;
      return {
        rewardPerWin:     d.rewardPerWin     ?? DEFAULT_REWARD,
        minMatchDuration: d.minMatchDuration ?? DEFAULT_MIN_SECS,
        enabled:          d.enabled          ?? true,
      };
    }
  } catch { /* fall through */ }

  return {
    rewardPerWin: DEFAULT_REWARD,
    minMatchDuration: DEFAULT_MIN_SECS,
    enabled: true,
  };
}

/**
 * Fetch recent matches for a player from the Aurory API, paginating until
 * we hit the last known processed match timestamp.
 */
async function fetchPlayerMatches(playerId: string, lastCheckMs: number): Promise<PvpMatch[]> {
  const allMatches: PvpMatch[] = [];
  let currentPage = 1;
  const MAX_PAGES = 20; // Scan up to 500 matches (20 pages × 25) per cycle

  try {
    while (currentPage <= MAX_PAGES) {
      const url = `${AURORY_API}/v1/player-matches?player_id_or_name=${encodeURIComponent(playerId)}&page=${currentPage}&limit=25`;
      const res = await fetch(url, {
        headers: { 'accept': 'application/json' },
        timeout: 10000,
      });

      if (!res.ok) {
        console.warn(`⚠️ Aurory API ${res.status} for ${playerId} on page ${currentPage}`);
        break;
      }

      const json = (await res.json()) as any;
      const matches = (json?.matches?.data || []) as PvpMatch[];

      if (matches.length === 0) break;

      allMatches.push(...matches);

      // If the oldest match on this page is already before our checkpoint, 
      // we have all the new matches we need.
      const oldestOnPage = new Date(matches[matches.length - 1].created_at).getTime();
      if (oldestOnPage <= lastCheckMs) {
        break;
      }

      currentPage++;
    }
    return allMatches;
  } catch (err: any) {
    console.error(`❌ Fetch error for ${playerId}:`, err.message);
    return allMatches; // Return what we have so far
  }
}

/**
 * Process a single user — check for new PvP wins and award Valcoins.
 */
async function processUser(
  uid: string,
  userData: any,
  settings: PvpSettings
): Promise<number> {
  const playerId = userData.auroryPlayerId;
  const displayName = userData.displayName || userData.username || uid;
  if (!playerId) {
    console.log(`  ⏭️ ${displayName}: No auroryPlayerId linked, skipping.`);
    return 0;
  }

  // Determine the cutoff — only process matches after this timestamp
  const lastCheckRaw = userData.lastPvpMatchCheck;
  let lastCheckMs = 0;
  if (lastCheckRaw) {
    if (typeof lastCheckRaw === 'number') lastCheckMs = lastCheckRaw;
    else if (lastCheckRaw.toMillis) lastCheckMs = lastCheckRaw.toMillis();
    else if (lastCheckRaw.seconds) lastCheckMs = lastCheckRaw.seconds * 1000;
  }

  console.log(`  🔎 ${displayName} (${playerId}): lastCheck=${lastCheckMs ? new Date(lastCheckMs).toISOString() : 'NEVER'}`);

  const matches = await fetchPlayerMatches(playerId, lastCheckMs);
  
  // LEADERBOARD FALLBACK: Some players (like GADxWann) have stale match history in the API 
  // but fresh wins on the leaderboard.
  let leaderboardDelta = 0;
  const currentLeaderboardWins = await fetchLeaderboardWins(playerId);
  const lastLeaderboardWins = userData.lastLeaderboardWins || 0;

  if (currentLeaderboardWins > lastLeaderboardWins) {
    leaderboardDelta = currentLeaderboardWins - lastLeaderboardWins;
    console.log(`  📈 ${displayName}: Leaderboard delta detected: ${currentLeaderboardWins} total (${leaderboardDelta} new wins)`);
  }

  if (!matches.length && leaderboardDelta <= 0) {
    console.log(`  📭 ${displayName}: 0 matches and no leaderboard progress detected.`);
    return 0;
  }

  console.log(`  📦 ${displayName}: ${matches.length} total matches fetched from API.`);

  // Count stats for logging
  let statsNotWin = 0, statsCPU = 0, statsOld = 0, statsTooShort = 0, statsPrivate = 0;

  // Filter qualifying wins
  const qualifyingWins = matches.filter((m) => {
    // Must be a win
    if (m.result !== 'win') { statsNotWin++; return false; }

    // Must not be a bot match
    if (m.opponent?.id === 'CPU') { statsCPU++; return false; }

    // Must not be a private match (handled by Tournament system)
    if (m.event === 'private') { statsPrivate++; return false; }

    // Must be after last check
    const matchTime = new Date(m.created_at).getTime();
    if (matchTime <= lastCheckMs) { statsOld++; return false; }

    // Must meet minimum duration
    const duration = m.data?.duration ?? m.data?.battle_duration_in_seconds ?? 0;
    if (duration < settings.minMatchDuration) { statsTooShort++; return false; }

    return true;
  });

  console.log(`  📊 ${displayName}: ${qualifyingWins.length} qualifying wins | Filtered out: ${statsNotWin} losses, ${statsCPU} CPU, ${statsPrivate} private, ${statsOld} old, ${statsTooShort} too short`);

  const matchWins = qualifyingWins.length;
  // If leaderboard delta is higher than match wins, we use the leaderboard delta as a fallback
  // This helps players whose match history API is stale.
  const totalWinsToReward = Math.max(matchWins, leaderboardDelta);

  if (totalWinsToReward === 0) {
    // Still update the checkpoint if we fetch matches
    if (matches.length > 0) {
      const newestTime = matches.reduce((max, m) => {
        const t = new Date(m.created_at).getTime();
        return t > max ? t : max;
      }, lastCheckMs);

      if (newestTime > lastCheckMs) {
        await admin.firestore().doc(`users/${uid}`).update({
          lastPvpMatchCheck: admin.firestore.Timestamp.fromMillis(newestTime),
          ...(currentLeaderboardWins > 0 ? { lastLeaderboardWins: currentLeaderboardWins } : {})
        });
      }
    } else if (currentLeaderboardWins > 0) {
      // If we used leaderboard but found no delta, still update just in case
      await admin.firestore().doc(`users/${uid}`).update({
        lastLeaderboardWins: currentLeaderboardWins
      });
    }
    return 0;
  }

  // Award rewards via transaction
  const db = admin.firestore();
  const userRef = db.doc(`users/${uid}`);
  const totalReward = totalWinsToReward * settings.rewardPerWin;

  // Find the newest match timestamp among qualifying wins
  const newestWinTime = qualifyingWins.reduce((max, m) => {
    const t = new Date(m.created_at).getTime();
    return t > max ? t : max;
  }, lastCheckMs);

  // Also consider non-qualifying matches for the overall cutoff advance
  const newestOverallTime = matches.reduce((max, m) => {
    const t = new Date(m.created_at).getTime();
    return t > max ? t : max;
  }, newestWinTime);

  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
      if (!snap.exists) return;

      const ud = snap.data()!;
      const currentPoints = ud.points || 0;
      const userTier = ud.tier || 1;

      const rawNew = currentPoints + totalReward;
      const clampedPoints = clampPointsToTierMax(rawNew, userTier);

      tx.update(userRef, {
        points: clampedPoints,
        exp: admin.firestore.FieldValue.increment(totalReward),
        lastPvpMatchCheck: admin.firestore.Timestamp.fromMillis(newestOverallTime),
        lastLeaderboardWins: currentLeaderboardWins > 0 ? currentLeaderboardWins : (ud.lastLeaderboardWins || 0),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Record history entries (one aggregate entry per scan cycle)
      const histRef = db.collection(`users/${uid}/pointsHistory`).doc();
      tx.set(histRef, {
        amount: totalReward,
        type: 'pvp_win',
        description: `${qualifyingWins.length} PvP win${qualifyingWins.length > 1 ? 's' : ''} in Aurory (+${settings.rewardPerWin} each)`,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Also record a centralized log entry for admin monitoring
      const globalLogRef = db.collection('reward_logs').doc();
      tx.set(globalLogRef, {
        userId: uid,
        displayName: userData.displayName || userData.username || 'Unknown',
        amount: totalReward,
        type: 'pvp_win',
        matchCount: qualifyingWins.length,
        description: `${qualifyingWins.length} PvP wins for ${playerId}`,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    // Leaderboard update (outside transaction for RTDB)
    const displayName = userData.displayName || userData.username || 'Unknown';
    const avatar = userData.avatar || userData.photoURL || '';
    await updateLeaderboardStats(uid, displayName, avatar, totalReward, 'valcoins', 'pvp_wins');

    console.log(`  🏆 ${displayName}: +${totalReward} Valcoins (${qualifyingWins.length} PvP win${qualifyingWins.length > 1 ? 's' : ''})`);
    return qualifyingWins.length;
  } catch (err: any) {
    console.error(`  ❌ Error awarding PvP for ${uid}:`, err.message);
    return 0;
  }
}

/**
 * Main scan: iterate linked users and check for new PvP wins.
 */
export async function scanPvpWins(): Promise<number> {
  const settings = await loadSettings();
  if (!settings.enabled) {
    console.log('⏸️ PvP rewards disabled via settings.');
    return 0;
  }

  // Query only users who have linked their Aurory account
  const snapshot = await admin.firestore().collection('users')
    .where('auroryPlayerId', '!=', '')
    .limit(200)
    .get();

  if (snapshot.empty) {
    console.log('🔇 No linked Aurory users found. Exiting early.');
    return 0;
  }

  console.log(`🔍 Scanning ${snapshot.size} linked user(s) for PvP wins...`);
  let totalWins = 0;

  // Process in batches of 5 to respect Aurory API rate limits
  const docs = snapshot.docs;
  for (let i = 0; i < docs.length; i += 5) {
    const batch = docs.slice(i, i + 5);
    const results = await Promise.all(
      batch.map((d) => processUser(d.id, d.data(), settings))
    );
    totalWins += results.reduce((a, b) => a + b, 0);

    // Small delay between batches to be polite to the API
    if (i + 5 < docs.length) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  if (totalWins > 0) {
    console.log(`✅ PvP scan complete: ${totalWins} win(s) rewarded.`);
  }
  return totalWins;
}

/**
 * Fetch a player's total wins for the current season from the official Aurory Leaderboard.
 */
async function fetchLeaderboardWins(playerId: string): Promise<number> {
  const url = `${AURORY_API}/v1/leaderboards?mode=pvp&event=${CURRENT_EVENT}&limit=100`;
  try {
    const res = await fetch(url, { headers: { 'accept': 'application/json' }, timeout: 10000 });
    if (!res.ok) return 0;

    const json = await res.json() as any;
    const players = json?.players || [];
    const playerEntry = players.find((p: any) => p.player?.player_id === playerId);
    
    return playerEntry?.match_stats?.num_wins || 0;
  } catch (err: any) {
    console.error(`❌ Leaderboard fetch error for ${playerId}:`, err.message);
    return 0;
  }
}
