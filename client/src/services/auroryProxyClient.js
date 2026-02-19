const PROXY_URL = process.env.REACT_APP_AURORY_PROXY_URL
  || 'https://us-central1-YOUR_PROJECT_ID.cloudfunctions.net/auroryProxy';

/**
 * Fetch from Aurory API through the Cloud Function proxy.
 * Works from any domain — no CORS restrictions.
 *
 * @param {string} endpoint - API endpoint (e.g., '/v1/matches', '/v2/players')
 * @param {string} params - URL query params (e.g., 'battle_code=12345')
 * @param {string} env - 'live' (default) or 'dev'
 * @returns {Promise<any>} Parsed JSON response
 */
export async function auroryFetch(endpoint, params = '', env = 'live') {
  const url = new URL(PROXY_URL);
  url.searchParams.set('endpoint', endpoint);
  if (params) url.searchParams.set('params', params);
  if (env !== 'live') url.searchParams.set('env', env);

  const response = await fetch(url.toString(), {
    headers: { 'accept': 'application/json' }
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Proxy error: ${response.status}`);
  }

  return response.json();
}

/**
 * Convenience: Fetch player profile
 * Replaces: fetchPlayerProfile() in auroryProfileService.js
 */
export async function fetchPlayerProfile(playerId) {
  const params = `player_ids=${encodeURIComponent(playerId)}`;
  const result = await auroryFetch('/v2/players', params);

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
}

/**
 * Convenience: Fetch player matches
 * Replaces: fetchPlayerMatches() in auroryProfileService.js
 */
export async function fetchPlayerMatches(playerIdOrWallet, options = {}) {
  const params = new URLSearchParams({
    player_id_or_name: playerIdOrWallet,
    game_mode: options.gameMode || 'pvp'
  });

  if (options.event) params.append('event', options.event);
  if (options.battleCode) params.append('battle_code', options.battleCode);
  if (options.page > 0) params.append('page', options.page.toString());

  return auroryFetch('/v1/player-matches', params.toString());
}

/**
 * Convenience: Fetch matches by battle code
 * Replaces: fetchMatchByBattleCode() in matchVerificationService.js
 */
export async function fetchMatchByBattleCode(battleCode) {
  const params = `battle_code=${encodeURIComponent(battleCode)}`;

  try {
    const result = await auroryFetch('/v1/matches', params);
    return { matches: result.data || [], error: null };
  } catch (error) {
    return { error: error.message, matches: [] };
  }
}

/**
 * Convenience: Fetch egg hatches
 * Replaces: fetchEggHatches() in auroryProfileService.js
 */
export async function fetchEggHatches(playerId, page = 0) {
  const params = new URLSearchParams({ player_id: playerId });
  if (page > 0) params.append('page', page.toString());

  try {
    return await auroryFetch('/v1/egg-hatches', params.toString());
  } catch (error) {
    return { data: [], total: 0, error: error.message };
  }
}

/**
 * Convenience: Fetch all nefties/amikos
 * Replaces: auroryAPI.js getAllAmikos()
 */
export async function fetchAllNefties(env = 'dev') {
  return auroryFetch('/v1/nefties/index', '', env);
}

const auroryProxyClient = {
  auroryFetch,
  fetchPlayerProfile,
  fetchPlayerMatches,
  fetchMatchByBattleCode,
  fetchEggHatches,
  fetchAllNefties
};

export default auroryProxyClient;
