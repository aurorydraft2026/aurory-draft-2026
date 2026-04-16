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

// ─── DEFAULTS (overridable via settings/pvp_rewards) ───
const DEFAULT_REWARD   = 20;   // Valcoins per PvP win
const DEFAULT_MIN_SECS = 120;  // Minimum battle duration in seconds

/**
 * Automatically calculates the Aurory event name based on the current date,
 * e.g., "APRIL_2026", "MAY_2026", etc.
 */
function getCurrentEventName(): string {
  const date = new Date();
  const monthNames = [
    "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
    "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"
  ];
  const month = monthNames[date.getMonth()];
  const year = date.getFullYear();
  return `${month}_${year}`;
}

interface PvpMatch {
  created_at: string;
  result: string;
  opponent: { id: string; player_name: string };
  event: string;
  data?: {
    end_game_reason?: string;
    duration?: number;
    battle_duration_in_seconds?: number;
    players_match_data?: any[];
    battle_code?: string;
  };
}

interface PvpSettings {
  rewardPerWin: number;
  minMatchDuration: number;
  enabled: boolean;
  currentEvent: string;
}

/**
 * Load admin-configurable settings from Firestore.
 */
async function loadSettings(): Promise<PvpSettings> {
  try {
    const snap = await admin.firestore().doc('settings/pvp_rewards').get();
      if (snap.exists) {
      const d = snap.data()!;
      // Ensure we don't accidentally use 0 or negative rewards from misconfigured settings
      const reward = (typeof d.rewardPerWin === 'number' && d.rewardPerWin > 0) ? d.rewardPerWin : DEFAULT_REWARD;
      return {
        rewardPerWin:     reward,
        minMatchDuration: d.minMatchDuration ?? DEFAULT_MIN_SECS,
        enabled:          d.enabled          ?? true,
        currentEvent:     d.currentEvent     ?? getCurrentEventName(),
      };
    }
  } catch { /* fall through */ }

  return {
    rewardPerWin: DEFAULT_REWARD,
    minMatchDuration: DEFAULT_MIN_SECS,
    enabled: true,
    currentEvent: getCurrentEventName(),
  };
}

/**
 * Fetch recent matches for a player from the Aurory API, paginating until
 * we hit the last known processed match timestamp.
 */
/**
 * Fetch recent matches for a player from the Aurory API.
 * Handles both DESC (newest first) and ASC (oldest first) sorting inconsistencies.
 */
