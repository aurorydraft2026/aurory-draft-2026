/**
 * auroryProxy.ts
 * HTTP Cloud Function that proxies requests to the Aurory Aggregator API.
 * Eliminates CORS issues since server-to-server requests have no CORS restrictions.
 *
 * Usage from client:
 *   GET https://<region>-<project>.cloudfunctions.net/auroryProxy
 *       ?endpoint=/v1/matches
 *       &params=battle_code=12345
 *       &env=live
 *
 * Supports all the endpoints used by the app:
 *   - /v1/nefties/index          (amikos data)
 *   - /v1/matches                (match verification by battle code)
 *   - /v1/player-matches         (player match history)
 *   - /v1/egg-hatches            (egg hatch history)
 *   - /v2/players                (player profiles)
 */



const AURORY_LIVE = 'https://aggregator-api.live.aurory.io';
const AURORY_DEV = 'https://aggregator-api.dev.aurory.io';

// Whitelist of allowed API endpoints (prevents abuse)
const ALLOWED_ENDPOINTS = [
  '/v1/nefties/index',
  '/v1/matches',
  '/v1/player-matches',
  '/v1/egg-hatches',
  '/v2/players'
];

/**
 * Handle the proxy request
 */
export async function handleAuroryProxy(req: any, res: any): Promise<void> {
  // CORS headers (allow your domain + localhost for dev)
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Only GET requests are supported' });
    return;
  }

  const endpoint = req.query.endpoint as string;
  const params = req.query.params as string || '';
  const env = req.query.env as string || 'live';

  if (!endpoint) {
    res.status(400).json({ error: 'Missing "endpoint" query parameter' });
    return;
  }

  // Validate endpoint is allowed
  const isAllowed = ALLOWED_ENDPOINTS.some(allowed => endpoint.startsWith(allowed));
  if (!isAllowed) {
    res.status(403).json({
      error: 'Endpoint not allowed',
      allowed: ALLOWED_ENDPOINTS
    });
    return;
  }

  const baseURL = env === 'dev' ? AURORY_DEV : AURORY_LIVE;
  const url = `${baseURL}${endpoint}${params ? '?' + params : ''}`;

  try {
    console.log(`🔄 Proxying: ${endpoint}${params ? '?' + params : ''} (${env})`);

    const response = await fetch(url, {
      headers: { 'accept': 'application/json' }
    });

    const data = await response.json();

    // Cache headers based on endpoint
    if (endpoint === '/v1/nefties/index') {
      // Nefties data changes rarely — cache 1 hour
      res.set('Cache-Control', 'public, max-age=3600');
    } else if (endpoint.startsWith('/v2/players')) {
      // Player profiles — cache 5 minutes
      res.set('Cache-Control', 'public, max-age=300');
    } else {
      // Matches/dynamic data — cache 30 seconds
      res.set('Cache-Control', 'public, max-age=30');
    }

    res.status(response.status).json(data);
  } catch (error: any) {
    console.error(`❌ Proxy error for ${endpoint}:`, error.message);
    res.status(502).json({
      error: 'Failed to reach Aurory API',
      details: error.message
    });
  }
}
