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
import { resolveDisplayName } from '../utils/userUtils';
import { createNotification } from './notifications';

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

    // 0. Fail-fast check before even starting the transaction to reduce load
    const userSnapInitial = await getDoc(userRef);
    if (userSnapInitial.exists()) {
      const owned = userSnapInitial.data().ownedCosmetics || [];
      if (owned.includes(cosmeticId)) {
        throw new Error('You already own this cosmetic.');
      }
    }

    const result = await runTransaction(db, async (transaction) => {
      const userSnap = await transaction.get(userRef);
      const cosmeticSnap = await transaction.get(cosmeticRef);

      if (!userSnap.exists()) throw new Error('User not found.');
      if (!cosmeticSnap.exists()) throw new Error('Cosmetic not found.');

      const userData = userSnap.data();
      const cosmeticData = cosmeticSnap.data();
      
      // Normalize currency to lowercase to prevent case-sensitivity bugs (e.g., 'AURY' vs 'aury')
      const rawCurrency = cosmeticData.currency || 'valcoins';
      const currency = rawCurrency.toLowerCase();
      
      const creatorId = cosmeticData.createdBy;

      const owned = userData.ownedCosmetics || [];
      if (owned.includes(cosmeticId)) {
        throw new Error('You already own this cosmetic.');
      }

      let userBalance = 0;
      let walletRef = null;
      let userWalletSnap = null;
      let shareAmount = 0;
      let creatorWalletRef = null;
      
      const factor = currency === 'aury' ? 1e9 : (currency === 'usdc' ? 1e6 : 1);
      const isCreator = creatorId === userId;
      
      const basePrice = Number(cosmeticData.price) || 0;
      let discountPrice = (cosmeticData.discountPrice !== undefined && cosmeticData.discountPrice !== null) ? Number(cosmeticData.discountPrice) : null;
      
      // Check if discount has expired
      if (discountPrice !== null && cosmeticData.discountExpiry) {
        const expiry = cosmeticData.discountExpiry.toDate();
        if (new Date() > expiry) {
          discountPrice = null; // Discount expired
        }
      }

      let salePrice = basePrice;
      // Use discount price if it exists and is less than base price
      if (discountPrice !== null && discountPrice < basePrice) {
        salePrice = discountPrice;
      }

      // Strict Price Check: If item has no price and user is NOT the creator, block the purchase
      if (!isCreator && salePrice === 0 && basePrice === 0 && (cosmeticData.price === undefined || cosmeticData.price === null)) {
        throw new Error('This item has no price set and cannot be purchased.');
      }

      const actualPrice = isCreator ? 0 : salePrice;
      const priceInSmallestUnit = Math.floor(actualPrice * factor);

      if (actualPrice > 0) {
        if (currency === 'valcoins') {
          userBalance = userData.points || 0;
        } else {
          walletRef = doc(db, 'wallets', userId);
          userWalletSnap = await transaction.get(walletRef);
          if (!userWalletSnap.exists()) throw new Error(`You don't have a ${currency.toUpperCase()} wallet yet.`);
          
          const walletData = userWalletSnap.data();
          userBalance = currency === 'aury' ? (walletData.balance || 0) : (walletData.usdcBalance || 0);
        }

        if (userBalance < priceInSmallestUnit) {
          const displayBalance = currency === 'valcoins' ? userBalance : (userBalance / factor).toFixed(2);
          throw new Error(`Insufficient ${currency.toUpperCase()}. Need ${actualPrice} ${currency.toUpperCase()}, have ${displayBalance} ${currency.toUpperCase()}.`);
        }
      }

      // 2. Perform Deductions (if any) and Update Inventory
      if (actualPrice > 0) {
        if (currency === 'valcoins') {
          transaction.update(userRef, {
            points: increment(-priceInSmallestUnit),
            ownedCosmetics: arrayUnion(cosmeticId),
            updatedAt: serverTimestamp()
          });

          // Log buyer's Valcoin deduction to pointsHistory
          const buyerHistoryRef = doc(collection(db, `users/${userId}/pointsHistory`));
          transaction.set(buyerHistoryRef, {
            amount: -priceInSmallestUnit,
            type: 'cosmetic_purchase',
            description: `Purchased: ${cosmeticData.name}`,
            currency: 'valcoins',
            cosmeticId: cosmeticId,
            timestamp: serverTimestamp()
          });
        } else {
          const fieldToDecrement = currency === 'aury' ? 'balance' : 'usdcBalance';
          transaction.update(walletRef, {
            [fieldToDecrement]: increment(-priceInSmallestUnit),
            updatedAt: serverTimestamp()
          });
          transaction.update(userRef, {
            ownedCosmetics: arrayUnion(cosmeticId),
            updatedAt: serverTimestamp()
          });

          // Log buyer's AURY/USDC deduction to wallet transactions
          const buyerTxRef = doc(collection(db, `wallets/${userId}/transactions`));
          transaction.set(buyerTxRef, {
            type: 'cosmetic_purchase',
            amount: priceInSmallestUnit,
            currency: currency.toUpperCase(),
            cosmeticId: cosmeticId,
            cosmeticName: cosmeticData.name,
            status: 'completed',
            reason: `Purchased: ${cosmeticData.name}`,
            timestamp: serverTimestamp()
          });
        }
      } else {
        // Just add to inventory for free
        transaction.update(userRef, {
          ownedCosmetics: arrayUnion(cosmeticId),
          updatedAt: serverTimestamp()
        });
      }

      // 3. Creator Revenue Share (60%) - Only if it wasn't a self-purchase/free claim
      if (creatorId && creatorId !== userId && actualPrice > 0) {
        shareAmount = Math.floor(priceInSmallestUnit * 0.6);
        
        if (currency === 'valcoins') {
          const creatorRef = doc(db, 'users', creatorId);
          transaction.set(creatorRef, {
            points: increment(shareAmount)
          }, { merge: true });
        } else {
          creatorWalletRef = doc(db, 'wallets', creatorId);
          const fieldToIncrement = currency === 'aury' ? 'balance' : 'usdcBalance';
          
          transaction.set(creatorWalletRef, {
            [fieldToIncrement]: increment(shareAmount),
            updatedAt: serverTimestamp()
          }, { merge: true });

          // Log creator's AURY/USDC revenue to wallet transactions
          const creatorTxRef = doc(collection(db, `wallets/${creatorId}/transactions`));
          transaction.set(creatorTxRef, {
            type: 'cosmetic_revenue',
            amount: shareAmount,
            currency: currency.toUpperCase(),
            cosmeticId: cosmeticId,
            cosmeticName: cosmeticData.name,
            buyerId: userId,
            status: 'completed',
            reason: `60% revenue from: ${cosmeticData.name}`,
            timestamp: serverTimestamp()
          });
        }
        
        // Log the commission to pointsHistory (legacy + Valcoin tracking)
        const commissionRef = doc(collection(db, `users/${creatorId}/pointsHistory`));
        transaction.set(commissionRef, {
          amount: currency === 'valcoins' ? shareAmount : (shareAmount / factor),
          amountSmallestUnit: shareAmount,
          type: 'cosmetic_commission',
          description: `60% share from sale of ${cosmeticData.name}`,
          currency: currency,
          buyerId: userId,
          timestamp: serverTimestamp()
        });
      }


      // 4. Update Cosmetic Stats
      transaction.update(cosmeticRef, {
        saleCount: increment(1)
      });

      // 5. Global Sales Log for Admin tracking
      const saleLogRef = doc(collection(db, 'cosmetic_sales'));
      transaction.set(saleLogRef, {
        buyerId: userId,
        buyerName: resolveDisplayName(userData) || 'Unknown',
        creatorId: creatorId || 'System',
        cosmeticId: cosmeticId,
        cosmeticName: cosmeticData.name,
        price: actualPrice,
        currency: currency,
        commission: shareAmount / factor,
        timestamp: serverTimestamp()
      });

      return { 
        newBalance: userBalance - priceInSmallestUnit, 
        currency,
        shareAmount,
        buyerName: resolveDisplayName(userData) || 'A player',
        creatorId,
        itemName: cosmeticData.name
      };
    });

    // Send Notification to Creator
    if (result.creatorId && result.creatorId !== userId && result.shareAmount > 0) {
      const currencyLabel = result.currency === 'aury' ? 'AURY' : result.currency === 'usdc' ? 'USDC' : 'Valcoins';
      const factor = result.currency === 'aury' ? 1e9 : (result.currency === 'usdc' ? 1e6 : 1);
      const displayAmount = result.currency === 'valcoins' ? result.shareAmount : (result.shareAmount / factor).toFixed(2);
      
      createNotification(result.creatorId, {
        type: 'cosmetic_commission',
        title: '🎨 Item Sold!',
        message: `${result.buyerName} bought your item "${result.itemName}". ${displayAmount} ${currencyLabel} has been credited to your account.`,
        link: '/cosmetics'
      });
    }

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