async function fetchPlayerMatches(playerId: string, lastCheckMs: number): Promise<PvpMatch[]> {
  const allMatches: PvpMatch[] = [];
  const MAX_PAGES_TO_SCAN = 10;
  
  try {
    // 1. Initial Page Fetch (detect sort order)
    const url0 = `${AURORY_API}/v1/player-matches?player_id_or_name=${encodeURIComponent(playerId)}&page=0&limit=25`;
    const res0 = await fetch(url0, { headers: { 'accept': 'application/json' }, timeout: 10000 });
    if (!res0.ok) return [];

    const json0 = (await res0.json()) as any;
    const matches0 = (json0?.matches?.data || []) as PvpMatch[];
    const totalPages = json0?.matches?.total_pages || 0;

    if (matches0.length === 0) return [];

    const time0 = matches0.length > 0 ? new Date(matches0[0].created_at).getTime() : 0;
    const timeLast = matches0.length > 0 ? new Date(matches0[matches0.length - 1].created_at).getTime() : 0;

    console.log(`  📊 ${playerId}: Page 0 fetched: 25 slots, ${matches0.length} matches. Time0: ${new Date(time0).toISOString()}, TimeLast: ${new Date(timeLast).toISOString()}`);

    // Determine sort order: if the last element in the array is newer than the first, it's ASC.
    const isAscending = timeLast > time0;
    const newestInBatch = isAscending ? timeLast : time0;
    const oldestInBatch = isAscending ? time0 : timeLast;

    console.log(`  📐 ${playerId}: Detected order: ${isAscending ? 'ASC (Oldest First)' : 'DESC (Newest First)'}. Newest in batch: ${new Date(newestInBatch).toISOString()}`);

    // IF ASCENDING OR Page 0 is all "OLD" matches but there are many pages,
    // we should check the END of the list.
    if (isAscending || (newestInBatch < lastCheckMs && totalPages > 1)) {
      console.log(`  🔄 ${playerId}: Index is ASC or current page is stale. Checking last page (${totalPages-1}). lastCheckMs=${new Date(lastCheckMs).toISOString()}`);
      
      // Fetch the last page
      const lastPageIdx = totalPages - 1;
      const urlLast = `${AURORY_API}/v1/player-matches?player_id_or_name=${encodeURIComponent(playerId)}&page=${lastPageIdx}&limit=25`;
      const resLast = await fetch(urlLast, { headers: { 'accept': 'application/json' }, timeout: 10000 });
      
      if (resLast.ok) {
        const jsonLast = await resLast.json() as any;
        const matchesLast = (jsonLast?.matches?.data || []) as PvpMatch[];
        
        // If the last page has new matches, scan backwards
        if (matchesLast.length > 0) {
          const newestOnLastPage = matchesLast.reduce((max: number, m: any) => {
            const t = new Date(m.created_at).getTime();
            return t > max ? t : max;
          }, 0);

          if (newestOnLastPage > lastCheckMs) {
            allMatches.push(...matchesLast);
            // Scan one more page back if needed
            if (lastPageIdx > 0 && matchesLast[0] && new Date(matchesLast[0].created_at).getTime() > lastCheckMs) {
              const urlPrev = `${AURORY_API}/v1/player-matches?player_id_or_name=${encodeURIComponent(playerId)}&page=${lastPageIdx - 1}&limit=25`;
              const resPrev = await fetch(urlPrev);
              if (resPrev.ok) {
                const jPrev = await resPrev.json() as any;
                allMatches.push(...(jPrev?.matches?.data || []));
              }
            }
            return allMatches;
          }
        }
      }
    }

    // Standard DESC scanning (Newest First)
    allMatches.push(...matches0);
    if (timeLast <= lastCheckMs) return allMatches;

    let currentPage = 1;
    while (currentPage < MAX_PAGES_TO_SCAN) {
      const url = `${AURORY_API}/v1/player-matches?player_id_or_name=${encodeURIComponent(playerId)}&page=${currentPage}&limit=25`;
      const res = await fetch(url, { headers: { 'accept': 'application/json' }, timeout: 10000 });
      if (!res.ok) break;

      const j = await res.json() as any;
      const mArr = (j?.matches?.data || []) as PvpMatch[];
      if (mArr.length === 0) break;

      allMatches.push(...mArr);
      const oldestOnPage = new Date(mArr[mArr.length - 1].created_at).getTime();
      if (oldestOnPage <= lastCheckMs) break;
      
      currentPage++;
    }

    return allMatches;
  } catch (err: any) {
    console.error(`❌ Fetch error for ${playerId}:`, err.message);
    return allMatches;
  }
}

/**
 * Process a single user — check for new PvP wins and award Valcoins.
 */
