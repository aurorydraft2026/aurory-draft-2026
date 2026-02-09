// matchVerificationService.js
// Automatic match verification for Aurory Draft tournaments
// Uses /v1/matches global endpoint to verify in-game battles match drafted lineups

import {
  doc, getDoc, updateDoc, serverTimestamp, collection, query, where, getDocs
} from 'firebase/firestore';
import { db } from '../firebase';

const AURORY_API_BASE = 'https://aggregator-api.live.aurory.io';
const CORS_PROXY = 'https://corsproxy.io/?';

// ============================================================================
// API: Fetch match by battle code from global /v1/matches endpoint
// ============================================================================

/**
 * Fetch matches from the global /v1/matches endpoint by battle code.
 * This endpoint reliably returns all matches regardless of player.
 * @param {string} battleCode - The private battle code
 * @returns {Promise<Array>} Array of match objects
 */
export async function fetchMatchByBattleCode(battleCode) {
  const params = new URLSearchParams({
    event: 'PRIVATE_MATCH',
    game_mode: 'pvp',
    battle_code: battleCode
  });

  const apiUrl = `${AURORY_API_BASE}/v1/matches?${params}`;
  const proxyUrl = `${CORS_PROXY}${encodeURIComponent(apiUrl)}`;

  try {
    const response = await fetch(proxyUrl, {
      headers: { 'accept': 'application/json' }
    });

    if (!response.ok) {
      return { error: `API error: ${response.status}`, matches: [] };
    }

    const result = await response.json();
    return { matches: result.data || [], error: null };
  } catch (error) {
    console.error('Error fetching match by battle code:', error);
    return { error: error.message, matches: [] };
  }
}

// ============================================================================
// VERIFICATION LOGIC
// ============================================================================

/**
 * Verify a single battle between two players.
 * 
 * Logic:
 * 1. Fetch match by battle code from global endpoint
 * 2. Check both player IDs are in the match
 * 3. Check each player's amikos match their draft (order-independent)
 * 4. If one player's amikos don't match → disqualified, opponent wins
 * 5. If both don't match → both disqualified
 * 6. If both match → use actual game result
 * 
 * @param {Object} battleConfig
 * @param {string} battleConfig.battleCode - Private battle code
 * @param {string} battleConfig.playerAId - Aurory player ID for team A player
 * @param {string} battleConfig.playerBId - Aurory player ID for team B player
 * @param {Array<string>} battleConfig.draftedAmikosA - Amiko IDs drafted by player A
 * @param {Array<string>} battleConfig.draftedAmikosB - Amiko IDs drafted by player B
 * @param {string} battleConfig.playerAName - Display name for player A
 * @param {string} battleConfig.playerBName - Display name for player B
 * @returns {Promise<Object>} Verification result
 */
