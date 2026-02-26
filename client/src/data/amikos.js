// List of all available Amikos - Enriched with Aurory API data

// ========================================
// ELEMENT CONFIGURATION
// ========================================
export const ELEMENTS = {
  Fire: {
    color: '#ef4444',
    bgColor: 'rgba(239, 68, 68, 0.2)',
    icon: '🔥',
    gradient: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)'
  },
  Water: {
    color: '#3b82f6',
    bgColor: 'rgba(59, 130, 246, 0.2)',
    icon: '💧',
    gradient: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)'
  },
  Plant: {
    color: '#22c55e',
    bgColor: 'rgba(34, 197, 94, 0.2)',
    icon: '🌿',
    gradient: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)'
  },
  Thunder: {
    color: '#eab308',
    bgColor: 'rgba(234, 179, 8, 0.2)',
    icon: '⚡',
    gradient: 'linear-gradient(135deg, #eab308 0%, #ca8a04 100%)'
  },
  Wind: {
    color: '#a855f7',
    bgColor: 'rgba(168, 85, 247, 0.2)',
    icon: '🌀',
    gradient: 'linear-gradient(135deg, #a855f7 0%, #9333ea 100%)'
  },
  Ground: {
    color: '#f97316',
    bgColor: 'rgba(249, 115, 22, 0.2)',
    icon: '🪨',
    gradient: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)'
  }
};

// ========================================
// SEEKER RANK CONFIGURATION
// ========================================
export const SEEKER_RANKS = {
  SeekTier_1: { label: 'Tier 1', stars: 1, color: '#9ca3af' },
  SeekTier_2: { label: 'Tier 2', stars: 2, color: '#60a5fa' },
  SeekTier_3: { label: 'Tier 3', stars: 3, color: '#a78bfa' },
  SeekTier_4: { label: 'Tier 4', stars: 4, color: '#f472b6' },
  SeekTier_5: { label: 'Tier 5', stars: 5, color: '#fbbf24' }
};

// ========================================
// LOCATION CONFIGURATION
// ========================================
export const LOCATIONS = {
  meadows: { label: 'Meadows', icon: '🌸', color: '#86efac' },
  swamp: { label: 'Swamp', icon: '🐊', color: '#5eead4' },
  desert: { label: 'Desert', icon: '🏜️', color: '#fcd34d' },
  arctik: { label: 'Arctik', icon: '❄️', color: '#93c5fd' }
};

