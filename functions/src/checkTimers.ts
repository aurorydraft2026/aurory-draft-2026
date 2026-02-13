/**
 * checkTimers.ts
 * Scheduled Cloud Function that runs every 15 seconds.
 * Checks all active drafts for expired timers and:
 *   - Auto-picks remaining amikos (random)
 *   - Locks the phase
 *   - Advances to next phase (with preparation flag)
 *   - Completes the draft if all phases done
 *
 * Also handles:
 *   - Preparation phase → start next turn timer after 1.5s
 *   - Force-locking when timer expires during awaitingLockConfirmation
 *   - Mode 3 (1v1) simultaneous auto-pick + auto-lock
 */

import * as admin from 'firebase-admin';
import { AMIKO_IDS, getPICK_ORDER, shuffleArray } from './draftData';

const db = admin.firestore();

/**
 * Main timer check - called by the scheduled function
 */
export async function processActiveTimers(): Promise<number> {
  let processed = 0;

  // ─── 1. Check active drafts with expired timers ───
  const activeDrafts = await db.collection('drafts')
    .where('status', '==', 'active')
    .get();

  for (const doc of activeDrafts.docs) {
    try {
      const changed = await checkDraftTimer(doc.id, doc.data());
      if (changed) processed++;
    } catch (err) {
      console.error(`Error processing draft ${doc.id}:`, err);
    }
  }

  // ─── 2. Check drafts in preparation phase (1.5s delay between turns) ───
  const prepDrafts = await db.collection('drafts')
    .where('status', '==', 'active')
    .where('inPreparation', '==', true)
    .get();

  for (const doc of prepDrafts.docs) {
    try {
      const changed = await checkPreparationPhase(doc.id, doc.data());
      if (changed) processed++;
    } catch (err) {
      console.error(`Error processing prep for draft ${doc.id}:`, err);
    }
  }

  // ─── 3. Check stuck coin flip phases (spinning/result/turnChoice/done) ───
  const coinFlipDrafts = await db.collection('drafts')
    .where('status', '==', 'coinFlip')
    .get();

  for (const doc of coinFlipDrafts.docs) {
    try {
      const changed = await checkCoinFlipPhase(doc.id, doc.data());
      if (changed) processed++;
    } catch (err) {
      console.error(`Error processing coin flip for draft ${doc.id}:`, err);
    }
  }

  // ─── 4. Check stuck assignment phase (roulette done but finalizeDraft never called) ───
  const assignmentDrafts = await db.collection('drafts')
    .where('status', '==', 'assignment')
    .get();

  for (const doc of assignmentDrafts.docs) {
    try {
      const changed = await checkStuckAssignment(doc.id, doc.data());
      if (changed) processed++;
    } catch (err) {
      console.error(`Error processing assignment for draft ${doc.id}:`, err);
    }
  }

  return processed;
}

/**
 * Check if a single draft's timer has expired and handle it
 */