export async function verifySingleBattle(battleConfig) {
  const {
    battleCode,
    playerAId,
    playerBId,
    draftedAmikosA,
    draftedAmikosB,
    playerAName = 'Player A',
    playerBName = 'Player B'
  } = battleConfig;

  // 1. Fetch match data
  const { matches, error } = await fetchMatchByBattleCode(battleCode);

  if (error) {
    return { status: 'error', error };
  }

  if (!matches || matches.length === 0) {
    return { status: 'not_found', error: 'Match not yet played or battle code not found.' };
  }

  // Use the most recent match with this battle code
  const match = matches.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];

  // 2. Verify participants
  const matchPlayerIds = match.match_players?.map(mp => mp.player_id) || [];

  if (!matchPlayerIds.includes(playerAId) || !matchPlayerIds.includes(playerBId)) {
    // Check if at least one player is in the match
    const playerAInMatch = matchPlayerIds.includes(playerAId);
    const playerBInMatch = matchPlayerIds.includes(playerBId);

    if (!playerAInMatch && !playerBInMatch) {
      return {
        status: 'wrong_players',
        error: 'Neither drafted player was found in this match. The battle code may have been used by different players.'
      };
    }

    // One player is missing - the wrong player played
    return {
      status: 'player_mismatch',
      error: `Player mismatch: ${!playerAInMatch ? playerAName : playerBName} did not play in this match.`,
      winner: !playerAInMatch ? 'B' : 'A',
      winnerName: !playerAInMatch ? playerBName : playerAName,
      loserName: !playerAInMatch ? playerAName : playerBName,
      disqualificationReason: `${!playerAInMatch ? playerAName : playerBName} was not found in the match.`
    };
  }

  // 3. Extract actual amikos used
  const playerAData = match.data?.players?.find(p => p.playerId === playerAId);
  const playerBData = match.data?.players?.find(p => p.playerId === playerBId);

  const usedAmikosA = playerAData?.nefties?.map(n => n.collection_id) || [];
  const usedAmikosB = playerBData?.nefties?.map(n => n.collection_id) || [];

  // 4. Verify lineups (order-independent)
  const lineupAValid = verifyLineup(draftedAmikosA, usedAmikosA);
  const lineupBValid = verifyLineup(draftedAmikosB, usedAmikosB);

  // 5. Determine outcome based on lineup validity
  const playerAOutcome = match.match_players?.find(mp => mp.player_id === playerAId)?.outcome;
  const playerBOutcome = match.match_players?.find(mp => mp.player_id === playerBId)?.outcome;

  let status, winner, disqualificationReason;

  if (!lineupAValid && !lineupBValid) {
    // Both players cheated — both disqualified
    status = 'both_disqualified';
    winner = null;
    disqualificationReason = 'Both players used different Amikos than drafted.';
  } else if (!lineupAValid) {
    // Player A cheated — Player B wins
    status = 'disqualified_A';
    winner = 'B';
    disqualificationReason = `${playerAName} used different Amikos than drafted.`;
  } else if (!lineupBValid) {
    // Player B cheated — Player A wins
    status = 'disqualified_B';
    winner = 'A';
    disqualificationReason = `${playerBName} used different Amikos than drafted.`;
  } else {
    // Both lineups valid — use actual game result
    status = 'verified';
    winner = playerAOutcome === 'win' ? 'A' : 'B';
    disqualificationReason = null;
  }

  return {
    status,
    winner,
    winnerName: winner === 'A' ? playerAName : winner === 'B' ? playerBName : null,
    loserName: winner === 'A' ? playerBName : winner === 'B' ? playerAName : null,
    disqualificationReason,
    matchTimestamp: match.created_at,
    duration: match.data?.duration || null,
    totalTurns: match.data?.totalBattleTurns || null,
    playerA: {
      playerId: playerAId,
      displayName: playerAName,
      draftedAmikos: draftedAmikosA,
      usedAmikos: usedAmikosA,
      lineupValid: lineupAValid,
      outcome: playerAOutcome || null
    },
    playerB: {
      playerId: playerBId,
      displayName: playerBName,
      draftedAmikos: draftedAmikosB,
      usedAmikos: usedAmikosB,
      lineupValid: lineupBValid,
      outcome: playerBOutcome || null
    }
  };
}

/**
 * Normalize an amiko ID for comparison.
 * Draft uses lowercase-hyphenated ('number-9', 'block-choy')
 * API returns PascalCase with spaces ('Number 9', 'Block Choy')
 * We strip all non-alphanumeric chars and lowercase for comparison.
 */
