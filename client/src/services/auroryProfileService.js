// auroryProfileService.js
// Service for connecting to Aurory API via CORS proxy
// Includes match history, Amiko usage stats, and account linking

import {
  doc, getDoc, updateDoc, serverTimestamp,
  collection, query, where, getDocs
} from 'firebase/firestore';
import { db } from '../firebase';

const AURORY_API_BASE = 'https://aggregator-api.live.aurory.io';

// Use a CORS proxy for browser requests
// Options: 
// 1. https://corsproxy.io/?
// 2. https://api.allorigins.win/raw?url=
// 3. Your own proxy
const CORS_PROXY = 'https://corsproxy.io/?';

// ============================================================================
// API FUNCTIONS
// ============================================================================

/**
 * Fetch player profile from Aurory API v2
 * Endpoint: /v2/players?player_ids=p-XXXXX
 * Returns profile picture URL, player name, etc.
 * @param {string} playerId - Player ID (p-XXX format)
 * @returns {Promise<Object>} Player profile data
 */
export async function fetchPlayerProfile(playerId) {
  const apiUrl = `${AURORY_API_BASE}/v2/players?player_ids=${encodeURIComponent(playerId)}`;
  const proxyUrl = `${CORS_PROXY}${encodeURIComponent(apiUrl)}`;

  try {
    const response = await fetch(proxyUrl, {
      headers: { 'accept': 'application/json' }
    });

    if (!response.ok) {
      if (response.status === 404) {
        return { error: 'Player not found', status: 404 };
      }
      throw new Error(`API error: ${response.status}`);
    }

    const result = await response.json();

    if (result.data && result.data.length > 0) {
      const player = result.data[0];
      return {
        playerId: player.player_id,
        playerName: player.player_name,
        profilePicture: player.profile_picture?.url || null,
        profilePictureName: player.profile_picture?.name || null,
        createdAt: player.created_at,
        updatedAt: player.updated_at
      };
    }

    return { error: 'Player not found in response' };
  } catch (error) {
    console.error('Error fetching player profile:', error);
    return { error: error.message };
  }
}

/**
 * Fetch player matches from Aurory API
 * @param {string} playerIdOrWallet - Player ID (p-XXX) or wallet address
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Player data with matches
 */