async function checkDraftTimer(draftId: string, data: any): Promise<boolean> {
  // Skip if in preparation phase (timer hasn't started yet for next turn)
  if (data.inPreparation) return false;

  // Skip if manual timer is enabled but not started
  if (data.manualTimerStart && !data.timerStarted) return false;

  const now = Date.now();
  const timerDuration = data.timerDuration || 30 * 1000;

  // Determine which timer to check
  let timerStart: number | null = null;

  if (data.draftType === 'mode3' && data.sharedTimer) {
    timerStart = toMillis(data.sharedTimer);
  } else if (data.currentTeam === 'A' && data.timerStartA) {
    timerStart = toMillis(data.timerStartA);
  } else if (data.currentTeam === 'B' && data.timerStartB) {
    timerStart = toMillis(data.timerStartB);
  }

  if (!timerStart) return false;

  const elapsed = now - timerStart;
  const remaining = timerDuration - elapsed;

  // Timer not expired yet
  if (remaining > 0) return false;

  console.log(`⏰ Timer expired for draft ${draftId} (elapsed: ${Math.round(elapsed / 1000)}s)`);

  // Use a transaction to prevent race conditions
  const draftRef = db.doc(`drafts/${draftId}`);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(draftRef);
    if (!snap.exists) return false;

    const current = snap.data()!;

    // Re-verify status hasn't changed (another instance might have handled it)
    if (current.status !== 'active') return false;
    if (current.inPreparation) return false;

    // ─── MODE 3: 1v1 Simultaneous ───
    if (current.draftType === 'mode3') {
      return handleMode3Timeout(tx, draftRef, current);
    }

    // ─── MODE 1/2: Turn-based ───
    const PICK_ORDER = getPICK_ORDER(current.draftType || 'mode1');
    const currentPhase = PICK_ORDER[current.currentPhase || 0];
    if (!currentPhase) return false;

    const phaseComplete = (current.picksInPhase || 0) >= currentPhase.count;

    if (current.awaitingLockConfirmation || phaseComplete) {
      // Timer expired while confirmation modal is open or phase is complete
      // → Force-lock current picks and advance
      return handleForceLock(tx, draftRef, current, PICK_ORDER);
    } else {
      // Timer expired normally → auto-pick remaining + lock + advance
      return handleAutoPick(tx, draftRef, current, PICK_ORDER);
    }
  });
}

/**
 * Mode 3 (1v1): Auto-pick for any team that hasn't finished, then complete
 */
function handleMode3Timeout(
  tx: admin.firestore.Transaction,
  draftRef: admin.firestore.DocumentReference,
  data: any
): boolean {
  const updates: any = {};
  const teamA = data.teamA || [];
  const teamB = data.teamB || [];

  // Auto-pick for Team A if under 3
  if (teamA.length < 3 && data.playerAPool) {
    const available = (data.playerAPool as string[]).filter((id: string) => !teamA.includes(id));
    const shuffled = shuffleArray(available);
    const needed = 3 - teamA.length;
    updates.teamA = [...teamA, ...shuffled.slice(0, needed)];
    console.log(`  → Auto-picked ${needed} amikos for Team A`);
  }

  // Auto-pick for Team B if under 3
  if (teamB.length < 3 && data.playerBPool) {
    const available = (data.playerBPool as string[]).filter((id: string) => !teamB.includes(id));
    const shuffled = shuffleArray(available);
    const needed = 3 - teamB.length;
    updates.teamB = [...teamB, ...shuffled.slice(0, needed)];
    console.log(`  → Auto-picked ${needed} amikos for Team B`);
  }

  updates.lockedTeams = ['A', 'B'];
  updates.status = 'completed';
  updates.timerExpiredBy = 'server';

  tx.update(draftRef, updates);
  console.log(`  ✅ Mode 3 draft completed (timer expired)`);
  return true;
}

/**
 * Force-lock current picks and advance to next phase (no auto-pick needed)
 */
function handleForceLock(
  tx: admin.firestore.Transaction,
  draftRef: admin.firestore.DocumentReference,
  data: any,
  PICK_ORDER: any[]
): boolean {
  const newLockedPhases = [...(data.lockedPhases || []), data.currentPhase];
  const nextPhase = (data.currentPhase || 0) + 1;

  if (nextPhase >= PICK_ORDER.length) {
    // Draft complete
    tx.update(draftRef, {
      status: 'completed',
      awaitingLockConfirmation: false,
      lockedPhases: newLockedPhases,
      timerExpiredBy: 'server'
    });
    console.log(`  ✅ Draft completed (force-lock, all phases done)`);
  } else {
    // Advance to next phase
    const nextTeam = PICK_ORDER[nextPhase].team;
    tx.update(draftRef, {
      currentPhase: nextPhase,
      currentTeam: nextTeam,
      picksInPhase: 0,
      awaitingLockConfirmation: false,
      lockedPhases: newLockedPhases,
      inPreparation: true,
      preparationStartedAt: Date.now(),
      timerExpiredBy: 'server'
    });
    console.log(`  → Force-locked phase ${data.currentPhase}, advancing to phase ${nextPhase} (Team ${nextTeam})`);
  }

  return true;
}