// ========================================
// AMIKOS DATA (Enriched from Aurory API)
// ========================================
export const AMIKOS = [
  {
    id: 'axobubble',
    name: 'Axobubble',
    image: '/amikos/axobubble.png',
    apiId: 'id_Axobubble_Basic',
    index: 9,
    element: 'Water',
    seekerRank: 'SeekTier_2',
    location: 'swamp',
    locationStage: 4,
    minHeight: 19.6,
    maxHeight: 23.1,
    minWeight: 90.1,
    maxWeight: 98
  },
  {
    id: 'beeblock',
    name: 'Beeblock',
    image: '/amikos/beeblock.png',
    apiId: 'id_Beeblock_Basic',
    index: 19,
    element: 'Plant',
    seekerRank: 'SeekTier_2',
    location: 'meadows',
    locationStage: 3,
    minHeight: 29.7,
    maxHeight: 31.4,
    minWeight: 35,
    maxWeight: 41.7
  },
  {
    id: 'bitebit',
    name: 'Bitebit',
    image: '/amikos/bitebit.png',
    apiId: 'id_Bitebit_Basic',
    index: 2,
    element: 'Thunder',
    seekerRank: 'SeekTier_1',
    location: 'swamp',
    locationStage: 1,
    minHeight: 28.4,
    maxHeight: 29.9,
    minWeight: 47.5,
    maxWeight: 50.9
  },
  {
    id: 'block-choy',
    name: 'Block Choy',
    image: '/amikos/block-choy.png',
    apiId: 'id_Block Choy_Basic',
    index: 7,
    element: 'Plant',
    seekerRank: 'SeekTier_1',
    location: 'meadows',
    locationStage: 1,
    minHeight: 18.9,
    maxHeight: 20.7,
    minWeight: 19.8,
    maxWeight: 21.4
  },
  {
    id: 'bloomtail',
    name: 'Bloomtail',
    image: '/amikos/bloomtail.png',
    apiId: 'id_Bloomtail_Basic',
    index: 20,
    element: 'Plant',
    seekerRank: 'SeekTier_3',
    location: 'meadows',
    locationStage: 1,
    minHeight: 25.5,
    maxHeight: 26.1,
    minWeight: 48.5,
    maxWeight: 50.1
  },
  {
    id: 'bubble-popper',
    name: 'Bubble Popper',
    image: '/amikos/bubble-popper.png',
    apiId: 'id_Bubble Popper_Basic',
    index: 26,
    element: 'Water',
    seekerRank: 'SeekTier_1',
    location: 'meadows',
    locationStage: 1,
    minHeight: null,
    maxHeight: null,
    minWeight: null,
    maxWeight: null
  },
  {
    id: 'chocomint',
    name: 'Chocomint',
    image: '/amikos/chocomint.png',
    apiId: 'id_Chocomint_Basic',
    index: 11,
    element: 'Plant',
    seekerRank: 'SeekTier_2',
    location: 'arctik',
    locationStage: 1,
    minHeight: 21.6,
    maxHeight: 22.1,
    minWeight: 22,
    maxWeight: 22.8
  },
  {
    id: 'chocorex',
    name: 'Chocorex',
    image: '/amikos/chocorex.png',
    apiId: 'id_Chocorex_Basic',
    index: 18,
    element: 'Water',
    seekerRank: 'SeekTier_1',
    location: 'meadows',
    locationStage: 4,
    minHeight: 39.7,
    maxHeight: 43.6,
    minWeight: 198.1,
    maxWeight: 203.6
  },
  {
    id: 'clicktin',
    name: 'Clicktin',
    image: '/amikos/clicktin.png',
    apiId: 'id_Clicktin_Basic',
    index: 29,
    element: 'Thunder',
    seekerRank: 'SeekTier_3',
    location: 'swamp',
    locationStage: 3,
    minHeight: null,
    maxHeight: null,
    minWeight: null,
    maxWeight: null
  },
  {
    id: 'cybertooth',
    name: 'Cybertooth',
    image: '/amikos/cybertooth.png',
    apiId: 'id_Cybertooth_Basic',
    index: 12,
    element: 'Wind',
    seekerRank: 'SeekTier_3',
    location: 'arctik',
    locationStage: 1,
    minHeight: 38.1,
    maxHeight: 39.7,
    minWeight: 312,
    maxWeight: 324.5
  },
  {
    id: 'dinobit',
    name: 'Dinobit',
    image: '/amikos/dinobit.png',
    apiId: 'id_Dinobit_Basic',
    index: 5,
    element: 'Ground',
    seekerRank: 'SeekTier_2',
    location: 'desert',
    locationStage: 1,
    minHeight: 39,
    maxHeight: 40.1,
    minWeight: 248,
    maxWeight: 255
  },
  {
    id: 'dinotusk',
    name: 'Dinotusk',
    image: '/amikos/dinotusk.png',
    apiId: 'id_Dinotusk_Basic',
    index: 23,
    element: 'Thunder',
    seekerRank: 'SeekTier_2',
    location: 'arctik',
    locationStage: 3,
    minHeight: 38.4,
    maxHeight: 39,
    minWeight: 276,
    maxWeight: 286
  },
  {
    id: 'dipking',
    name: 'Dipking',
    image: '/amikos/dipking.png',
    apiId: 'id_Dipking_Basic',
    index: 3,
    element: 'Water',
    seekerRank: 'SeekTier_1',
    location: 'swamp',
    locationStage: 5,
    minHeight: 19.4,
    maxHeight: 20.1,
    minWeight: 55,
    maxWeight: 59
  },
  {
    id: 'dodorex',
    name: 'Dodorex',
    image: '/amikos/dodorex.png',
    apiId: 'id_Dodorex_Basic',
    index: 38,
    element: 'Ground',
    seekerRank: 'SeekTier_5',
    location: null,
    locationStage: null,
    minHeight: null,
    maxHeight: null,
    minWeight: null,
    maxWeight: null,
    isEvent: true
  },
  {
    id: 'dracurve',
    name: 'Dracurve',
    image: '/amikos/dracurve.png',
    apiId: 'id_Dracurve_Basic',
    index: 40,
    element: 'Thunder',
    seekerRank: 'SeekTier_2',
    location: null, // Event Amiko - no location
    locationStage: null,
    minHeight: 66.1,
    maxHeight: 68.9,
    minWeight: 445,
    maxWeight: 463,
    isEvent: true
  },
  {
    id: 'ghouliath',
    name: 'Ghouliath',
    image: '/amikos/ghouliath.png',
    apiId: 'id_Ghouliath_Basic',
    index: 22,
    element: 'Fire',
    seekerRank: 'SeekTier_2',
    location: 'desert',
    locationStage: 1,
    minHeight: 66.1,
    maxHeight: 68.9,
    minWeight: 248,
    maxWeight: 271
  },
  {
    id: 'hollowoo',
    name: 'Hollowoo',
    image: '/amikos/hollowoo.png',
    apiId: 'id_Hollowoo_Event',
    index: 44,
    element: 'Plant',
    seekerRank: 'SeekTier_5',
    location: null, // Event Amiko
    locationStage: null,
    minHeight: 20.1,
    maxHeight: 21.8,
    minWeight: 12,
    maxWeight: 15.5,
    isEvent: true
  },
  {
    id: 'keybab',
    name: 'Keybab',
    image: '/amikos/keybab.png',
    apiId: 'id_Keybab_Basic',
    index: 17,
    element: 'Fire',
    seekerRank: 'SeekTier_2',
    location: 'desert',
    locationStage: 1,
    minHeight: 21.8,
    maxHeight: 22.3,
    minWeight: 31,
    maxWeight: 36.2
  },
  {
    id: 'logator',
    name: 'Logator',
    image: '/amikos/logator.png',
    apiId: 'id_Logator_Basic',
    index: 28,
    element: 'Plant',
    seekerRank: 'SeekTier_1',
    location: 'swamp',
    locationStage: 1,
    minHeight: null,
    maxHeight: null,
    minWeight: null,
    maxWeight: null
  },
  {
    id: 'lucky',
    name: 'Lucky',
    image: '/amikos/lucky.png',
    apiId: 'id_Lucky_Basic',
    index: 31,
    element: 'Wind',
    seekerRank: 'SeekTier_2',
    location: 'desert',
    locationStage: 1,
    minHeight: null,
    maxHeight: null,
    minWeight: null,
    maxWeight: null
  },
  {
    id: 'number-9',
    name: 'Number 9',
    image: '/amikos/number-9.png',
    apiId: 'id_Number 9_Basic',
    index: 10,
    element: 'Fire',
    seekerRank: 'SeekTier_2',
    location: 'swamp',
    locationStage: 1,
    minHeight: 21,
    maxHeight: 21.2,
    minWeight: 0.04,
    maxWeight: 0.04
  },
  {
    id: 'oogrock',
    name: 'Oogrock',
    image: '/amikos/oogrock.png',
    apiId: 'id_Oogrock_Basic',
    index: 25,
    element: 'Ground',
    seekerRank: 'SeekTier_1',
    location: 'arctik',
    locationStage: 5,
    minHeight: 22.9,
    maxHeight: 24.7,
    minWeight: 100,
    maxWeight: 107.7
  },
  {
    id: 'pandata',
    name: 'Pandata',
    image: '/amikos/pandata.png',
    apiId: 'id_Pandata_Basic',
    index: 30,
    element: 'Ground',
    seekerRank: 'SeekTier_3',
    location: 'desert',
    locationStage: 1,
    minHeight: null,
    maxHeight: null,
    minWeight: null,
    maxWeight: null
  },
  {
    id: 'raccoin',
    name: 'Raccoin',
    image: '/amikos/raccoin.png',
    apiId: 'id_Raccoin_Basic',
    index: 15,
    element: 'Wind',
    seekerRank: 'SeekTier_1',
    location: 'arctik',
    locationStage: 1,
    minHeight: 28,
    maxHeight: 30.4,
    minWeight: 60.1,
    maxWeight: 66.6
  },
  {
    id: 'shiba-ignite',
    name: 'Shiba Ignite',
    image: '/amikos/shiba-ignite.png',
    apiId: 'id_Shiba Ignite_Basic',
    index: 4,
    element: 'Fire',
    seekerRank: 'SeekTier_1',
    location: 'meadows',
    locationStage: 2,
    minHeight: 27.5,
    maxHeight: 30.2,
    minWeight: 90,
    maxWeight: 100.2
  },
  {
    id: 'shibark',
    name: 'Shibark',
    image: '/amikos/shibark.png',
    apiId: 'id_Shibark_Basic',
    index: 14,
    element: 'Ground',
    seekerRank: 'SeekTier_1',
    location: 'desert',
    locationStage: 1,
    minHeight: 26.8,
    maxHeight: 29.8,
    minWeight: 86.2,
    maxWeight: 95.7
  },
  {
    id: 'tokoma',
    name: 'Tokoma',
    image: '/amikos/tokoma.png',
    apiId: 'id_Tokoma_Basic',
    index: 24,
    element: 'Wind',
    seekerRank: 'SeekTier_2',
    location: 'arctik',
    locationStage: 4,
    minHeight: 27.6,
    maxHeight: 30.3,
    minWeight: 80.4,
    maxWeight: 92.1
  },
  {
    id: 'unika',
    name: 'Unika',
    image: '/amikos/unika.png',
    apiId: 'id_Unika_Basic',
    index: 8,
    element: 'Ground',
    seekerRank: 'SeekTier_2',
    location: 'meadows',
    locationStage: 1,
    minHeight: 38.7,
    maxHeight: 40.6,
    minWeight: 101,
    maxWeight: 117.4
  },
  {
    id: 'unikirin',
    name: 'Unikirin',
    image: '/amikos/unikirin.png',
    apiId: 'id_Unikirin_Basic',
    index: 16,
    element: 'Thunder',
    seekerRank: 'SeekTier_1',
    location: 'desert',
    locationStage: 1,
    minHeight: 38.7,
    maxHeight: 40.6,
    minWeight: 95.4,
    maxWeight: 108.2
  },
  {
    id: 'walpuff',
    name: 'Walpuff',
    image: '/amikos/walpuff.png',
    apiId: 'id_Walpuff_Basic',
    index: 21,
    element: 'Water',
    seekerRank: 'SeekTier_2',
    location: 'arctik',
    locationStage: 2,
    minHeight: 26.4,
    maxHeight: 28.7,
    minWeight: 73.6,
    maxWeight: 88
  },
  {
    id: 'wassie',
    name: 'Wassie',
    image: '/amikos/wassie.png',
    apiId: 'id_Wassie_Basic',
    index: 13,
    element: 'Thunder',
    seekerRank: 'SeekTier_2',
    location: 'swamp',
    locationStage: 2,
    minHeight: 25.7,
    maxHeight: 26.1,
    minWeight: 66.6,
    maxWeight: 69.9
  },
  {
    id: 'znix',
    name: 'Znix',
    image: '/amikos/znix.png',
    apiId: 'id_Znix_Basic',
    index: 34,
    element: 'Fire',
    seekerRank: 'SeekTier_1',
    location: 'desert',
    locationStage: 1,
    minHeight: null,
    maxHeight: null,
    minWeight: null,
    maxWeight: null
  },
  {
    id: 'zzoo',
    name: 'Zzoo',
    image: '/amikos/zzoo.png',
    apiId: 'id_Zzoo_Basic',
    index: 6,
    element: 'Wind',
    seekerRank: 'SeekTier_2',
    location: 'meadows',
    locationStage: 5,
    minHeight: 20,
    maxHeight: 21.6,
    minWeight: 8.9,
    maxWeight: 12.4
  }
];