export async function fetchPlayerMatches(playerIdOrWallet, options = {}) {
  const {
    event = null,
    gameMode = 'pvp',
    battleCode = null,
    page = 0
  } = options;

  const params = new URLSearchParams({
    player_id_or_name: playerIdOrWallet,
    game_mode: gameMode
  });

  if (event) params.append('event', event);
  if (battleCode) params.append('battle_code', battleCode);
  if (page > 0) params.append('page', page.toString());

  const apiUrl = `${AURORY_API_BASE}/v1/player-matches?${params}`;
  const proxyUrl = `${CORS_PROXY}${encodeURIComponent(apiUrl)}`;

  try {
    const response = await fetch(proxyUrl, {
      headers: { 'accept': 'application/json' }
    });

    if (!response.ok) {
      if (response.status === 404) {
        return { error: 'Player not found', status: 404 };
      }
      throw new Error(`API error: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error fetching player matches:', error);
    throw error;
  }
}

/**
 * Validate a player ID or wallet by attempting to fetch their data
 * @param {string} playerIdOrWallet - Player ID or wallet to validate
 * @returns {Promise<Object>} Validation result with player info
 */
export async function validateAuroryAccount(playerIdOrWallet) {
  try {
    const data = await fetchPlayerMatches(playerIdOrWallet, { event: 'PRIVATE_MATCH' });

    if (data.error) {
      return {
        valid: false,
        error: data.error
      };
    }

    const playerId = data.player?.player_id;

    // Fetch profile picture from the v2/players endpoint (more reliable)
    let profilePicture = null;
    let isAurorian = false;
    if (playerId) {
      const profile = await fetchPlayerProfile(playerId);
      if (!profile.error) {
        profilePicture = profile.profilePicture;
        // Detect Aurorian holder: if profile picture name includes "Aurorian"
        isAurorian = profile.profilePictureName
          ? profile.profilePictureName.toLowerCase().includes('aurorian')
          : false;
      }
    }

    return {
      valid: true,
      playerId: playerId,
      playerName: data.player?.player_name,
      wallet: data.player?.wallet || (playerIdOrWallet.startsWith('p-') ? null : playerIdOrWallet),
      profilePicture: profilePicture,
      isAurorian: isAurorian,
      totalMatches: data.matches?.total_elements || 0
    };
  } catch (error) {
    return {
      valid: false,
      error: error.message
    };
  }
}

/**
 * Get private matches for a player (dual-fetch approach)
 * Uses TWO strategies and merges results to catch API inconsistencies:
 *   1. Fetch ALL PvP matches, filter client-side by battle_code
 *   2. Fetch with event=PRIVATE_MATCH filter
 * Deduplicates and returns sorted by most recent.
 * @param {string} playerIdOrWallet - Player ID or wallet
 * @param {number} maxMatches - Maximum private matches to return (default 50)
 * @param {Function} onProgress - Progress callback
 * @returns {Promise<Array>} Array of processed match data, sorted most recent first
 */
export async function getPrivateMatchHistory(playerIdOrWallet, maxMatches = 50, onProgress = null) {
  try {
    // First, resolve the actual player_id (needed for global endpoint filtering)
    let resolvedPlayerId = playerIdOrWallet;
    if (!playerIdOrWallet.startsWith('p-')) {
      // If wallet or name was passed, resolve to player_id via a quick lookup
      const lookup = await fetchPlayerMatches(playerIdOrWallet, { event: 'PRIVATE_MATCH' });
      if (lookup.player?.player_id) {
        resolvedPlayerId = lookup.player.player_id;
      }
    }

    // Run all three strategies in parallel
    const [generalMatches, filteredMatches, globalMatches] = await Promise.all([
      fetchPrivateMatchesGeneral(playerIdOrWallet, maxMatches, onProgress),
      fetchPrivateMatchesFiltered(playerIdOrWallet, maxMatches),
      fetchPrivateMatchesGlobal(resolvedPlayerId, maxMatches)
    ]);

    // Merge and deduplicate by battle_code + timestamp
    // Strategy 1 & 2 are listed first so their entries (with opponent names) take priority
    const seen = new Set();
    const allMatches = [];

    for (const match of [...generalMatches, ...filteredMatches, ...globalMatches]) {
      const key = `${match.battleCode}-${match.timestamp}`;
      if (!seen.has(key)) {
        seen.add(key);
        allMatches.push(match);
      }
    }

    // Resolve opponent names for matches from the global endpoint (they only have player IDs)
    const unresolvedIds = new Set();
    for (const match of allMatches) {
      if (match.opponent?.id && match.opponent.name === match.opponent.id) {
        unresolvedIds.add(match.opponent.id);
      }
    }

    if (unresolvedIds.size > 0) {
      // Batch resolve player names via /v2/players (supports comma-separated IDs)
      const ids = [...unresolvedIds];
      try {
        const apiUrl = `${AURORY_API_BASE}/v2/players?player_ids=${ids.map(id => encodeURIComponent(id)).join(',')}`;
        const proxyUrl = `${CORS_PROXY}${encodeURIComponent(apiUrl)}`;
        const resp = await fetch(proxyUrl, { headers: { 'accept': 'application/json' } });
        if (resp.ok) {
          const result = await resp.json();
          const nameMap = {};
          for (const p of (result.data || [])) {
            nameMap[p.player_id] = p.player_name;
          }
          for (const match of allMatches) {
            if (match.opponent?.id && nameMap[match.opponent.id]) {
              match.opponent.name = nameMap[match.opponent.id];
            }
          }
        }
      } catch (e) {
        // Name resolution is best-effort; matches still show with IDs
        console.warn('Could not resolve opponent names:', e);
      }
    }

    // Sort by most recent first
    return allMatches
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, maxMatches);
  } catch (error) {
    console.error('Error fetching private match history:', error);
    return [];
  }
}

/**
 * Strategy 1: Fetch ALL PvP matches via /v1/player-matches, filter client-side by battle_code
 */
async function fetchPrivateMatchesGeneral(playerIdOrWallet, maxMatches, onProgress) {
  const privateMatches = [];
  let currentPage = 0;
  const maxPages = 100;

  while (privateMatches.length < maxMatches && currentPage < maxPages) {
    const data = await fetchPlayerMatches(playerIdOrWallet, {
      page: currentPage
    });

    if (data.error || !data.matches?.data || data.matches.data.length === 0) break;

    const playerId = data.player?.player_id;
    const totalPages = data.matches.total_pages || 1;

    if (onProgress) {
      onProgress({
        currentPage: currentPage + 1,
        totalPages,
        matchesFound: privateMatches.length
      });
    }

    for (const match of data.matches.data) {
      const battleCode = match.data?.battle_code;
      if (!battleCode) continue;

      privateMatches.push(processMatch(match, playerId));
      if (privateMatches.length >= maxMatches) break;
    }

    currentPage++;
    if (currentPage >= totalPages) break;
  }

  return privateMatches;
}

/**
 * Strategy 2: Fetch with event=PRIVATE_MATCH filter via /v1/player-matches
 */
async function fetchPrivateMatchesFiltered(playerIdOrWallet, maxMatches) {
  const privateMatches = [];
  let currentPage = 0;
  const maxPages = 10;

  while (privateMatches.length < maxMatches && currentPage < maxPages) {
    const data = await fetchPlayerMatches(playerIdOrWallet, {
      event: 'PRIVATE_MATCH',
      page: currentPage
    });

    if (data.error || !data.matches?.data || data.matches.data.length === 0) break;

    const playerId = data.player?.player_id;

    for (const match of data.matches.data) {
      privateMatches.push(processMatch(match, playerId));
      if (privateMatches.length >= maxMatches) break;
    }

    const totalPages = data.matches.total_pages || 1;
    currentPage++;
    if (currentPage >= totalPages) break;
  }

  return privateMatches;
}

/**
 * Strategy 3: Fetch from global /v1/matches endpoint
 * This endpoint is more reliable but returns ALL private matches (not player-specific),
 * so we filter client-side for matches containing our player_id.
 */
async function fetchPrivateMatchesGlobal(playerId, maxMatches) {
  const privateMatches = [];
  let currentPage = 0;
  const maxPages = 50;
  let emptyStreak = 0; // Track consecutive pages with no matches for us

  while (privateMatches.length < maxMatches && currentPage < maxPages) {
    const data = await fetchGlobalMatches({
      event: 'PRIVATE_MATCH',
      page: currentPage
    });

    if (data.error || !data.data || data.data.length === 0) break;

    let foundOnThisPage = false;

    for (const match of data.data) {
      // Check if this match involves our player
      const isOurMatch = match.match_players?.some(mp => mp.player_id === playerId);
      if (!isOurMatch) continue;

      foundOnThisPage = true;
      privateMatches.push(processGlobalMatch(match, playerId));
      if (privateMatches.length >= maxMatches) break;
    }

    // If we haven't found any of our matches in 5 consecutive pages, stop
    // (matches are roughly chronological, so gaps shouldn't be too large)
    if (!foundOnThisPage) {
      emptyStreak++;
      if (emptyStreak >= 5) break;
    } else {
      emptyStreak = 0;
    }

    const totalPages = data.total_pages || 1;
    currentPage++;
    if (currentPage >= totalPages) break;
  }

  return privateMatches;
}

/**
 * Fetch matches from the global /v1/matches endpoint
 */
async function fetchGlobalMatches(options = {}) {
  const {
    event = null,
    gameMode = 'pvp',
    battleCode = null,
    page = 0
  } = options;

  const params = new URLSearchParams({ game_mode: gameMode });
  if (event) params.append('event', event);
  if (battleCode) params.append('battle_code', battleCode);
  if (page > 0) params.append('page', page.toString());

  const apiUrl = `${AURORY_API_BASE}/v1/matches?${params}`;
  const proxyUrl = `${CORS_PROXY}${encodeURIComponent(apiUrl)}`;

  try {
    const response = await fetch(proxyUrl, {
      headers: { 'accept': 'application/json' }
    });

    if (!response.ok) {
      return { error: `API error: ${response.status}` };
    }

    return await response.json();
  } catch (error) {
    console.error('Error fetching global matches:', error);
    return { error: error.message };
  }
}

/**
 * Process a match from the global /v1/matches endpoint into our clean format.
 * Different structure from /v1/player-matches: uses match_players[] instead of player/opponent.
 */
function processGlobalMatch(match, playerId) {
  const ourPlayer = match.match_players?.find(mp => mp.player_id === playerId);
  const opponent = match.match_players?.find(mp => mp.player_id !== playerId);

  const ourPlayerData = match.data?.players?.find(p => p.playerId === playerId);
  const opponentData = match.data?.players?.find(p => p.playerId !== playerId);

  return {
    id: `${match.created_at}-${opponent?.player_id || 'unknown'}`,
    timestamp: match.created_at,
    result: ourPlayer?.outcome === 'win' ? 'win' : 'loss',
    opponent: {
      id: opponent?.player_id || null,
      name: opponent?.player_id || 'Unknown' // Global endpoint doesn't include names
    },
    battleCode: match.data?.battle_code || '',
    duration: match.data?.duration,
    totalTurns: match.data?.totalBattleTurns,
    playerAmikos: ourPlayerData?.nefties?.map(n => n.collection_id) || [],
    opponentAmikos: opponentData?.nefties?.map(n => n.collection_id) || []
  };
}

/**
 * Process a raw API match into our clean format
 */
function processMatch(match, playerId) {
  return {
    id: `${match.created_at}-${match.opponent?.id}`,
    timestamp: match.created_at,
    result: match.result,
    opponent: {
      id: match.opponent?.id,
      name: match.opponent?.player_name
    },
    battleCode: match.data?.battle_code || '',
    duration: match.data?.duration,
    totalTurns: match.data?.totalBattleTurns,
    playerAmikos: extractPlayerAmikos(match, playerId),
    opponentAmikos: extractOpponentAmikos(match, playerId)
  };
}


/**
 * Extract player's Amikos from match data
 */
function extractPlayerAmikos(match, playerId) {
  const playerData = match.data?.players?.find(p => p.playerId === playerId);
  return playerData?.nefties?.map(n => n.collection_id) || [];
}

/**
 * Extract opponent's Amikos from match data
 */
function extractOpponentAmikos(match, playerId) {
  const opponentData = match.data?.players?.find(p => p.playerId !== playerId);
  return opponentData?.nefties?.map(n => n.collection_id) || [];
}

/**
 * Calculate Amiko usage statistics from match history
 * @param {Array} matches - Array of match data
 * @returns {Object} Usage stats per Amiko
 */
export function calculateAmikoStats(matches) {
  const stats = {};

  matches.forEach(match => {
    match.playerAmikos?.forEach(amikoName => {
      if (!stats[amikoName]) {
        stats[amikoName] = {
          name: amikoName,
          totalGames: 0,
          wins: 0,
          losses: 0,
          winRate: 0
        };
      }

      stats[amikoName].totalGames++;
      if (match.result === 'win') {
        stats[amikoName].wins++;
      } else {
        stats[amikoName].losses++;
      }
      stats[amikoName].winRate = Math.round(
        (stats[amikoName].wins / stats[amikoName].totalGames) * 100
      );
    });
  });

  // Sort by total games played
  return Object.values(stats).sort((a, b) => b.totalGames - a.totalGames);
}

/**
 * Calculate overall player stats from match history
 * @param {Array} matches - Array of match data
 * @returns {Object} Overall stats
 */
export function calculateOverallStats(matches) {
  if (!matches.length) {
    return {
      totalMatches: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      uniqueOpponents: 0,
      uniqueAmikos: 0,
      avgMatchDuration: 0
    };
  }

  const wins = matches.filter(m => m.result === 'win').length;
  const losses = matches.filter(m => m.result === 'loss').length;
  const uniqueOpponents = new Set(matches.map(m => m.opponent?.id)).size;
  const allAmikos = new Set(matches.flatMap(m => m.playerAmikos || []));
  const totalDuration = matches.reduce((sum, m) => sum + (m.duration || 0), 0);

  return {
    totalMatches: matches.length,
    wins,
    losses,
    winRate: Math.round((wins / matches.length) * 100),
    uniqueOpponents,
    uniqueAmikos: allAmikos.size,
    avgMatchDuration: Math.round(totalDuration / matches.length)
  };
}

/**
 * Syncs the Aurory name from the API to Firestore
 * @param {string} userId - Firebase User ID
 * @param {string} playerId - Aurory Player ID
 */
export async function syncAuroryName(userId, playerId) {
  try {
    const data = await validateAuroryAccount(playerId);
    if (data.valid && data.playerName) {
      const userRef = doc(db, 'users', userId);
      await updateDoc(userRef, {
        auroryPlayerName: data.playerName,
        auroryProfilePicture: data.profilePicture || null,
        isAurorian: data.isAurorian || false,
        auroryLastSync: serverTimestamp()
      });
      return {
        success: true,
        playerName: data.playerName,
        profilePicture: data.profilePicture,
        isAurorian: data.isAurorian
      };
    }
    return { success: false, error: 'Could not fetch current name from Aurory API' };
  } catch (error) {
    console.error('Error syncing Aurory name:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Verifies a tournament match result using the battle code
 * @param {string} battleCode - The private battle code used for the match
 * @param {string} playerAId - Expected Player A Aurory ID
 * @param {string} playerBId - Expected Player B Aurory ID
 * @param {Array} draftedA - Array of Amiko IDs drafted by Player A
 * @param {Array} draftedB - Array of Amiko IDs drafted by Player B
 * @returns {Promise<Object>} Verification result
 */
export async function verifyTournamentMatch(battleCode, playerAId, playerBId, draftedA, draftedB) {
  try {
    // Search for match by battle code using Player A as the anchor
    const data = await fetchPlayerMatches(playerAId, {
      event: 'PRIVATE_MATCH',
      battleCode: battleCode
    });

    if (data.error || !data.matches?.data || data.matches.data.length === 0) {
      return {
        verified: false,
        error: 'Match not found. Please ensure the battle code is correct and the match has finished.'
      };
    }

    // Find the specific match (even if fetch filtered it, we double check)
    const match = data.matches.data.find(m => m.data?.battle_code === battleCode);

    if (!match) {
      return { verified: false, error: 'Specific match code not found in player history.' };
    }

    // 1. Verify Participants
    const actualPlayer1Id = match.data?.players?.[0]?.playerId;
    const actualPlayer2Id = match.data?.players?.[1]?.playerId;

    const participants = [actualPlayer1Id, actualPlayer2Id];
    if (!participants.includes(playerAId) || !participants.includes(playerBId)) {
      return {
        verified: false,
        error: 'Participant mismatch. The players in this match do not match the drafted participants.'
      };
    }

    // 2. Verify Amiko Lineups (Order independent)
    const actualPlayerAData = match.data?.players?.find(p => p.playerId === playerAId);
    const actualPlayerBData = match.data?.players?.find(p => p.playerId === playerBId);

    const actualAMikos = actualPlayerAData?.nefties?.map(n => n.collection_id) || [];
    const actualBMikos = actualPlayerBData?.nefties?.map(n => n.collection_id) || [];

    const verifyLineup = (drafted, actual) => {
      if (!drafted || !actual) return false;
      if (drafted.length === 0) return true; // Skip if no draft data (e.g. error)

      const sortedDrafted = [...drafted].sort();
      const sortedActual = [...actual].sort();
      return sortedDrafted.every((val, index) => val === sortedActual[index]);
    };

    if (!verifyLineup(draftedA, actualAMikos)) {
      return { verified: false, error: 'Lineup mismatch. Player A used different Amikos than drafted.' };
    }
    if (!verifyLineup(draftedB, actualBMikos)) {
      return { verified: false, error: 'Lineup mismatch. Player B used different Amikos than drafted.' };
    }

    // 3. Determine Winner
    // result is relative to the anchor player (playerAId)
    let winner = null;
    if (match.result === 'win') {
      winner = 'A';
    } else if (match.result === 'loss') {
      winner = 'B';
    } else {
      return { verified: false, error: 'Could not determine match winner from API data.' };
    }

    return {
      verified: true,
      winner: winner,
      playerNameA: match.player?.player_name,
      playerNameB: match.opponent?.player_name
    };
  } catch (error) {
    console.error('Error verifying tournament match:', error);
    return { verified: false, error: error.message };
  }
}

// ============================================================================
// FIRESTORE INTEGRATION
// ============================================================================

/**
 * Link Aurory account to user profile in Firestore
 * @param {string} userId - Firebase user ID
 * @param {Object} auroryData - Aurory account data
 */
export async function linkAuroryAccount(userId, auroryData) {
  try {
    // 1. Check if this Aurory account is already linked to another user
    const usersRef = collection(db, 'users');
    const q = query(usersRef, where('auroryPlayerId', '==', auroryData.playerId));
    const querySnapshot = await getDocs(q);

    if (!querySnapshot.empty) {
      // Check if it's linked to A DIFFERENT user
      const duplicateUserDoc = querySnapshot.docs.find(doc => doc.id !== userId);
      if (duplicateUserDoc) {
        // FALLBACK: Allow linking if the emails match (same Discord identity)
        const duplicateUserData = duplicateUserDoc.data();
        const currentUserRef = doc(db, 'users', userId);
        const currentUserSnap = await getDoc(currentUserRef);
        const currentUserData = currentUserSnap.data();

        const currentEmail = currentUserData?.email;
        const existingEmail = duplicateUserData?.email;

        if (currentEmail && existingEmail && currentEmail === existingEmail) {
          // It's the same owner, we allow re-linking to this new user record
          // We can optionally unlink from the old record to keep it clean
          await updateDoc(duplicateUserDoc.ref, {
            auroryPlayerId: null,
            auroryPlayerName: null,
            auroryLastSync: null
          });
        } else {
          return {
            success: false,
            error: 'This Aurory account is already linked to another user. If you believe this is an error, please contact an admin.'
          };
        }
      }
    }

    // 2. Proceed with linking
    const userRef = doc(db, 'users', userId);
    await updateDoc(userRef, {
      auroryPlayerId: auroryData.playerId,
      auroryPlayerName: auroryData.playerName,
      auroryWallet: auroryData.wallet || null,
      auroryProfilePicture: auroryData.profilePicture || null,
      isAurorian: auroryData.isAurorian || false,
      auroryLinkedAt: serverTimestamp(),
      auroryLastSync: serverTimestamp()
    });

    return { success: true };
  } catch (error) {
    console.error('Error linking Aurory account:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Unlink Aurory account from user profile
 * @param {string} userId - Firebase user ID
 */
export async function unlinkAuroryAccount(userId) {
  try {
    const userRef = doc(db, 'users', userId);

    await updateDoc(userRef, {
      auroryPlayerId: null,
      auroryPlayerName: null,
      auroryWallet: null,
      auroryProfilePicture: null,
      auroryLinkedAt: null,
      auroryLastSync: null
    });

    return { success: true };
  } catch (error) {
    console.error('Error unlinking Aurory account:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get linked Aurory account data from Firestore
 * @param {string} userId - Firebase user ID
 * @returns {Promise<Object|null>} Aurory account data or null
 */
export async function getLinkedAuroryAccount(userId) {
  try {
    const userRef = doc(db, 'users', userId);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) return null;

    const data = userSnap.data();

    if (!data.auroryPlayerId) return null;

    return {
      playerId: data.auroryPlayerId,
      playerName: data.auroryPlayerName,
      wallet: data.auroryWallet,
      profilePicture: data.auroryProfilePicture,
      linkedAt: data.auroryLinkedAt?.toDate?.() || data.auroryLinkedAt,
      lastSync: data.auroryLastSync?.toDate?.() || data.auroryLastSync
    };
  } catch (error) {
    console.error('Error getting linked Aurory account:', error);
    return null;
  }
}

/**
 * Update last sync timestamp
 * @param {string} userId - Firebase user ID
 */
export async function updateSyncTimestamp(userId) {
  try {
    const userRef = doc(db, 'users', userId);
    await updateDoc(userRef, {
      auroryLastSync: serverTimestamp()
    });
  } catch (error) {
    console.error('Error updating sync timestamp:', error);
  }
}

// ============================================================================
// CACHE MANAGEMENT
// ============================================================================

const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
const matchCache = new Map();

/**
 * Get cached or fresh match history
 * @param {string} playerIdOrWallet - Player ID or wallet
 * @param {boolean} forceRefresh - Force API call
 * @returns {Promise<Array>} Match history
 */
export async function getCachedMatchHistory(playerIdOrWallet, forceRefresh = false, onProgress = null) {
  const cacheKey = playerIdOrWallet;
  const cached = matchCache.get(cacheKey);

  if (!forceRefresh && cached && (Date.now() - cached.timestamp < CACHE_DURATION)) {
    return cached.data;
  }

  const matches = await getPrivateMatchHistory(playerIdOrWallet, 50, onProgress);
  matchCache.set(cacheKey, { data: matches, timestamp: Date.now() });

  return matches;
}

/**
 * Clear cache for a player
 * @param {string} playerIdOrWallet - Player ID or wallet
 */
export function clearCache(playerIdOrWallet) {
  matchCache.delete(playerIdOrWallet);
}

const auroryProfileService = {
  fetchPlayerProfile,
  fetchPlayerMatches,
  validateAuroryAccount,
  getPrivateMatchHistory,
  calculateAmikoStats,
  calculateOverallStats,
  linkAuroryAccount,
  unlinkAuroryAccount,
  getLinkedAuroryAccount,
  getCachedMatchHistory,
  clearCache
};

export default auroryProfileService;