/**
 * Auto-pick random amikos for remaining picks, then lock + advance
 * Mode4 ban phases: fill remaining with 'no_ban' placeholder
 * Mode4 pick phases: auto-pick from available (not banned, not picked by own team)
 */
function handleAutoPick(
  tx: admin.firestore.Transaction,
  draftRef: admin.firestore.DocumentReference,
  data: any,
  PICK_ORDER: any[]
): boolean {
  const currentPhaseConfig = PICK_ORDER[data.currentPhase || 0];
  const remaining = currentPhaseConfig.count - (data.picksInPhase || 0);

  if (remaining <= 0) return false;

  const updates: any = {};

  if (currentPhaseConfig.isBan) {
    // ─── MODE 4 BAN PHASE: Fill remaining with 'no_ban' placeholder ───
    const banKey = data.currentTeam === 'A' ? 'teamABans' : 'teamBBans';
    const currentBans: string[] = [...(data[banKey] || [])];

    for (let i = 0; i < remaining; i++) {
      currentBans.push('no_ban');
    }

    updates[banKey] = currentBans;
    // 'no_ban' entries do NOT go into bannedAmikos (they're not real bans)
    console.log(`  → Auto-filled ${remaining} 'no_ban' placeholders for Team ${data.currentTeam}`);
  } else if (data.draftType === 'mode4') {
    // ─── MODE 4 PICK PHASE: Auto-pick from non-banned, not in own team ───
    const teamKey = data.currentTeam === 'A' ? 'teamA' : 'teamB';
    const teamPicks: string[] = [...(data[teamKey] || [])];
    const bannedAmikos: string[] = data.bannedAmikos || [];

    // Mode4: only exclude own team picks + banned (opponent CAN have same)
    const available = AMIKO_IDS.filter(id =>
      !teamPicks.includes(id) && !bannedAmikos.includes(id) && id !== 'no_ban'
    );
    const shuffled = shuffleArray(available);
    const autoPicked = shuffled.slice(0, Math.min(remaining, shuffled.length));

    updates[teamKey] = [...teamPicks, ...autoPicked];
    console.log(`  → Auto-picked ${autoPicked.length} amikos for Team ${data.currentTeam} (mode4): ${autoPicked.join(', ')}`);
  } else {
    // ─── MODE 1/2: Standard auto-pick (exclusive) ───
    const teamKey = data.currentTeam === 'A' ? 'teamA' : 'teamB';
    const teamPicks: string[] = [...(data[teamKey] || [])];
    const allPicked = [...(data.teamA || []), ...(data.teamB || [])];

    const available = AMIKO_IDS.filter(id => !allPicked.includes(id));
    const shuffled = shuffleArray(available);
    const autoPicked = shuffled.slice(0, Math.min(remaining, shuffled.length));

    updates[teamKey] = [...teamPicks, ...autoPicked];
    console.log(`  → Auto-picked ${autoPicked.length} amikos for Team ${data.currentTeam}: ${autoPicked.join(', ')}`);
  }

  // Lock current phase and advance
  const newLockedPhases = [...(data.lockedPhases || []), data.currentPhase];
  const nextPhase = (data.currentPhase || 0) + 1;

  if (nextPhase >= PICK_ORDER.length) {
    // Draft complete
    tx.update(draftRef, {
      ...updates,
      picksInPhase: currentPhaseConfig.count,
      status: 'completed',
      awaitingLockConfirmation: false,
      lockedPhases: newLockedPhases,
      timerExpiredBy: 'server'
    });
    console.log(`  ✅ Draft completed (auto-pick, all phases done)`);
  } else {
    // Advance to next phase with preparation
    const nextTeam = PICK_ORDER[nextPhase].team;
    tx.update(draftRef, {
      ...updates,
      picksInPhase: 0,
      currentPhase: nextPhase,
      currentTeam: nextTeam,
      awaitingLockConfirmation: false,
      lockedPhases: newLockedPhases,
      inPreparation: true,
      preparationStartedAt: Date.now(),
      timerExpiredBy: 'server'
    });
    console.log(`  → Auto-filled + advancing to phase ${nextPhase} (Team ${nextTeam})`);
  }

  return true;
}

