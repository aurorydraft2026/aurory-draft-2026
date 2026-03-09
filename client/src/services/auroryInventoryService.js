import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';

// Use the direct live API instead of the proxy since the proxy cannot forward the user's session cookies
const AURORY_ITEMS_API = 'https://items-public-api.live.aurory.io/v2/inventories?sync_on_chain=true';

/**
 * Service for fetching and syncing user's Aurory inventory (Amikos, etc.)
 */
export const auroryInventoryService = {
    /**
     * Fetches the inventory directly from Aurory's Items API.
     * This relies on the user being logged into Aurory in another tab (session cookies).
     */
    async fetchRawInventory() {
        try {
            console.log('🎒 Fetching inventory directly from Aurory Items API...');

            // We use credentials: 'include' to pass the session cookies from app.aurory.io
            // This allows us to fetch the inventory of the currently logged-in Aurory user without needing their player_id
            const response = await fetch(AURORY_ITEMS_API, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                },
                credentials: 'include', // Crucial: sends the Aurory session cookies
            });

            if (!response.ok) {
                if (response.status === 401) {
                    throw new Error('Unauthorized. Please make sure you are logged into app.aurory.io in another tab.');
                }
                throw new Error(`API Error: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            return data;
        } catch (error) {
            console.error('❌ Error fetching Aurory inventory:', error);
            throw error;
        }
    },

    /**
     * Transforms raw API item data into our clean Amiko structure.
     */
    transformInventoryData(rawData) {
        if (!rawData || !rawData.items) return [];

        // Filter for Amikos (Neutral, Neftie, etc.)
        const amikos = rawData.items
            .filter(item =>
                item.collection?.type === 'NEFTIE' ||
                item.collection?.type === 'AMIKO' ||
                item.name?.includes('Amiko')
            )
            .map(item => {
                const blitz = item.generated_attributes?.BLITZ || {};
                const attrs = item.attributes || {};

                return {
                    id: item.id,
                    name: item.name,
                    species: item.skin_data?.neftie_species_requirement || item.collection?.name || 'Unknown',
                    rarity: item.generated_attributes?.rarity || attrs.Rarity || 'Common',
                    element: attrs.Element || 'Neutral',
                    level: item.level || 0,
                    experience: item.experience || 0,
                    skin: item.skin_data?.skin_item_config_name || null,
                    image: item.image || item.image_mini || null,
                    mint: item.mint || null,
                    // Storing real BLITZ stats
                    stats: {
                        hp: blitz.hp || 0,
                        atk: blitz.atk || 0,
                        eatk: blitz.eatk || 0,
                        def: blitz.def || 0,
                        edef: blitz.edef || 0,
                        speed: blitz.speed || 0,
                    },
                    // Percentiles for roll quality (optional but cool)
                    percentiles: blitz.base_stat_percentiles || null
                };
            });

        return amikos;
    },

    /**
     * Fetches the inventory and saves a snapshot to Firestore.
     * This is Option A: Sync and Store.
     */
    async syncInventoryToFirestore(userId) {
        try {
            // Fetch directly using the user's browser session with Aurory
            const rawData = await this.fetchRawInventory();
            const amikos = this.transformInventoryData(rawData);

            const userRef = doc(db, 'users', userId);

            // Note: The direct API returns the inventory of the currently logged-in user at app.aurory.io.
            // We save whatever player_id is returned by the API.
            await updateDoc(userRef, {
                'inventory.amikos': amikos,
                'inventory.lastSync': serverTimestamp(),
                'inventory.playerId': rawData.player_id || null
            });

            console.log(`✅ Successfully synced ${amikos.length} Amikos to Firestore for user ${userId}`);
            return { success: true, count: amikos.length, amikos };
        } catch (error) {
            console.error('❌ Sync failed:', error);
            return { success: false, error: error.message };
        }
    }
};

export default auroryInventoryService;
