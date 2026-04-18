import { 
  doc, 
  updateDoc, 
  arrayUnion, 
  getDoc, 
  getDocs, 
  collection, 
  runTransaction, 
  serverTimestamp, 
  increment 
} from 'firebase/firestore';
import { db } from '../firebase';

// Module-level cache to support synchronous helpers for components that haven't transitioned to async fetch
let COSMETICS_CACHE = {};

/**
 * Fetch all cosmestics from Firestore catalog
 */
export async function getAllCosmetics() {
  try {
    const cosmeticsRef = collection(db, 'cosmetics');
    const snap = await getDocs(cosmeticsRef);
    const data = snap.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
    
    // Update cache
    data.forEach(item => {
      COSMETICS_CACHE[item.id] = item;
    });
    
    return data;
  } catch (error) {
    console.error('Error fetching cosmetics:', error);
    return [];
  }
}

/**
 * Purchase a cosmetic item for the current user.
 */
export async function purchaseCosmetic(userId, cosmeticId) {
  try {
    const userRef = doc(db, 'users', userId);
    const cosmeticRef = doc(db, 'cosmetics', cosmeticId);

    const result = await runTransaction(db, async (transaction) => {
      const userSnap = await transaction.get(userRef);
      const cosmeticSnap = await transaction.get(cosmeticRef);

      if (!userSnap.exists()) throw new Error('User not found.');
      if (!cosmeticSnap.exists()) throw new Error('Cosmetic not found.');

      const userData = userSnap.data();
      const cosmeticData = cosmeticSnap.data();

      const currentPoints = userData.points || 0;
      const owned = userData.ownedCosmetics || [];

      if (owned.includes(cosmeticId)) {
        throw new Error('You already own this cosmetic.');
      }

      if (currentPoints < cosmeticData.price) {
        throw new Error(`Not enough Valcoins. Need ${cosmeticData.price.toLocaleString()}, have ${currentPoints.toLocaleString()}.`);
      }

      // Deduct points and add to owned
      transaction.update(userRef, {
        points: currentPoints - cosmeticData.price,
        ownedCosmetics: arrayUnion(cosmeticId),
        updatedAt: serverTimestamp()
      });

      // Increment sale count
      transaction.update(cosmeticRef, {
        saleCount: increment(1)
      });

      return { newBalance: currentPoints - cosmeticData.price };
    });

    return { success: true, ...result };
  } catch (error) {
    console.error('Error purchasing cosmetic:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Equip a cosmetic item to the user's profile.
 */
export async function equipCosmetic(userId, cosmeticId, slot = 'aura') {
  try {
    const userRef = doc(db, 'users', userId);

    if (!cosmeticId) {
      await updateDoc(userRef, {
        [`equippedCosmetics.${slot}`]: null,
      });
      return { success: true };
    }

    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) return { success: false, error: 'User not found.' };

    const userData = userSnap.data();
    const owned = userData.ownedCosmetics || [];

    if (!owned.includes(cosmeticId)) {
      return { success: false, error: 'You do not own this cosmetic.' };
    }

    await updateDoc(userRef, {
      [`equippedCosmetics.${slot}`]: cosmeticId,
    });

    return { success: true };
  } catch (error) {
    console.error('Error equipping cosmetic:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Helper to fetch a single cosmetic by ID from Firestore
 */
export async function fetchCosmeticById(cosmeticId) {
  if (!cosmeticId) return null;
  
  // Return from cache if available
  if (COSMETICS_CACHE[cosmeticId]) return COSMETICS_CACHE[cosmeticId];

  try {
    const docRef = doc(db, 'cosmetics', cosmeticId);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      const data = { id: snap.id, ...snap.data() };
      COSMETICS_CACHE[cosmeticId] = data; // Cache it
      return data;
    }
    return null;
  } catch (error) {
    console.error('Error fetching cosmetic:', error);
    return null;
  }
}

/**
 * LEGACY COMPATIBILITY HELPERS
 * These are synchronous and rely on the local cache. 
 * They may return empty/null on the first render until the shop/user data is loaded.
 */

export const getEquippedAuraClass = (user) => {
  const auraId = user?.equippedCosmetics?.aura;
  if (!auraId) return null;
  return COSMETICS_CACHE[auraId]?.cssClass || null;
};

export const getEquippedBannerStyle = (user) => {
  const bannerId = user?.equippedCosmetics?.banner;
  if (!bannerId) return {};
  return COSMETICS_CACHE[bannerId]?.style || {};
};

export const getEquippedFrameClass = (user) => {
    const frameId = user?.equippedCosmetics?.frame;
    if (!frameId) return null;
    return COSMETICS_CACHE[frameId]?.cssClass || null;
};
