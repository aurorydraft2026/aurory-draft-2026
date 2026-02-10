/**
 * verifyMatches.ts
 * Scheduled Cloud Function that scans completed drafts and verifies
 * in-game battles against drafted lineups using the Aurory API.
 *
 * Runs every 2 minutes. Replaces the client-side polling in
 * TournamentPage.js and scanAndVerifyCompletedDrafts().
 */

import * as admin from 'firebase-admin';

const db = admin.firestore();
const AURORY_API_BASE = 'https://aggregator-api.live.aurory.io';

/**
 * Main verification scan
 */
export async function scanAndVerifyDrafts(): Promise<number> {
  let newlyVerified = 0;

  // Find completed drafts that aren't fully verified
  const snapshot = await db.collection('drafts')
    .where('status', '==', 'completed')
    .get();

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const draftId = doc.id;

    // Skip if already fully verified (unless all results were DQ — possible false positive)
    if (data.verificationStatus === 'complete') {
      const hasRealDQ = (data.matchResults || []).some((r: any) =>
        r.status === 'both_disqualified' || r.status === 'disqualified_A' || r.status === 'disqualified_B'
      );
      if (!hasRealDQ) continue;
    }

    // Skip if no battle codes
    if (!data.privateCode && !data.privateCodes) continue;

    // Skip if no player data
    if (!data.matchPlayers?.length && !data.finalAssignments?.length) {
      // Try to backfill matchPlayers from permissions
      const backfilled = await backfillMatchPlayers(draftId, data);
      if (!backfilled) continue;
      data.matchPlayers = backfilled;
    }

    // Throttle: skip if checked < 2 min ago
    const lastCheck = toMillis(data.lastVerificationCheck) || 0;
    if (lastCheck && (Date.now() - lastCheck) < 120000) continue;

    // Skip drafts older than 48 hours since completion
    const completedAt = toMillis(data.completedAt) || toMillis(data.lastVerificationCheck) || 0;
    if (completedAt && (Date.now() - completedAt) > 48 * 60 * 60 * 1000) continue;

    try {
      console.log(`🔍 Verifying draft ${draftId}...`);
      const verificationData = await verifyDraftBattles(data);

      if (verificationData.results && verificationData.results.length > 0) {
        const hasResults = verificationData.results.some(
          (r: any) => r.status !== 'not_found' && r.status !== 'error'
        );

        if (hasResults || verificationData.allVerified) {
          await doc.ref.update({
            matchResults: verificationData.results,
            verificationStatus: verificationData.allVerified ? 'complete' : 'partial',
            overallWinner: verificationData.overallWinner || null,
            score: verificationData.score || null,
            lastVerificationCheck: admin.firestore.FieldValue.serverTimestamp(),
            verifiedAt: verificationData.allVerified ? admin.firestore.FieldValue.serverTimestamp() : null
          });
          newlyVerified++;
          console.log(`  ✅ Draft ${draftId}: ${verificationData.allVerified ? 'FULLY VERIFIED' : 'partial'}`);
        } else {
          // Update timestamp to throttle retries
          await doc.ref.update({
            lastVerificationCheck: admin.firestore.FieldValue.serverTimestamp()
          });
        }
      }
    } catch (err) {
      console.error(`  ❌ Error verifying draft ${draftId}:`, err);
    }
  }

  return newlyVerified;
}

// ─── Aurory API calls (direct, no CORS proxy needed) ───

async function fetchMatchByBattleCode(battleCode: string): Promise<{ matches: any[]; error: string | null }> {
  const url = `${AURORY_API_BASE}/v1/matches?battle_code=${encodeURIComponent(battleCode)}`;

  try {
    const response = await fetch(url, {
      headers: { 'accept': 'application/json' }
    });

    if (!response.ok) {
      return { error: `API error: ${response.status}`, matches: [] };
    }

    const result = await response.json() as any;
    return { matches: result.data || [], error: null };
  } catch (error: any) {
    console.error('Error fetching match by battle code:', error.message);
    return { error: error.message, matches: [] };
  }
}

// ─── Verification logic (mirrors client-side matchVerificationService.js) ───