async function processUser(
  uid: string,
  userData: any,
  settings: PvpSettings,
  leaderboardMap: Map<string, number>
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
  
  // LEADERBOARD FALLBACK: Caching the leaderboard once per scan (Top 1000)
  let leaderboardDelta = 0;
  const currentLeaderboardWins = leaderboardMap.get(playerId) || 0;
  const lastLeaderboardWins = userData.lastLeaderboardWins || 0;

  console.log(`  🏆 ${displayName}: Leaderboard check: Current=${currentLeaderboardWins}, LastProcessed=${lastLeaderboardWins}`);

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

  // ─── METADATA EXTRACTION for Logging ───
  // Find the newest qualifying match for metadata (opponent, duration, etc.)
  let recentWin = qualifyingWins.length > 0 
    ? qualifyingWins.reduce((latest, current) => 
        new Date(current.created_at).getTime() > new Date(latest.created_at).getTime() ? current : latest
      , qualifyingWins[0])
    : null;

  // FALLBACK Metadata Handling:
  // If we are rewarding via Leaderboard but no new matches were found in history,
  // we do NOT want to show an old opponent.
  let opponentName = recentWin?.opponent?.player_name;
  let isFallback = false;

  if (!recentWin && totalWinsToReward > 0) {
    opponentName = "Leaderboard Sync (API Lag)";
    isFallback = true;
  }

  const amikosSet = new Set<string>();
  
  // Collect amikos from all qualifying wins in this batch
  qualifyingWins.forEach(win => {
    const me = win.data?.players_match_data?.find((p: any) => p.player_id === playerId);
    me?.nefties?.forEach((n: any) => {
      if (n.collection_id) amikosSet.add(n.collection_id);
    });
  });

  // Fallback: if no qualifying wins detected amikos, use from the recent fallback win
  if (amikosSet.size === 0 && recentWin) {
    const me = recentWin.data?.players_match_data?.find((p: any) => p.player_id === playerId);
    me?.nefties?.forEach((n: any) => {
      if (n.collection_id) amikosSet.add(n.collection_id);
    });
  }

  const amikosUsed = Array.from(amikosSet).join(', ');

  try {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(userRef);
      if (!snap.exists) return;

      const ud = snap.data()!;
      const currentPoints = ud.points || 0;
      const userTier = ud.tier || 1;

      const rawNew = currentPoints + totalReward;
      const clampedPoints = clampPointsToTierMax(rawNew, userTier);

      // If we used a leaderboard fallback, we MUST advance the timestamp to "now"
      // to prevent these wins from being double-counted when they finally show up in history.
      const finalCheckpointTime = isFallback 
        ? Math.max(newestOverallTime, Date.now() - 60000) // Now minus 1m safety
        : newestOverallTime;

      tx.update(userRef, {
        points: clampedPoints,
        exp: admin.firestore.FieldValue.increment(totalReward),
        lastPvpMatchCheck: admin.firestore.Timestamp.fromMillis(finalCheckpointTime),
        lastLeaderboardWins: currentLeaderboardWins > 0 ? currentLeaderboardWins : (ud.lastLeaderboardWins || 0),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Record history entries (one aggregate entry per scan cycle)
      const histRef = db.collection(`users/${uid}/pointsHistory`).doc();
      tx.set(histRef, {
        amount: totalReward,
        type: 'pvp_win',
        description: `${totalWinsToReward} PvP win${totalWinsToReward > 1 ? 's' : ''} in Aurory (+${settings.rewardPerWin} each)`,
        amikos: amikosUsed || null,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Also record a centralized log entry for admin monitoring
      const globalLogRef = db.collection('reward_logs').doc();
      tx.set(globalLogRef, {
        userId: uid,
        displayName: userData.auroryPlayerName || userData.displayName || userData.username || 'Unknown',
        amount: totalReward,
        type: 'pvp_win',
        matchCount: totalWinsToReward,
        description: `${totalWinsToReward} PvP wins for ${playerId}`,
        amikos: amikosUsed || null,
        metadata: {
          playerId,
          opponent: opponentName || 'Unknown',
          duration: recentWin?.data?.duration || null,
          battleCode: recentWin?.data?.battle_code || (isFallback ? 'LEADERBOARD_SYNC' : null),
          endGameReason: recentWin?.data?.end_game_reason || null
        },
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    // Leaderboard update (outside transaction for RTDB)
    const dName = userData.auroryPlayerName || userData.displayName || userData.username || 'Unknown';
    const avatar = userData.auroryProfilePicture || userData.avatar || userData.photoURL || '';
    await updateLeaderboardStats(uid, dName, avatar, totalReward, 'valcoins', 'pvp_wins');
    await updateLeaderboardStats(uid, dName, avatar, totalWinsToReward, 'wins', 'pvp');

    console.log(`  🏆 ${dName}: +${totalReward} Valcoins (${totalWinsToReward} PvP win(s)${amikosUsed ? ` using ${amikosUsed}` : ''})`);
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
    .limit(1000)
    .get();

  if (snapshot.empty) {
    console.log('🔇 No linked Aurory users found. Exiting early.');
    return 0;
  }

  if (snapshot.size >= 1000) {
    console.warn('⚠️ WARNING: PvP scanner reached the 1000-user limit. Some users may have been skipped!');
  }

  console.log(`🔍 Scanning ${snapshot.size} linked user(s) for PvP wins... Current Time: ${new Date().toISOString()}`);
  
  // Fetch leaderboard once per scan to avoid rate limits
  const leaderboardMap = await fetchLeaderboardMap(settings.currentEvent);
  console.log(`  📊 Leaderboard cache populated: ${leaderboardMap.size} players indexed in Top 1000.`);

  let totalWins = 0;

  // Process in batches of 5 to respect Aurory API rate limits
  const docs = snapshot.docs;
  for (let i = 0; i < docs.length; i += 5) {
    const batch = docs.slice(i, i + 5);
    const results = await Promise.all(
      batch.map((d) => processUser(d.id, d.data(), settings, leaderboardMap))
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
 * Fetch the official Aurory Leaderboard (Top 1000) and return a map of PlayerID -> WinCount.
 */
async function fetchLeaderboardMap(currentEvent: string): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const url = `${AURORY_API}/v1/leaderboards?mode=pvp&event=${currentEvent}&limit=1000`;
  
  try {
    const res = await fetch(url, { headers: { 'accept': 'application/json' }, timeout: 15000 });
    if (!res.ok) {
      console.warn(`⚠️ Aurory Leaderboard API returned ${res.status}`);
      return map;
    }

    const json = await res.json() as any;
    const players = json?.players || [];
    
    players.forEach((p: any) => {
      if (p.player?.player_id) {
        map.set(p.player.player_id, p.match_stats?.num_wins || 0);
      }
    });
  } catch (err: any) {
    console.error(`❌ Leaderboard cache fetch error:`, err.message);
  }
  
  return map;
}
