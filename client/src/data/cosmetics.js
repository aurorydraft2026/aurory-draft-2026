/**
 * ============================================================
 * ASGARD COSMETICS CATALOG
 * Norse-themed aura effects for profile pictures
 * ============================================================
 * 
 * Pricing:
 *   Common   = 3,000 VC
 *   Rare     = 8,000 VC
 *   Epic     = 18,000 VC
 *   Legendary = 35,000 VC
 *   Mythic   = 50,000 VC
 */

export const RARITY_CONFIG = {
  common:    { label: 'Common',    color: '#8b9db6', glow: 'rgba(139,157,182,0.3)', order: 1 },
  uncommon:  { label: 'Uncommon',  color: '#4ade80', glow: 'rgba(74,222,128,0.3)',  order: 1.5 },
  rare:      { label: 'Rare',      color: '#4d9dff', glow: 'rgba(77,157,255,0.3)',  order: 2 },
  epic:      { label: 'Epic',      color: '#a855f7', glow: 'rgba(168,85,247,0.3)',  order: 3 },
  legendary: { label: 'Legendary', color: '#f59e0b', glow: 'rgba(245,158,11,0.3)',  order: 4 },
  mythic:    { label: 'Mythic',    color: '#ef4444', glow: 'rgba(239,68,68,0.3)',   order: 5 },
};

export const COSMETICS = [
  // ─── COMMON (3,000 VC) ───
  {
    id: 'aura_frost_breath',
    name: 'Frost Breath',
    type: 'aura',
    description: 'A subtle icy mist drifts around your portrait, cold as Niflheim.',
    rarity: 'common',
    price: 3000,
    cssClass: 'aura-frost-breath',
  },
  {
    id: 'aura_ember_glow',
    name: 'Ember Glow',
    type: 'aura',
    description: 'Warm embers flicker softly at the edges of your avatar.',
    rarity: 'common',
    price: 3000,
    cssClass: 'aura-ember-glow',
  },
  {
    id: 'aura_forest_whisper',
    name: 'Forest Whisper',
    type: 'aura',
    description: 'Leaves of Yggdrasil gently float around your image.',
    rarity: 'common',
    price: 3000,
    cssClass: 'aura-forest-whisper',
  },

  // ─── RARE (8,000 VC) ───
  {
    id: 'aura_raven_shadow',
    name: "Odin's Ravens",
    type: 'aura',
    description: 'Huginn and Muninn circle your portrait in shadowy wisps.',
    rarity: 'rare',
    price: 8000,
    cssClass: 'aura-raven-shadow',
  },
  {
    id: 'aura_ocean_tide',
    name: 'Njord\'s Tide',
    type: 'aura',
    description: 'Ocean waves pulse rhythmically around your avatar.',
    rarity: 'rare',
    price: 8000,
    cssClass: 'aura-ocean-tide',
  },
  {
    id: 'aura_runic_circle',
    name: 'Runic Circle',
    type: 'aura',
    description: 'Ancient runes orbit your portrait in a mystical ring.',
    rarity: 'rare',
    price: 8000,
    cssClass: 'aura-runic-circle',
  },

  // ─── EPIC (18,000 VC) ───
  {
    id: 'aura_thunder_strike',
    name: "Thor's Lightning",
    type: 'aura',
    description: 'Crackling electricity arcs violently around your portrait.',
    rarity: 'epic',
    price: 18000,
    cssClass: 'aura-thunder-strike',
  },
  {
    id: 'aura_aurora_borealis',
    name: 'Aurora Borealis',
    type: 'aura',
    description: 'The northern lights shimmer in flowing ribbons of color.',
    rarity: 'epic',
    price: 18000,
    cssClass: 'aura-aurora-borealis',
  },
  {
    id: 'aura_void_walker',
    name: 'Void Walker',
    type: 'aura',
    description: 'A dark void ripples outward from your presence.',
    rarity: 'epic',
    price: 18000,
    cssClass: 'aura-void-walker',
  },

  // ─── LEGENDARY (35,000 VC) ───
  {
    id: 'aura_bifrost_bridge',
    name: 'Bifröst Radiance',
    type: 'aura',
    description: 'The Rainbow Bridge crystallizes in prismatic light around you.',
    rarity: 'legendary',
    price: 35000,
    cssClass: 'aura-bifrost-bridge',
  },
  {
    id: 'aura_mjolnir_might',
    name: "Mjölnir's Might",
    type: 'aura',
    description: 'An explosive golden hammer shockwave pulses from your portrait.',
    rarity: 'legendary',
    price: 35000,
    cssClass: 'aura-mjolnir-might',
  },

  // ─── MYTHIC (50,000 VC) ───
  {
    id: 'aura_ragnarok_flame',
    name: 'Ragnarök Flame',
    type: 'aura',
    description: 'The fires of the end times consume all around your avatar. Only the worthy survive.',
    rarity: 'mythic',
    price: 50000,
    cssClass: 'aura-ragnarok-flame',
  },
  {
    id: 'aura_allfather_eye',
    name: "The Allfather's Eye",
    type: 'aura',
    description: "Odin's all-seeing eye weaves golden threads of fate around your portrait.",
    rarity: 'mythic',
    price: 50000,
    cssClass: 'aura-allfather-eye',
  },

  // ─── BANNERS (5,000 - 45,000 VC) ───
  {
    id: 'banner_valhalla_dawn',
    name: 'Valhalla Dawn',
    type: 'banner',
    description: 'A golden morning light breaking over the halls of the fallen.',
    rarity: 'mythic',
    price: 45000,
    style: {
      background: 'linear-gradient(to bottom, #7c2d12, #fbcd02)',
      backgroundImage: 'url("https://www.transparenttextures.com/patterns/cubes.png")'
    }
  },
  {
    id: 'banner_yggdrasil_roots',
    name: 'Roots of Yggdrasil',
    type: 'banner',
    description: 'Ancient, gnarled roots that hold the nine realms together.',
    rarity: 'epic',
    price: 15000,
    style: {
      background: 'linear-gradient(to bottom, #14532d, #064e3b)',
      backgroundImage: 'url("https://www.transparenttextures.com/patterns/wood-pattern.png")'
    }
  },
  {
    id: 'banner_marianas_blue',
    name: "Njord's Depths",
    type: 'banner',
    description: 'The deep, dark blue of the northern seas.',
    rarity: 'rare',
    price: 8000,
    style: {
      background: 'linear-gradient(to bottom, #1e3a8a, #1e40af)',
      backgroundImage: 'url("https://www.transparenttextures.com/patterns/carbon-fibre.png")'
    }
  },
  {
    id: 'banner_viking_iron',
    name: 'Viking Iron',
    type: 'banner',
    description: 'Cold, harded steel from the forges of the dwarves.',
    rarity: 'common',
    price: 3000,
    style: {
      background: '#334155',
      backgroundImage: 'url("https://www.transparenttextures.com/patterns/brushed-alum.png")'
    }
  },
];

/**
 * Get a cosmetic item by its ID
 */
export const getCosmeticById = (id) => COSMETICS.find(c => c.id === id) || null;

/**
 * Get all cosmetics filtered by type
 */
export const getCosmeticsByType = (type) => COSMETICS.filter(c => c.type === type);

/**
 * Get all cosmetics filtered by rarity
 */
export const getCosmeticsByRarity = (rarity) => COSMETICS.filter(c => c.rarity === rarity);