async function verifySingleBattle(config: any): Promise<any> {
  const { battleCode, playerAId, playerBId, draftedAmikosA, draftedAmikosB, playerAName, playerBName } = config;

  const { matches, error } = await fetchMatchByBattleCode(battleCode);

  if (error) return { status: 'error', error };
  if (!matches || matches.length === 0) {
    return { status: 'not_found', error: 'Match not yet played or battle code not found.' };
  }

  // Use most recent match
  const match = matches.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];

  // Verify participants
  const matchPlayerIds = match.match_players?.map((mp: any) => mp.player_id) || [];

  if (!matchPlayerIds.includes(playerAId) || !matchPlayerIds.includes(playerBId)) {
    const playerAInMatch = matchPlayerIds.includes(playerAId);
    const playerBInMatch = matchPlayerIds.includes(playerBId);

    if (!playerAInMatch && !playerBInMatch) {
      return { status: 'wrong_players', error: 'Neither drafted player found in match.' };
    }

    return {
      status: 'player_mismatch',
      error: `Player mismatch: ${!playerAInMatch ? playerAName : playerBName} did not play.`,
      winner: !playerAInMatch ? 'B' : 'A',
      winnerName: !playerAInMatch ? playerBName : playerAName
    };
  }

  // Extract actual amikos used
  const playerAData = match.data?.players?.find((p: any) => p.playerId === playerAId);
  const playerBData = match.data?.players?.find((p: any) => p.playerId === playerBId);
  const usedAmikosA = playerAData?.nefties?.map((n: any) => n.collection_id) || [];
  const usedAmikosB = playerBData?.nefties?.map((n: any) => n.collection_id) || [];

  // Verify lineups (order-independent)
  const lineupAValid = verifyLineup(draftedAmikosA, usedAmikosA);
  const lineupBValid = verifyLineup(draftedAmikosB, usedAmikosB);

  const playerAOutcome = match.match_players?.find((mp: any) => mp.player_id === playerAId)?.outcome;
  const playerBOutcome = match.match_players?.find((mp: any) => mp.player_id === playerBId)?.outcome;

  let status, winner, disqualificationReason;

  if (!lineupAValid && !lineupBValid) {
    status = 'both_disqualified';
    winner = null;
    disqualificationReason = 'Both players used different Amikos than drafted.';
  } else if (!lineupAValid) {
    status = 'disqualified_A';
    winner = 'B';
    disqualificationReason = `${playerAName} used different Amikos than drafted.`;
  } else if (!lineupBValid) {
    status = 'disqualified_B';
    winner = 'A';
    disqualificationReason = `${playerBName} used different Amikos than drafted.`;
  } else {
    status = 'verified';
    winner = playerAOutcome === 'win' ? 'A' : 'B';
    disqualificationReason = null;
  }

  return {
    status, winner,
    winnerName: winner === 'A' ? playerAName : winner === 'B' ? playerBName : null,
    loserName: winner === 'A' ? playerBName : winner === 'B' ? playerAName : null,
    disqualificationReason,
    matchTimestamp: match.created_at,
    duration: match.data?.duration || null,
    totalTurns: match.data?.totalBattleTurns || null,
    playerA: {
      playerId: playerAId, displayName: playerAName,
      draftedAmikos: draftedAmikosA, usedAmikos: usedAmikosA,
      lineupValid: lineupAValid, outcome: playerAOutcome || null
    },
    playerB: {
      playerId: playerBId, displayName: playerBName,
      draftedAmikos: draftedAmikosB, usedAmikos: usedAmikosB,
      lineupValid: lineupBValid, outcome: playerBOutcome || null
    }
  };
}