// ========================================
// HELPER FUNCTIONS
// ========================================

/**
 * Get Amiko by ID
 */
export const getAmikoById = (id) => {
  return AMIKOS.find(a => a.id === id);
};

/**
 * Get Amiko by name (case-insensitive)
 * Useful for matching Aurory API responses which use collection_id names
 */
export const getAmikoByName = (name) => {
  if (!name) return null;
  const normalized = name.toLowerCase().trim();
  return AMIKOS.find(a => a.name.toLowerCase() === normalized);
};

/**
 * Get element config for an Amiko
 */
export const getAmikoElement = (amikoOrId) => {
  const amiko = typeof amikoOrId === 'string' ? getAmikoById(amikoOrId) : amikoOrId;
  if (!amiko?.element) return null;
  return ELEMENTS[amiko.element];
};

/**
 * Get seeker rank config for an Amiko
 */
export const getAmikoRank = (amikoOrId) => {
  const amiko = typeof amikoOrId === 'string' ? getAmikoById(amikoOrId) : amikoOrId;
  if (!amiko?.seekerRank) return null;
  return SEEKER_RANKS[amiko.seekerRank];
};

/**
 * Get location config for an Amiko
 */
export const getAmikoLocation = (amikoOrId) => {
  const amiko = typeof amikoOrId === 'string' ? getAmikoById(amikoOrId) : amikoOrId;
  if (!amiko?.location) return null;
  return LOCATIONS[amiko.location];
};