/**
 * Check if a draft in preparation phase should start its next turn
 * The preparation delay is 1.5 seconds between turns
 */
async function checkPreparationPhase(draftId: string, data: any): Promise<boolean> {
  if (!data.inPreparation) return false;

  const prepStart = toMillis(data.preparationStartedAt) || 0;
  if (!prepStart) {
    // No timestamp — set one so we can track it
    await db.doc(`drafts/${draftId}`).update({
      preparationStartedAt: Date.now()
    });
    return false;
  }

  const elapsed = Date.now() - prepStart;
  if (elapsed < 1500) return false; // Not ready yet

  console.log(`⏳ Preparation complete for draft ${draftId}, starting Team ${data.currentTeam}'s timer`);

  const updates: any = {
    inPreparation: false,
    preparationStartedAt: admin.firestore.FieldValue.delete()
  };

  // Start timer for the current team
  if (data.draftType === 'mode3') {
    updates.sharedTimer = Date.now();
  } else if (data.currentTeam === 'A') {
    updates.timerStartA = Date.now();
  } else {
    updates.timerStartB = Date.now();
  }

  await db.doc(`drafts/${draftId}`).update(updates);
  return true;
}

/**
 * Convert Firestore Timestamp or number to milliseconds
 */
function toMillis(val: any): number | null {
  if (!val) return null;
  if (typeof val === 'number') return val;
  if (val?.toMillis) return val.toMillis();
  if (val?.seconds) return val.seconds * 1000;
  if (val?._seconds) return val._seconds * 1000;
  return null;
}

// ═══════════════════════════════════════════════════════════════════════
// COIN FLIP PHASE HANDLING
// ═══════════════════════════════════════════════════════════════════════

/**
 * Handle stuck coin flip phases when no browser is open to fire setTimeout.
 * Phase flow: waiting → spinning (3s) → result (2s) → turnChoice → done (2s) → assignment
 */
async function checkCoinFlipPhase(draftId: string, data: any): Promise<boolean> {
  const coinFlip = data.coinFlip;
  if (!coinFlip) return false;

  const phaseChangedAt = toMillis(coinFlip.phaseChangedAt) || 0;
  const now = Date.now();
  const draftRef = db.doc(`drafts/${draftId}`);

  switch (coinFlip.phase) {
    case 'spinning': {
      // After 5s of spinning, advance to result
      if (!phaseChangedAt) {
        // No timestamp — set one and wait for next check
        await draftRef.update({ 'coinFlip.phaseChangedAt': now });
        return false;
      }
      if (now - phaseChangedAt < 5000) return false;

      console.log(`🪙 Coin flip spinning → result for draft ${draftId}`);
      await draftRef.update({
        'coinFlip.phase': 'result',
        'coinFlip.phaseChangedAt': now
      });
      return true;
    }

    case 'result': {
      // After 4s showing result, advance to turnChoice
      if (!phaseChangedAt || now - phaseChangedAt < 4000) return false;

      console.log(`🪙 Coin flip result → turnChoice for draft ${draftId}`);
      await draftRef.update({
        'coinFlip.phase': 'turnChoice',
        'coinFlip.phaseChangedAt': now
      });
      return true;
    }

    case 'turnChoice': {
      // If winner hasn't picked after 120 seconds, auto-select 'first'
      if (!phaseChangedAt || now - phaseChangedAt < 120000) return false;

      console.log(`🪙 Coin flip turnChoice timeout → auto-selecting 'first' for draft ${draftId}`);
      await draftRef.update({
        'coinFlip.winnerTurnChoice': 'first',
        'coinFlip.phase': 'done',
        'coinFlip.phaseChangedAt': now
      });
      return true;
    }

    case 'done': {
      // After 5s at 'done', run continueDraftAfterCoinFlip server-side
      if (!phaseChangedAt || now - phaseChangedAt < 5000) return false;

      console.log(`🪙 Coin flip done → building team assignments for draft ${draftId}`);
      return await serverContinueDraftAfterCoinFlip(draftId, data);
    }

    default:
      return false;
  }
}

