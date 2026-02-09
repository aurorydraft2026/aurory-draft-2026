/**
 * Aurory API Service
 * Wrapper for the Aurory Aggregator API
 * 
 * API Base URL: https://aggregator-api.dev.aurory.io
 * Real Endpoint: /v1/nefties/index
 */

const AURORY_API_BASE = 'https://aggregator-api.dev.aurory.io';

class AuroryAPIService {
  constructor() {
    this.baseURL = AURORY_API_BASE;
    this.cache = new Map();
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes cache
  }

  /**
   * Generic API request handler with caching
   */
  async request(endpoint, options = {}) {
    // Check cache first
    const cacheKey = `${endpoint}-${JSON.stringify(options)}`;
    const cached = this.cache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      console.log(`📦 Using cached data for ${endpoint}`);
      return { success: true, data: cached.data };
    }

    const url = `${this.baseURL}${endpoint}`;
    
    try {
      console.log(`🔄 Fetching from Aurory API: ${endpoint}`);
      
      const response = await fetch(url, {
        method: options.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
        ...options,
      });

      if (!response.ok) {
        throw new Error(`API Error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      
      // Cache successful responses
      this.cache.set(cacheKey, {
        data: data,
        timestamp: Date.now()
      });
      
      console.log(`✅ Successfully fetched ${endpoint}:`, data.length || 'data', 'items');
      return { success: true, data };
    } catch (error) {
      console.error(`❌ Aurory API Error (${endpoint}):`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get all Nefties/Amikos from the real API
   * Endpoint: /v1/nefties/index
   */
  async getAllAmikos() {
    const result = await this.request('/v1/nefties/index');
    
    if (result.success) {
      // Transform API data to match local structure
      const transformedData = result.data
        .filter(neftie => neftie.is_live) // Only include live Nefties
        .map(neftie => this.transformNeftieToAmiko(neftie));
      
      return { success: true, data: transformedData };
    }
    
    return result;
  }

  /**
   * Transform Aurory API Neftie data to local Amiko structure
   */
  transformNeftieToAmiko(neftie) {
    return {
      // Core identification
      id: this.generateAmikoId(neftie.type), // Convert "Dinobit" to "dinobit"
      name: neftie.type, // "Dinobit", "Axobubble", etc.
      
      // API-specific data
      apiId: neftie.id, // Original API ID (i-XXXX)
      index: neftie.index,
      
      // Type/Element mapping
      type: this.mapElementToType(neftie.element), // Fire -> fire, Water -> water
      element: neftie.element, // Fire, Water, Earth, Air
      
      // Pattern and state
      pattern: neftie.pattern, // Primal, etc.
      currentState: neftie.current_state, // LOCKED, etc.
      
      // Stats (create from available data)
      stats: this.generateStatsFromNeftie(neftie),
      
      // Rarity (derived from seeker rank)
      rarity: this.mapSeekerRankToRarity(neftie.seeker_rank),
      seekerRank: neftie.seeker_rank, // A, B, C
      
      // Location
      location: neftie.location,
      
      // Physical attributes
      height: {
        min: neftie.minHeight,
        max: neftie.maxHeight
      },
      weight: {
        min: neftie.minWeight,
        max: neftie.maxWeight
      },
      
      // Descriptions
      descriptions: neftie.unlocked_descriptions_key_entries || [],
      
      // Keep local image path (API doesn't provide images)
      image: `/amikos/${this.generateAmikoId(neftie.type)}.png`,
      
      // Metadata
      isLive: neftie.is_live,
      source: 'api' // Mark as API data
    };
  }

  /**
   * Generate consistent ID from Neftie type name
   */
  generateAmikoId(typeName) {
    return typeName.toLowerCase().replace(/\s+/g, '');
  }

  /**
   * Map API element to local type
   */
  mapElementToType(element) {
    if (!element) return 'neutral';
    return element.toLowerCase(); // Fire -> fire, Water -> water
  }

  /**
   * Map Seeker Rank to Rarity
   */
  mapSeekerRankToRarity(rank) {
    const rarityMap = {
      'S': 'legendary',
      'A': 'epic',
      'B': 'rare',
      'C': 'uncommon',
      'D': 'common'
    };
    return rarityMap[rank] || 'common';
  }

  /**
   * Generate stats from Neftie data
   * Since API doesn't provide combat stats, we estimate based on rank/size
   */
  generateStatsFromNeftie(neftie) {
    // Base stats on seeker rank
    const rankMultipliers = {
      'S': 1.4,
      'A': 1.2,
      'B': 1.0,
      'C': 0.8,
      'D': 0.6
    };
    
    const multiplier = rankMultipliers[neftie.seeker_rank] || 1.0;
    
    // Base stats (can be adjusted)
    const baseHP = 100;
    const baseAttack = 80;
    const baseDefense = 70;
    const baseSpeed = 65;
    
    // Size also affects stats slightly
    const avgWeight = (neftie.minWeight + neftie.maxWeight) / 2;
    const weightMultiplier = 1 + (avgWeight - 10) / 100; // Normalize around 10
    
    return {
      hp: Math.round(baseHP * multiplier * weightMultiplier),
      attack: Math.round(baseAttack * multiplier),
      defense: Math.round(baseDefense * multiplier * weightMultiplier),
      speed: Math.round(baseSpeed * multiplier)
    };
  }

  /**
   * Get Neftie by ID
   */
  async getAmikoById(amikoId) {
    const allAmikos = await this.getAllAmikos();
    
    if (allAmikos.success) {
      const amiko = allAmikos.data.find(a => a.id === amikoId || a.apiId === amikoId);
      if (amiko) {
        return { success: true, data: amiko };
      }
      return { success: false, error: 'Amiko not found' };
    }
    
    return allAmikos;
  }

  /**
   * Search Nefties by filters
   */
  async searchAmikos(filters = {}) {
    const allAmikos = await this.getAllAmikos();
    
    if (allAmikos.success) {
      let filtered = allAmikos.data;
      
      // Filter by element/type
      if (filters.element) {
        filtered = filtered.filter(a => 
          a.element?.toLowerCase() === filters.element.toLowerCase()
        );
      }
      
      // Filter by rarity
      if (filters.rarity) {
        filtered = filtered.filter(a => 
          a.rarity?.toLowerCase() === filters.rarity.toLowerCase()
        );
      }
      
      // Filter by seeker rank
      if (filters.rank) {
        filtered = filtered.filter(a => 
          a.seekerRank === filters.rank.toUpperCase()
        );
      }
      
      // Filter by pattern
      if (filters.pattern) {
        filtered = filtered.filter(a => 
          a.pattern?.toLowerCase() === filters.pattern.toLowerCase()
        );
      }
      
      return { success: true, data: filtered };
    }
    
    return allAmikos;
  }

  /**
   * Get Nefties by element
   */
  async getAmikosByElement(element) {
    return this.searchAmikos({ element });
  }

  /**
   * Get Nefties by rarity
   */
  async getAmikosByRarity(rarity) {
    return this.searchAmikos({ rarity });
  }

  /**
   * Clear cache (useful for forcing refresh)
   */
  clearCache() {
    this.cache.clear();
    console.log('🗑️ API cache cleared');
  }
}

// Create singleton instance
const auroryAPI = new AuroryAPIService();

export default auroryAPI;

// Named exports for specific functions
export const {
  getAllAmikos,
  getAmikoById,
  searchAmikos,
  getAmikosByElement,
  getAmikosByRarity
} = auroryAPI;