/**
 * Filter Amikos by element
 */
export const getAmikosByElement = (element) => {
  return AMIKOS.filter(a => a.element === element);
};

/**
 * Filter Amikos by location
 */
export const getAmikosByLocation = (location) => {
  return AMIKOS.filter(a => a.location === location);
};

/**
 * Filter Amikos by seeker rank
 */
export const getAmikosByRank = (rank) => {
  return AMIKOS.filter(a => a.seekerRank === rank);
};

/**
 * Get Amikos sorted by index (Aurory API order)
 */
export const getAmikosSortedByIndex = () => {
  return [...AMIKOS].sort((a, b) => a.index - b.index);
};

/**
 * Map Aurory API name (collection_id) to local Amiko ID
 * Handles case differences and spacing
 */
export const mapAuroryNameToId = (auroryName) => {
  if (!auroryName) return null;

  // Direct name match first
  const byName = getAmikoByName(auroryName);
  if (byName) return byName.id;

  // Try converting to our ID format (lowercase, spaces to hyphens)
  const normalized = auroryName.toLowerCase().replace(/\s+/g, '-');
  const byId = getAmikoById(normalized);
  if (byId) return byId.id;

  return null;
};

/**
 * Map local Amiko ID to Aurory API name
 */
export const mapIdToAuroryName = (id) => {
  const amiko = getAmikoById(id);
  return amiko?.name || null;
};