/**
 * Server-side equivalent of continueDraftAfterCoinFlip.
 * Reads coinFlip.winner + winnerTurnChoice + preAssignedTeams → writes status: 'assignment'.
 */
async function serverContinueDraftAfterCoinFlip(draftId: string, data: any): Promise<boolean> {
  const coinFlip = data.coinFlip;
  const teams = data.preAssignedTeams;
  if (!coinFlip || !teams?.team1 || !teams?.team2) return false;

  const winner = coinFlip.winner;
  const winnerTurnChoice = coinFlip.winnerTurnChoice || 'first';
  const { team1, team2 } = teams;

  // Determine which team picks first (becomes Team A)
  let firstPickTeam: any, secondPickTeam: any;
  let teamAIsOriginalTeam1: boolean;

  if (winner === 1) {
    if (winnerTurnChoice === 'first') {
      firstPickTeam = team1; secondPickTeam = team2; teamAIsOriginalTeam1 = true;
    } else {
      firstPickTeam = team2; secondPickTeam = team1; teamAIsOriginalTeam1 = false;
    }
  } else {
    if (winnerTurnChoice === 'first') {
      firstPickTeam = team2; secondPickTeam = team1; teamAIsOriginalTeam1 = false;
    } else {
      firstPickTeam = team1; secondPickTeam = team2; teamAIsOriginalTeam1 = true;
    }
  }

  // Build user lists from team data (leader, member1, member2)
  const teamAUids = [firstPickTeam.leader, firstPickTeam.member1, firstPickTeam.member2].filter(Boolean);
  const teamBUids = [secondPickTeam.leader, secondPickTeam.member1, secondPickTeam.member2].filter(Boolean);

  // Fetch user data from Firestore
  const allUids = [...teamAUids, ...teamBUids];
  const userDocs = await Promise.all(allUids.map(uid => db.doc(`users/${uid}`).get()));
  const userMap: any = {};
  for (const doc of userDocs) {
    if (doc.exists) userMap[doc.id] = { uid: doc.id, ...doc.data() };
  }

  const finalAssignments = [
    ...teamAUids.map(uid => ({ participant: userMap[uid] || { uid }, team: 'A' })),
    ...teamBUids.map(uid => ({ participant: userMap[uid] || { uid }, team: 'B' }))
  ];

  await db.doc(`drafts/${draftId}`).update({
    status: 'assignment',
    assignmentStartedAt: Date.now(),
    finalAssignments,
    assignmentLeaders: {
      teamALeader: firstPickTeam.leader,
      teamBLeader: secondPickTeam.leader,
      teamAIsOriginalTeam1
    }
  });

  console.log(`  ✅ Team assignments written for draft ${draftId}`);
  return true;
}

// ═══════════════════════════════════════════════════════════════════════
// STUCK ASSIGNMENT PHASE HANDLING
// ═══════════════════════════════════════════════════════════════════════

/**
 * If a draft has been in 'assignment' for > 15 seconds without being finalized,
 * the server runs finalizeDraft to start the actual draft.
 * This covers cases where no admin/leader had a browser open.
 */
async function checkStuckAssignment(draftId: string, data: any): Promise<boolean> {
  const assignmentStart = toMillis(data.assignmentStartedAt) || 0;
  if (!assignmentStart) {
    // No timestamp — set one and wait
    await db.doc(`drafts/${draftId}`).update({ assignmentStartedAt: Date.now() });
    return false;
  }

  // Wait 15 seconds (enough time for roulette animation to complete on connected clients)
  if (Date.now() - assignmentStart < 15000) return false;

  // Verify we have the data needed
  if (!data.finalAssignments?.length || !data.assignmentLeaders) {
    console.error(`  ❌ Draft ${draftId} stuck in assignment but missing finalAssignments/leaders`);
    return false;
  }

  console.log(`🎰 Assignment stuck for draft ${draftId}, running server-side finalizeDraft`);
  return await serverFinalizeDraft(draftId, data);
}

