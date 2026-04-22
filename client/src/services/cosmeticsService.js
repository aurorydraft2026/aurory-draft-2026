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
let isHydrated = false;
let initialFetchPromise = null;

/**
 * Fetch all cosmetics from Firestore catalog.
 * Uses a singleton promise to ensure only one network request is made even if multiple components call it at once.
 */
export async function getAllCosmetics(force = false) {
  if (isHydrated && !force) return Object.values(COSMETICS_CACHE);
  if (initialFetchPromise && !force) return initialFetchPromise;

  initialFetchPromise = (async () => {
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
      
      isHydrated = true;
      initialFetchPromise = null; // Clear promise but keep isHydrated true
      return data;
    } catch (error) {
      console.error('Error fetching cosmetics:', error);
      initialFetchPromise = null;
      return [];
    }
  })();

  return initialFetchPromise;
}

/**
 * Manually update the local cosmetics cache with fresh data.
 * Useful when a component already has the metadata and wants to sync it globally.
 */
export function updateCosmeticsCache(data) {
  if (!data) return;
  const items = Array.isArray(data) ? data : [data];
  items.forEach(item => {
    if (item && item.id) {
      COSMETICS_CACHE[item.id] = { ...COSMETICS_CACHE[item.id], ...item };
    }
  });
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

export const getEquippedBannerStyle = (user, useStatic = false) => {
  const bannerId = user?.equippedCosmetics?.banner;
  if (!bannerId) return null;
  const banner = COSMETICS_CACHE[bannerId];
  if (!banner) return null;
  
  // If the banner has an explicit style object with content, use it (legacy local data)
  if (banner.style && Object.keys(banner.style).length > 0) {
    return banner.style;
  }
  
  // Order of preference for animations: avif -> gif
  // Order of preference for static: webp -> png
  let url = null;
  if (useStatic) {
    url = banner.webpUrl || banner.pngUrl || banner.gifUrl;
  } else {
    url = banner.avifUrl || banner.gifUrl || banner.webpUrl || banner.pngUrl;
  }

  if (url) {
    return {
      backgroundImage: `url("${url}")`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat'
    };
  }
  
  return null;
};

/**
 * Returns true if this user has a banner that supports animated/static toggling
 * (i.e. the banner cosmetic has both gifUrl and pngUrl).
 */
export const hasBannerAnimation = (user) => {
  const bannerId = user?.equippedCosmetics?.banner;
  if (!bannerId) return false;
  const banner = COSMETICS_CACHE[bannerId];
  return !!(banner?.gifUrl);
};

export const getEquippedFrameClass = (user) => {
    const frameId = user?.equippedCosmetics?.frame;
    if (!frameId) return null;
    return COSMETICS_CACHE[frameId]?.cssClass || null;
};

/**
 * Extract the visual background style from a banner cosmetic object.
 * Works for both legacy banners (with a pre-built `style` object) and
 * admin-created banners (with only a `gifUrl`).
 * @param {boolean} useStatic - If true, prefer pngUrl for static display.
 */
export const getBannerStyleFromCosmetic = (cosmetic, useStatic = false) => {
  if (!cosmetic || cosmetic.type !== 'banner') return null;
  
  // Legacy banners with pre-built style objects
  if (cosmetic.style && Object.keys(cosmetic.style).length > 0) {
    return cosmetic.style;
  }
  
  // Order of preference for animations: avif -> gif
  // Order of preference for static: webp -> png
  let url = null;
  if (useStatic) {
    url = cosmetic.webpUrl || cosmetic.pngUrl || cosmetic.gifUrl;
  } else {
    url = cosmetic.avifUrl || cosmetic.gifUrl || cosmetic.webpUrl || cosmetic.pngUrl;
  }

  if (url) {
    return {
      backgroundImage: `url("${url}")`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat'
    };
  }
  
  return null;
};