// ========================================
// DRAFT MODE PICK ORDERS
// ========================================

// Mode 1 - Triad Swiss Draft 1 Pick Order
export const PICK_ORDER_MODE_1 = [
  { team: 'A', count: 3, label: 'Phase 1: Team A - Player 1 (3 picks)' },
  { team: 'B', count: 6, label: 'Phase 2: Team B - Players 1 & 2 (6 picks)' },
  { team: 'A', count: 6, label: 'Phase 3: Team A - Players 2 & 3 (6 picks)' },
  { team: 'B', count: 3, label: 'Phase 4: Team B - Player 3 (3 picks)' }
];

// Mode 2 - Triad Swiss Draft 2 Pick Order
export const PICK_ORDER_MODE_2 = [
  { team: 'A', count: 1, label: 'Phase 1: Team A - Player 1 (1 pick)' },
  { team: 'B', count: 2, label: 'Phase 2: Team B - Player 1 (2 picks)' },
  { team: 'A', count: 2, label: 'Phase 3: Team A - Player 1 (2 picks)' },
  { team: 'B', count: 2, label: 'Phase 4: Team B - Player 1 + Player 2 (2 picks)' },
  { team: 'A', count: 2, label: 'Phase 5: Team A - Player 2 (2 picks)' },
  { team: 'B', count: 2, label: 'Phase 6: Team B - Player 2 (2 picks)' },
  { team: 'A', count: 2, label: 'Phase 7: Team A - Player 2 + Player 3 (2 picks)' },
  { team: 'B', count: 2, label: 'Phase 8: Team B - Player 3 (2 picks)' },
  { team: 'A', count: 2, label: 'Phase 9: Team A - Player 3 (2 picks)' },
  { team: 'B', count: 1, label: 'Phase 10: Team B - Player 3 (1 pick)' }
];

// Mode 3 - 1v1 Single Draft (Simultaneous picking)
export const PICK_ORDER_MODE_3 = [
  {
    team: 'AB',
    count: 3,
    label: '1v1 Draft: Pick 3 Amikos',
    simultaneous: true,
    picksPerPlayer: 3
  }
];

// Mode 4 - 1v1 Ban Draft (Turn-based ban + pick phases)
export const PICK_ORDER_MODE_4 = [
  // Ban phases (0-3): A bans 1, B bans 2, A bans 2, B bans 1
  { team: 'A', count: 1, label: 'Ban Phase 1: Player 1 — Ban 1 Amiko', isBan: true },
  { team: 'B', count: 2, label: 'Ban Phase 2: Player 2 — Ban 2 Amikos', isBan: true },
  { team: 'A', count: 2, label: 'Ban Phase 3: Player 1 — Ban 2 Amikos', isBan: true },
  { team: 'B', count: 1, label: 'Ban Phase 4: Player 2 — Ban 1 Amiko', isBan: true },
  // Pick phases (4-7): B picks 1, A picks 2, B picks 2, A picks 1
  { team: 'B', count: 1, label: 'Pick Phase 1: Player 2 — Pick 1 Amiko' },
  { team: 'A', count: 2, label: 'Pick Phase 2: Player 1 — Pick 2 Amikos' },
  { team: 'B', count: 2, label: 'Pick Phase 3: Player 2 — Pick 2 Amikos' },
  { team: 'A', count: 1, label: 'Pick Phase 4: Player 1 — Pick 1 Amiko' }
];

/**
 * Get pick order for draft type
 */
export const getPICK_ORDER = (draftType) => {
  if (draftType === 'mode4') return PICK_ORDER_MODE_4;
  if (draftType === 'mode3') return PICK_ORDER_MODE_3;
  if (draftType === 'mode2') return PICK_ORDER_MODE_2;
  return PICK_ORDER_MODE_1;
};

// Default export for backward compatibility
export const PICK_ORDER = PICK_ORDER_MODE_1;

// Timer configuration (30 seconds in milliseconds)
export const TIMER_DURATION = 30 * 1000;