/**
 * Server-side equivalent of finalizeDraft.
 * Reads finalAssignments + assignmentLeaders from Firestore → writes status: 'active'.
 */
async function serverFinalizeDraft(draftId: string, data: any): Promise<boolean> {
  const draftRef = db.doc(`drafts/${draftId}`);
  const assignments: any[] = data.finalAssignments;
  const leaders = data.assignmentLeaders || {};

  // Build permissions
  const permissions: any = data.permissions || {};
  for (const a of assignments) {
    const uid = a.participant?.uid || a.participant?.id;
    if (uid) permissions[uid] = a.team;
  }

  const manualTimer = data.manualTimerStart || false;
  const timerMs = data.timerDuration || 30 * 1000;

  // Fetch leader user data for display names
  const teamALeaderDoc = leaders.teamALeader ? await db.doc(`users/${leaders.teamALeader}`).get() : null;
  const teamBLeaderDoc = leaders.teamBLeader ? await db.doc(`users/${leaders.teamBLeader}`).get() : null;
  const teamALeaderData = teamALeaderDoc?.data();
  const teamBLeaderData = teamBLeaderDoc?.data();

  const teamColors = {
    teamA: leaders.teamAIsOriginalTeam1 === false ? 'red' : 'blue',
    teamB: leaders.teamAIsOriginalTeam1 === false ? 'blue' : 'red'
  };

  const updateData: any = {
    teamA: [],
    teamB: [],
    currentPhase: 0,
    currentTeam: 'A',
    picksInPhase: 0,
    timerStartA: manualTimer ? null : Date.now(),
    timerStartB: null,
    timerStarted: !manualTimer,
    status: 'active',
    permissions,
    lockedPhases: [],
    awaitingLockConfirmation: false,
    timerDuration: timerMs,
    teamALeader: leaders.teamALeader || null,
    teamBLeader: leaders.teamBLeader || null,
    leaderNames: {
      ...(data.leaderNames || {}),
      teamA: teamALeaderData?.username || teamALeaderData?.displayName || 'Team A Captain',
      teamB: teamBLeaderData?.username || teamBLeaderData?.displayName || 'Team B Captain'
    },
    teamNames: data.teamNames || { team1: 'Team 1', team2: 'Team 2' },
    teamBanners: data.teamBanners || { team1: null, team2: null },
    teamColors,
    matchPlayers: assignments.map((a: any) => ({
      team: a.team,
      uid: a.participant?.uid || a.participant?.id || null,
      displayName: a.participant?.displayName || a.participant?.username || null,
      auroryPlayerId: a.participant?.auroryPlayerId || null,
      auroryPlayerName: a.participant?.auroryPlayerName || null
    })),
    finalAssignments: admin.firestore.FieldValue.delete(),
    assignmentLeaders: admin.firestore.FieldValue.delete(),
    assignmentStartedAt: admin.firestore.FieldValue.delete()
  };

  // Mode 3: 1v1 pool shuffle
  if (data.draftType === 'mode3') {
    const shuffled = shuffleArray(AMIKO_IDS);
    updateData.playerAPool = shuffled.slice(0, 8);
    updateData.playerBPool = shuffled.slice(8, 16);
    updateData.simultaneousPicking = true;
    updateData.currentTeam = 'AB';
    updateData.sharedTimer = manualTimer ? null : Date.now();
    updateData.timerMs = timerMs;
    updateData.status = 'poolShuffle';

    if (!data.privateCode) {
      updateData.privateCode = Math.floor(10000 + Math.random() * 90000).toString();
    }
  }

  // Mode 1/2: 3v3 battle codes
  if ((data.draftType === 'mode1' || data.draftType === 'mode2') && !data.privateCodes) {
    const codes: string[] = [];
    while (codes.length < 3) {
      const code = Math.floor(10000 + Math.random() * 90000).toString();
      if (!codes.includes(code)) codes.push(code);
    }
    updateData.privateCodes = codes;
  }

  await draftRef.update(updateData);
  console.log(`  ✅ Draft ${draftId} finalized by server → status: ${updateData.status}`);
  return true;
}