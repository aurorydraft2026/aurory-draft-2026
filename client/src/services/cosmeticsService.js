/**
 * ============================================================
 * COSMETICS SERVICE
 * Handles purchasing, equipping, and reading cosmetics from Firestore
 * ============================================================
 */
import { doc, updateDoc, arrayUnion, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { getCosmeticById } from '../data/cosmetics';

/**
 * Purchase a cosmetic item for the current user.
 * Deducts Valcoins and adds the cosmetic ID to ownedCosmetics.
 * 
 * @param {string} userId - Firebase UID
 * @param {string} cosmeticId - ID from cosmetics catalog
 * @returns {{ success: boolean, error?: string }}
 */
export async function purchaseCosmetic(userId, cosmeticId) {
  try {
    const cosmetic = getCosmeticById(cosmeticId);
    if (!cosmetic) return { success: false, error: 'Cosmetic not found.' };

    const userRef = doc(db, 'users', userId);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) return { success: false, error: 'User not found.' };

    const userData = userSnap.data();
    const currentPoints = userData.points || 0;
    const owned = userData.ownedCosmetics || [];

    if (owned.includes(cosmeticId)) {
      return { success: false, error: 'You already own this cosmetic.' };
    }

    if (currentPoints < cosmetic.price) {
      return { success: false, error: `Not enough Valcoins. Need ${cosmetic.price.toLocaleString()}, have ${currentPoints.toLocaleString()}.` };
    }

    // Deduct points and add to owned
    await updateDoc(userRef, {
      points: currentPoints - cosmetic.price,
      ownedCosmetics: arrayUnion(cosmeticId),
    });

    return { success: true, newBalance: currentPoints - cosmetic.price };
  } catch (error) {
    console.error('Error purchasing cosmetic:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Equip a cosmetic item to the user's profile.
 * 
 * @param {string} userId - Firebase UID
 * @param {string} cosmeticId - ID to equip (or null to unequip)
 * @param {string} slot - 'aura' | 'banner' | 'frame'
 */
export async function equipCosmetic(userId, cosmeticId, slot = 'aura') {
  try {
    const userRef = doc(db, 'users', userId);

    // If unequipping
    if (!cosmeticId) {
      await updateDoc(userRef, {
        [`equippedCosmetics.${slot}`]: null,
      });
      return { success: true };
    }

    // Verify ownership
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
 * Get the equipped aura CSS class for a user object.
 * Can be used anywhere a user object is available.
 * 
 * @param {Object} user - User object with equippedCosmetics field
 * @returns {string|null} CSS class name or null
 */
export function getEquippedAuraClass(user) {
  if (!user?.equippedCosmetics?.aura) return null;
  const cosmetic = getCosmeticById(user.equippedCosmetics.aura);
  return cosmetic?.cssClass || null;
}

/**
 * Get the equipped banner style object for a user.
 * 
 * @param {Object} user - User object with equippedCosmetics field
 * @returns {Object|null} React style object or null
 */
export function getEquippedBannerStyle(user) {
  if (!user?.equippedCosmetics?.banner) return null;
  const cosmetic = getCosmeticById(user.equippedCosmetics.banner);
  return cosmetic?.style || null;
}