function normalizeAmikoId(id: string): string {
  return (id || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function verifyLineup(drafted: string[], actual: string[]): boolean {
  if (!drafted || !actual) return false;
  if (drafted.length === 0) return true;
  if (drafted.length !== actual.length) return false;

  const sortedDrafted = [...drafted].map(normalizeAmikoId).sort();
  const sortedActual = [...actual].map(normalizeAmikoId).sort();
  return sortedDrafted.every((val, idx) => val === sortedActual[idx]);
}

async function verifyDraftBattles(draftData: any): Promise<any> {
  const { draftType, privateCode, privateCodes, matchPlayers, finalAssignments, teamA = [], teamB = [] } = draftData;

  let teamAPlayers: any[], teamBPlayers: any[];

  if (matchPlayers?.length > 0) {
    teamAPlayers = matchPlayers.filter((p: any) => p.team === 'A');
    teamBPlayers = matchPlayers.filter((p: any) => p.team === 'B');
  } else if (finalAssignments?.length > 0) {
    teamAPlayers = finalAssignments.filter((a: any) => a.team === 'A').map((a: any) => ({
      ...a.participant, uid: a.participant.uid || a.participant.id
    }));
    teamBPlayers = finalAssignments.filter((a: any) => a.team === 'B').map((a: any) => ({
      ...a.participant, uid: a.participant.uid || a.participant.id
    }));
  } else {
    return { results: [], allVerified: false, error: 'No team assignments found.' };
  }

  const battleConfigs: any[] = [];

  if (draftType === 'mode3') {
    const pA = teamAPlayers[0];
    const pB = teamBPlayers[0];
    if (!pA?.auroryPlayerId || !pB?.auroryPlayerId) {
      return { results: [], allVerified: false, error: 'Both players must have linked Aurory accounts.' };
    }
    battleConfigs.push({
      battleIndex: 0, battleCode: privateCode,
      playerAId: pA.auroryPlayerId, playerBId: pB.auroryPlayerId,
      playerAName: pA.auroryPlayerName || pA.displayName || 'Player A',
      playerBName: pB.auroryPlayerName || pB.displayName || 'Player B',
      playerAUid: pA.uid, playerBUid: pB.uid,
      draftedAmikosA: teamA.slice(0, 3), draftedAmikosB: teamB.slice(0, 3)
    });
  } else {
    for (let i = 0; i < 3; i++) {
      const pA = teamAPlayers[i];
      const pB = teamBPlayers[i];
      if (!pA?.auroryPlayerId || !pB?.auroryPlayerId) {
        battleConfigs.push({
          battleIndex: i, battleCode: privateCodes?.[i], skip: true,
          error: `Battle ${i + 1}: Missing Aurory link`
        });
        continue;
      }
      battleConfigs.push({
        battleIndex: i, battleCode: privateCodes?.[i],
        playerAId: pA.auroryPlayerId, playerBId: pB.auroryPlayerId,
        playerAName: pA.auroryPlayerName || pA.displayName || `Player A${i + 1}`,
        playerBName: pB.auroryPlayerName || pB.displayName || `Player B${i + 1}`,
        playerAUid: pA.uid, playerBUid: pB.uid,
        draftedAmikosA: teamA.slice(i * 3, i * 3 + 3),
        draftedAmikosB: teamB.slice(i * 3, i * 3 + 3)
      });
    }
  }

  const results: any[] = [];
  for (const config of battleConfigs) {
    if (config.skip) {
      results.push({ battleIndex: config.battleIndex, battleCode: config.battleCode, status: 'error', error: config.error });
      continue;
    }
    if (!config.battleCode) {
      results.push({ battleIndex: config.battleIndex, status: 'error', error: `No battle code for battle ${config.battleIndex + 1}` });
      continue;
    }
    const result = await verifySingleBattle(config);
    results.push({ battleIndex: config.battleIndex, battleCode: config.battleCode, playerAUid: config.playerAUid, playerBUid: config.playerBUid, ...result });
  }

  const allVerified = results.every((r: any) =>
    ['verified', 'disqualified_A', 'disqualified_B', 'both_disqualified'].includes(r.status)
  );

  let overallWinner = null;
  let score = null;

  if (allVerified) {
    const teamAWins = results.filter((r: any) => r.winner === 'A').length;
    const teamBWins = results.filter((r: any) => r.winner === 'B').length;

    if (draftType === 'mode3') {
      overallWinner = results[0]?.winner || null;
      score = overallWinner === 'A' ? '1-0' : overallWinner === 'B' ? '0-1' : null;
    } else {
      score = `${teamAWins}-${teamBWins}`;
      overallWinner = teamAWins > teamBWins ? 'A' : teamBWins > teamAWins ? 'B' : 'draw';
    }
  }

  return { results, allVerified, overallWinner, score };
}

// ─── Backfill helper ───

async function backfillMatchPlayers(draftId: string, draftData: any): Promise<any[] | null> {
  try {
    const permissions = draftData.permissions || {};
    const teamALeader = draftData.teamALeader;
    const teamBLeader = draftData.teamBLeader;

    const teamAUids = Object.entries(permissions).filter(([, perm]) => perm === 'A').map(([uid]) => uid);
    const teamBUids = Object.entries(permissions).filter(([, perm]) => perm === 'B').map(([uid]) => uid);

    if (teamAUids.length === 0 || teamBUids.length === 0) return null;

    const sortedA = teamALeader ? [teamALeader, ...teamAUids.filter(uid => uid !== teamALeader)] : teamAUids;
    const sortedB = teamBLeader ? [teamBLeader, ...teamBUids.filter(uid => uid !== teamBLeader)] : teamBUids;

    const matchPlayers: any[] = [];

    for (const uid of sortedA) {
      const userDoc = await db.doc(`users/${uid}`).get();
      if (userDoc.exists) {
        const u = userDoc.data()!;
        matchPlayers.push({
          team: 'A', uid,
          displayName: u.displayName || null,
          auroryPlayerId: u.auroryPlayerId || null,
          auroryPlayerName: u.auroryPlayerName || null
        });
      }
    }

    for (const uid of sortedB) {
      const userDoc = await db.doc(`users/${uid}`).get();
      if (userDoc.exists) {
        const u = userDoc.data()!;
        matchPlayers.push({
          team: 'B', uid,
          displayName: u.displayName || null,
          auroryPlayerId: u.auroryPlayerId || null,
          auroryPlayerName: u.auroryPlayerName || null
        });
      }
    }

    if (matchPlayers.length === 0) return null;

    await db.doc(`drafts/${draftId}`).update({ matchPlayers });
    return matchPlayers;
  } catch (error) {
    console.error(`Error backfilling matchPlayers for ${draftId}:`, error);
    return null;
  }
}

function toMillis(val: any): number | null {
  if (!val) return null;
  if (typeof val === 'number') return val;
  if (val?.toMillis) return val.toMillis();
  if (val?.seconds) return val.seconds * 1000;
  if (val?._seconds) return val._seconds * 1000;
  return null;
}