function normalizeAmikoId(id) {
  return (id || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Compare two amiko lineups (order-independent, normalized).
 */
function verifyLineup(drafted, actual) {
  if (!drafted || !actual) return false;
  if (drafted.length === 0) return true; // Skip if no draft data
  if (drafted.length !== actual.length) return false;

  const sortedDrafted = [...drafted].map(normalizeAmikoId).sort();
  const sortedActual = [...actual].map(normalizeAmikoId).sort();
  return sortedDrafted.every((val, idx) => val === sortedActual[idx]);
}

// ============================================================================
// FULL DRAFT VERIFICATION
// ============================================================================

/**
 * Verify all battles in a draft.
 * 
 * @param {Object} draftData - The draft document data
 * @param {Array} registeredUsers - Array of registered user objects
 * @returns {Promise<Object>} { results: Array, allVerified: boolean }
 */
export async function verifyDraftBattles(draftData, registeredUsers) {
  const {
    draftType,
    privateCode,
    privateCodes,
    finalAssignments,
    matchPlayers,
    teamA = [],
    teamB = []
  } = draftData;

  // Build player lists from matchPlayers (persistent) or finalAssignments (legacy fallback)
  let teamAPlayers, teamBPlayers;

  if (matchPlayers && matchPlayers.length > 0) {
    // New format: stored by finalizeDraft
    teamAPlayers = matchPlayers.filter(p => p.team === 'A');
    teamBPlayers = matchPlayers.filter(p => p.team === 'B');
  } else if (finalAssignments && finalAssignments.length > 0) {
    // Legacy fallback: old drafts that still have finalAssignments
    teamAPlayers = finalAssignments.filter(a => a.team === 'A').map(a => ({
      ...a.participant,
      uid: a.participant.uid || a.participant.id
    }));
    teamBPlayers = finalAssignments.filter(a => a.team === 'B').map(a => ({
      ...a.participant,
      uid: a.participant.uid || a.participant.id
    }));
  } else {
    return { results: [], allVerified: false, error: 'No team assignments found.' };
  }

  // Build battle configs based on draft mode
  const battleConfigs = [];

  if (draftType === 'mode3') {
    // 1v1: One battle, one code
    const pA = teamAPlayers[0];
    const pB = teamBPlayers[0];

    if (!pA?.auroryPlayerId || !pB?.auroryPlayerId) {
      return { results: [], allVerified: false, error: 'Both players must have linked Aurory accounts.' };
    }

    battleConfigs.push({
      battleIndex: 0,
      battleCode: privateCode,
      playerAId: pA.auroryPlayerId,
      playerBId: pB.auroryPlayerId,
      playerAName: pA.auroryPlayerName || pA.displayName || 'Player A',
      playerBName: pB.auroryPlayerName || pB.displayName || 'Player B',
      playerAUid: pA.uid || pA.id,
      playerBUid: pB.uid || pB.id,
      draftedAmikosA: teamA.slice(0, 3),
      draftedAmikosB: teamB.slice(0, 3)
    });
  } else {
    // mode1/mode2: 3v3, three battles, three codes
    for (let i = 0; i < 3; i++) {
      const pA = teamAPlayers[i];
      const pB = teamBPlayers[i];

      if (!pA?.auroryPlayerId || !pB?.auroryPlayerId) {
        battleConfigs.push({
          battleIndex: i,
          battleCode: privateCodes?.[i],
          skip: true,
          error: `Battle ${i + 1}: Missing Aurory account link for ${!pA?.auroryPlayerId ? (pA?.displayName || 'Team A player') : (pB?.displayName || 'Team B player')}`
        });
        continue;
      }

      battleConfigs.push({
        battleIndex: i,
        battleCode: privateCodes?.[i],
        playerAId: pA.auroryPlayerId,
        playerBId: pB.auroryPlayerId,
        playerAName: pA.auroryPlayerName || pA.displayName || `Player A${i + 1}`,
        playerBName: pB.auroryPlayerName || pB.displayName || `Player B${i + 1}`,
        playerAUid: pA.uid || pA.id,
        playerBUid: pB.uid || pB.id,
        draftedAmikosA: teamA.slice(i * 3, i * 3 + 3),
        draftedAmikosB: teamB.slice(i * 3, i * 3 + 3)
      });
    }
  }

  // Verify each battle
  const results = [];
  for (const config of battleConfigs) {
    if (config.skip) {
      results.push({
        battleIndex: config.battleIndex,
        battleCode: config.battleCode,
        status: 'error',
        error: config.error
      });
      continue;
    }

    if (!config.battleCode) {
      results.push({
        battleIndex: config.battleIndex,
        battleCode: null,
        status: 'error',
        error: `No battle code found for battle ${config.battleIndex + 1}.`
      });
      continue;
    }

    const result = await verifySingleBattle(config);
    results.push({
      battleIndex: config.battleIndex,
      battleCode: config.battleCode,
      playerAUid: config.playerAUid,
      playerBUid: config.playerBUid,
      ...result
    });
  }

  const allVerified = results.every(r =>
    r.status === 'verified' || r.status === 'disqualified_A' || r.status === 'disqualified_B' || r.status === 'both_disqualified'
  );

  // Determine overall tournament winner and score for 3v3
  let overallWinner = null;
  let score = null;
  if (allVerified && (draftType === 'mode1' || draftType === 'mode2')) {
    const teamAWins = results.filter(r => r.winner === 'A').length;
    const teamBWins = results.filter(r => r.winner === 'B').length;
    score = `${teamAWins}-${teamBWins}`;

    if (teamAWins > teamBWins) overallWinner = 'A';
    else if (teamBWins > teamAWins) overallWinner = 'B';
    else overallWinner = 'draw';
  } else if (allVerified && draftType === 'mode3') {
    overallWinner = results[0]?.winner || null;
    if (overallWinner) {
      score = overallWinner === 'A' ? '1-0' : '0-1';
    }
  }

  return { results, allVerified, overallWinner, score };
}

// ============================================================================
// FIRESTORE: Save & Load Verification Results
// ============================================================================

/**
 * Save verification results to the draft document in Firestore.
 */
export async function saveVerificationResults(draftId, verificationData) {
  try {
    const draftRef = doc(db, 'drafts', draftId);
    await updateDoc(draftRef, {
      matchResults: verificationData.results,
      verificationStatus: verificationData.allVerified ? 'complete' : 'partial',
      overallWinner: verificationData.overallWinner || null,
      score: verificationData.score || null,
      lastVerificationCheck: serverTimestamp(),
      verifiedAt: verificationData.allVerified ? serverTimestamp() : null
    });
    return { success: true };
  } catch (error) {
    console.error('Error saving verification results:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Fetch all drafts that have completed verification (for home page match history).
 * Returns drafts with matchResults, sorted by most recent first.
 * @param {number} limitCount - Max drafts to fetch
 * @param {string} modeFilter - Optional: 'mode1', 'mode2', 'mode3', or null for all
 * @returns {Promise<Array>} Array of draft summaries with match results
 */
export async function fetchVerifiedMatches(limitCount = 50, modeFilter = null) {
  try {
    const draftsRef = collection(db, 'drafts');

    // Simple query - just filter by verificationStatus (no compound index needed)
    const q = query(
      draftsRef,
      where('verificationStatus', 'in', ['complete', 'partial'])
    );

    const snapshot = await getDocs(q);

    let results = snapshot.docs.map(docSnap => {
      const data = docSnap.data();
      return {
        draftId: docSnap.id,
        title: data.title || 'Untitled Tournament',
        draftType: data.draftType,
        matchResults: data.matchResults || [],
        overallWinner: data.overallWinner,
        score: data.score || null,
        status: data.status || 'completed',
        verificationStatus: data.verificationStatus,
        verifiedAt: data.verifiedAt?.toDate?.() || data.verifiedAt || null,
        createdAt: data.createdAt?.toDate?.() || data.createdAt || null,
        teamNames: data.teamNames || { team1: 'Team 1', team2: 'Team 2' },
        teamColors: data.teamColors || { teamA: 'blue', teamB: 'red' },
        finalAssignments: data.finalAssignments || [],
        matchPlayers: data.matchPlayers || [],
        teamA: data.teamA || [],
        teamB: data.teamB || []
      };
    });

    // Client-side: filter by mode if specified
    if (modeFilter) {
      results = results.filter(r => r.draftType === modeFilter);
    }

    // Client-side: sort by verifiedAt desc, then slice
    results.sort((a, b) => {
      const dateA = a.verifiedAt ? new Date(a.verifiedAt).getTime() : 0;
      const dateB = b.verifiedAt ? new Date(b.verifiedAt).getTime() : 0;
      return dateB - dateA;
    });

    return results.slice(0, limitCount);
  } catch (error) {
    console.error('Error fetching verified matches:', error);
    return [];
  }
}

/**
 * Backfill matchPlayers for old drafts that don't have it.
 * Reconstructs from permissions (uid → team mapping) + user docs (auroryPlayerId).
 * Saves to Firestore so it only needs to run once per draft.
 * @returns {Array|null} The matchPlayers array, or null if reconstruction failed
 */
async function backfillMatchPlayers(draftId, draftData) {
  try {
    const permissions = draftData.permissions || {};
    const teamALeader = draftData.teamALeader;
    const teamBLeader = draftData.teamBLeader;

    // Extract team UIDs
    const teamAUids = Object.entries(permissions)
      .filter(([, perm]) => perm === 'A')
      .map(([uid]) => uid);
    const teamBUids = Object.entries(permissions)
      .filter(([, perm]) => perm === 'B')
      .map(([uid]) => uid);

    if (teamAUids.length === 0 || teamBUids.length === 0) return null;

    // 🔧 FIX: Sort by leader first
    const sortedTeamAUids = teamALeader ? [
      teamALeader,
      ...teamAUids.filter(uid => uid !== teamALeader)
    ] : teamAUids;

    const sortedTeamBUids = teamBLeader ? [
      teamBLeader,
      ...teamBUids.filter(uid => uid !== teamBLeader)
    ] : teamBUids;

    // Fetch user docs in correct order
    const matchPlayers = [];

    // Process Team A
    for (const uid of sortedTeamAUids) {
      try {
        const userDoc = await getDoc(doc(db, 'users', uid));
        if (userDoc.exists()) {
          const userData = userDoc.data();
          matchPlayers.push({
            team: 'A',
            uid,
            displayName: userData.displayName || userData.username || null,
            auroryPlayerId: userData.auroryPlayerId || null,
            auroryPlayerName: userData.auroryPlayerName || null
          });
        }
      } catch (e) {
        console.warn(`Could not fetch user ${uid} for backfill:`, e);
      }
    }

    // Process Team B
    for (const uid of sortedTeamBUids) {
      try {
        const userDoc = await getDoc(doc(db, 'users', uid));
        if (userDoc.exists()) {
          const userData = userDoc.data();
          matchPlayers.push({
            team: 'B',
            uid,
            displayName: userData.displayName || userData.username || null,
            auroryPlayerId: userData.auroryPlayerId || null,
            auroryPlayerName: userData.auroryPlayerName || null
          });
        }
      } catch (e) {
        console.warn(`Could not fetch user ${uid} for backfill:`, e);
      }
    }

    if (matchPlayers.length === 0) return null;

    // Save to Firestore
    const draftRef = doc(db, 'drafts', draftId);
    await updateDoc(draftRef, { matchPlayers });

    console.log(`✅ Backfilled matchPlayers for draft ${draftId}:`, matchPlayers.length, 'players');
    return matchPlayers;
  } catch (error) {
    console.error(`Error backfilling matchPlayers for draft ${draftId}:`, error);
    return null;
  }
}

/**
 * Scan all completed drafts that haven't been verified yet and run verification.
 * Called from the home page to proactively verify matches without requiring
 * someone to visit each tournament page.
 * @returns {Promise<number>} Number of drafts newly verified
 */
export async function scanAndVerifyCompletedDrafts() {
  try {
    const draftsRef = collection(db, 'drafts');

    // Find completed drafts that haven't been fully verified
    const q = query(
      draftsRef,
      where('status', '==', 'completed')
    );

    const snapshot = await getDocs(q);
    let newlyVerified = 0;

    for (const docSnap of snapshot.docs) {
      const data = docSnap.data();
      const draftId = docSnap.id;

      // Skip if already fully verified (but re-check if all results were DQ - may be false positive from case mismatch)
      if (data.verificationStatus === 'complete') {
        const hasRealDQ = (data.matchResults || []).some(r =>
          r.status === 'both_disqualified' || r.status === 'disqualified_A' || r.status === 'disqualified_B'
        );
        if (!hasRealDQ) continue; // Legitimate verification, skip
        // Otherwise re-verify to fix potential case mismatch false positives
      }

      // Skip if no battle codes exist
      if (!data.privateCode && !data.privateCodes) continue;

      // Backfill: If no matchPlayers or finalAssignments, try to reconstruct from permissions
      if (!data.matchPlayers?.length && !data.finalAssignments?.length) {
        const backfilled = await backfillMatchPlayers(draftId, data);
        if (!backfilled) continue; // Can't reconstruct, skip
        data.matchPlayers = backfilled;
      }

      // Check if we've checked recently (throttle to every 2 minutes per draft)
      const lastCheck = data.lastVerificationCheck?.toMillis?.() || data.lastVerificationCheck || 0;
      if (lastCheck && (Date.now() - lastCheck) < 120000) continue;

      try {
        const verificationData = await verifyDraftBattles(data, []);

        if (verificationData.results && verificationData.results.length > 0) {
          const hasResults = verificationData.results.some(
            r => r.status !== 'not_found' && r.status !== 'error'
          );
          if (hasResults || verificationData.allVerified) {
            await saveVerificationResults(draftId, verificationData);
            newlyVerified++;
          } else {
            // Still update the check timestamp to throttle retries
            const draftRef = doc(db, 'drafts', draftId);
            await updateDoc(draftRef, { lastVerificationCheck: serverTimestamp() });
          }
        }
      } catch (err) {
        console.error(`Error verifying draft ${draftId}:`, err);
      }
    }

    return newlyVerified;
  } catch (error) {
    console.error('Error scanning completed drafts:', error);
    return 0;
  }
}

const matchVerificationService = {
  fetchMatchByBattleCode,
  verifySingleBattle,
  verifyDraftBattles,
  saveVerificationResults,
  fetchVerifiedMatches,
  scanAndVerifyCompletedDrafts
};

export default matchVerificationService;