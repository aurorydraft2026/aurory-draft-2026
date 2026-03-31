import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  serverTimestamp,
  runTransaction,
  increment
} from 'firebase/firestore';
import { createNotification } from './notifications';
import { db } from '../firebase';
import { logActivity } from './activityService';

/**
 * Create a new raffle
 * @param {Object} raffleData - Raffle details
 * @param {Object} user - User creating the raffle
 */
export async function createRaffle(raffleData, user) {
  try {
    const docRef = await addDoc(collection(db, 'raffles'), {
      ...raffleData,
      status: 'active',
      participants: [],
      participantsCount: 0,
      totalFeesCollected: 0,
      createdBy: user.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    logActivity({
      user,
      type: 'ADMIN',
      action: 'create_raffle',
      metadata: { raffleId: docRef.id, itemType: raffleData.itemType }
    });

    return { success: true, id: docRef.id };
  } catch (error) {
    console.error('Error creating raffle:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Update an existing raffle
 * @param {string} raffleId - Raffle ID
 * @param {Object} updates - Fields to update
 * @param {Object} user - Admin updating
 */
export async function updateRaffle(raffleId, updates, user) {
  try {
    const raffleRef = doc(db, 'raffles', raffleId);
    await updateDoc(raffleRef, {
      ...updates,
      updatedAt: serverTimestamp()
    });

    logActivity({
      user,
      type: 'ADMIN',
      action: 'update_raffle',
      metadata: { raffleId, updatedFields: Object.keys(updates) }
    });

    return { success: true };
  } catch (error) {
    console.error('Error updating raffle:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Join a raffle
 * @param {string} raffleId - ID of the raffle to join
 * @param {Object} user - User joining the raffle
 * @param {Object} auroryData - User's Aurory account data
 */
export async function joinRaffle(raffleId, user, auroryData) {
  let raffleName = 'Raffle';
  try {
    const raffleRef = doc(db, 'raffles', raffleId);
    const walletRef = doc(db, 'wallets', user.uid);

    const result = await runTransaction(db, async (transaction) => {
      const raffleSnap = await transaction.get(raffleRef);
      if (!raffleSnap.exists()) throw new Error('Raffle not found');

      const raffle = raffleSnap.data();
      raffleName = raffle.itemType || 'Raffle';
      if (raffle.status !== 'active') throw new Error('Raffle is no longer active');
      if (raffle.participantsCount >= raffle.maxParticipants) throw new Error('Raffle is full');

      // Check if end date has passed
      if (raffle.endDate) {
        const endDate = raffle.endDate.toDate ? raffle.endDate.toDate() : new Date(raffle.endDate);
        if (endDate < new Date()) {
          throw new Error('Raffle entry period has ended');
        }
      }

      // Check if user already joined
      const isAlreadyJoined = raffle.participants?.some(p => p.uid === user.uid);
      if (isAlreadyJoined) throw new Error('You have already joined this raffle');

      const entryFee = raffle.isFree ? 0 : (raffle.entryFee || 0);
      const entryFeeSmallestUnit = Math.floor(entryFee * 1e9);

      // Award Points (Dynamic configurable amount, default 20)
      let pointsAwarded = 20;
      const configRef = doc(db, 'settings', 'valcoin_rewards');
      const configSnap = await transaction.get(configRef);
      if (configSnap.exists()) {
          pointsAwarded = configSnap.data().joinRaffle ?? 20;
      }

      if (entryFeeSmallestUnit > 0) {
        const walletSnap = await transaction.get(walletRef);
        if (!walletSnap.exists()) throw new Error('Wallet not found');

        const balance = walletSnap.data().balance || 0;
        if (balance < entryFeeSmallestUnit) throw new Error('Insufficient balance');

        // Deduct balance
        transaction.update(walletRef, {
          balance: balance - entryFeeSmallestUnit,
          updatedAt: serverTimestamp()
        });

        // Log transaction
        const txRef = doc(collection(db, 'wallets', user.uid, 'transactions'));
        transaction.set(txRef, {
          type: 'raffle_entry',
          amount: entryFeeSmallestUnit,
          raffleId: raffleId,
          itemName: raffle.itemType,
          status: 'completed',
          timestamp: serverTimestamp()
        });
      }

      // Add to participants
      const newParticipant = {
        uid: user.uid,
        playerName: auroryData.playerName || user.displayName || 'Anonymous',
        auroryPlayerId: auroryData.playerId || null,
        joinedAt: new Date().toISOString()
      };

      const newParticipants = [...(raffle.participants || []), newParticipant];
      const newParticipantsCount = newParticipants.length;
      const newTotalFees = (raffle.totalFeesCollected || 0) + entryFeeSmallestUnit;

      transaction.update(raffleRef, {
        participants: newParticipants,
        participantsCount: newParticipantsCount,
        totalFeesCollected: newTotalFees,
        updatedAt: serverTimestamp()
      });


      if (pointsAwarded > 0) {
        const userRef = doc(db, 'users', user.uid);
        transaction.update(userRef, {
          points: increment(pointsAwarded),
          updatedAt: serverTimestamp()
        });

        // Log points history
        const historyRef = doc(collection(db, 'users', user.uid, 'pointsHistory'));
        transaction.set(historyRef, {
          amount: pointsAwarded,
          type: 'raffle_join',
          description: `Joined raffle: ${raffle.itemType}`,
          timestamp: serverTimestamp()
        });
      }

      return { success: true, pointsAwarded };
    });

    if (result.success && result.pointsAwarded > 0) {
      await createNotification(user.uid, {
        title: 'Valcoins Awarded!',
        message: `You earned ${result.pointsAwarded} Valcoins for joining the ${raffleName} raffle!`,
        type: 'points'
      });
    }

    return result;
  } catch (error) {
    console.error('Error joining raffle:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Start raffle (Determine winner before spin)
 * @param {string} raffleId - Raffle ID
 * @param {Object} user - Admin starting the raffle
 */
export async function startRaffle(raffleId, user) {
  try {
    const raffleRef = doc(db, 'raffles', raffleId);
    
    return await runTransaction(db, async (transaction) => {
      const raffleSnap = await transaction.get(raffleRef);
      if (!raffleSnap.exists()) throw new Error('Raffle not found');

      const raffle = raffleSnap.data();
      if (raffle.status !== 'active') throw new Error('Raffle is not active');
      if (raffle.participantsCount < (raffle.minParticipants || 1)) {
        throw new Error(`Minimum participants (${raffle.minParticipants}) not reached`);
      }

      // Select winner randomly
      const participants = raffle.participants || [];
      const randomIndex = Math.floor(Math.random() * participants.length);
      const winner = participants[randomIndex];

      transaction.update(raffleRef, {
        status: 'spinning',
        winner: winner,
        startedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      logActivity({
        user,
        type: 'ADMIN',
        action: 'start_raffle',
        metadata: { raffleId, winnerUid: winner.uid }
      });

      return { success: true, winner };
    });
  } catch (error) {
    console.error('Error starting raffle:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Complete raffle
 * @param {string} raffleId - Raffle ID
 */
export async function completeRaffle(raffleId) {
  try {
    const raffleRef = doc(db, 'raffles', raffleId);
    await updateDoc(raffleRef, {
      status: 'completed',
      completedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    return { success: true };
  } catch (error) {
    console.error('Error completing raffle:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Delete raffle and refund participants if active
 * @param {string} raffleId - Raffle ID
 * @param {Object} user - Admin deleting the raffle
 */
export async function deleteRaffle(raffleId, user) {
  try {
    const raffleRef = doc(db, 'raffles', raffleId);
    const raffleSnap = await getDoc(raffleRef);
    if (!raffleSnap.exists()) throw new Error('Raffle not found');
    
    const raffle = raffleSnap.data();

    if (raffle.status === 'active' && !raffle.isFree && raffle.participantsCount > 0) {
      // Refund participants
      const participants = raffle.participants || [];
      
      // We'll do this in a loop, but ideally should use a batch or cloud function for many participants
      for (const participant of participants) {
        const entryFeeSmallestUnit = Math.floor((raffle.entryFee || 0) * 1e9);
        if (entryFeeSmallestUnit > 0) {
          const walletRef = doc(db, 'wallets', participant.uid);
          await runTransaction(db, async (transaction) => {
            const walletSnap = await transaction.get(walletRef);
            if (walletSnap.exists()) {
              const currentBalance = walletSnap.data().balance || 0;
              transaction.update(walletRef, {
                balance: currentBalance + entryFeeSmallestUnit,
                updatedAt: serverTimestamp()
              });

              const txRef = doc(collection(db, 'wallets', participant.uid, 'transactions'));
              transaction.set(txRef, {
                type: 'raffle_refund',
                amount: entryFeeSmallestUnit,
                raffleId: raffleId,
                status: 'completed',
                timestamp: serverTimestamp()
              });
            }
          });
        }
      }
    }

    await deleteDoc(raffleRef);

    logActivity({
      user,
      type: 'ADMIN',
      action: 'delete_raffle',
      metadata: { raffleId }
    });

    return { success: true };
  } catch (error) {
    console.error('Error deleting raffle:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Shuffle participants list in Firestore (Randomize Participants button)
 * @param {string} raffleId - Raffle ID
 * @param {Object} user - Admin shuffling
 */
export async function shuffleParticipants(raffleId, user) {
  try {
    const raffleRef = doc(db, 'raffles', raffleId);
    const raffleSnap = await getDoc(raffleRef);
    if (!raffleSnap.exists()) throw new Error('Raffle not found');

    const raffle = raffleSnap.data();
    if (raffle.status !== 'active') throw new Error('Only active raffles can be shuffled');

    const participants = [...(raffle.participants || [])];
    
    // Fisher-Yates shuffle
    for (let i = participants.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [participants[i], participants[j]] = [participants[j], participants[i]];
    }

    await updateDoc(raffleRef, {
      participants: participants,
      updatedAt: serverTimestamp()
    });

    return { success: true };
  } catch (error) {
    console.error('Error shuffling participants:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Add mock participants for testing (Super Admin only)
 * @param {string} raffleId - Raffle ID
 * @param {number} count - Number of mock participants to add
 */
export async function addMockParticipants(raffleId, count = 5) {
  try {
    const raffleRef = doc(db, 'raffles', raffleId);
    const raffleSnap = await getDoc(raffleRef);
    if (!raffleSnap.exists()) throw new Error('Raffle not found');

    const raffle = raffleSnap.data();
    if (raffle.status !== 'active') throw new Error('Can only add participants to active raffles');

    const participants = [...(raffle.participants || [])];
    const baseCount = participants.length;

    for (let i = 0; i < count; i++) {
      if (participants.length >= raffle.maxParticipants) break;
      
      const mockId = Math.random().toString(36).substr(2, 9);
      participants.push({
        uid: `mock_${mockId}`,
        playerName: `MockTester_${baseCount + i + 1}`,
        auroryPlayerId: `mock_player_${mockId}`,
        joinedAt: new Date().toISOString(),
        isMock: true
      });
    }

    await updateDoc(raffleRef, {
      participants: participants,
      participantsCount: participants.length,
      updatedAt: serverTimestamp()
    });

    return { success: true };
  } catch (error) {
    console.error('Error adding mock participants:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Remove a participant from a raffle (Admin only)
 * @param {string} raffleId - Raffle ID
 * @param {string} participantUid - UID of user to remove
 * @param {Object} adminUser - Admin performing the removal
 */
export async function removeRaffleParticipant(raffleId, participantUid, adminUser) {
  try {
    const raffleRef = doc(db, 'raffles', raffleId);
    const walletRef = doc(db, 'wallets', participantUid);

    const result = await runTransaction(db, async (transaction) => {
      // READS
      const raffleSnap = await transaction.get(raffleRef);
      if (!raffleSnap.exists()) throw new Error('Raffle not found');
      
      const raffle = raffleSnap.data();
      if (raffle.status !== 'active' && raffle.status !== 'entries_closed') {
        throw new Error('Can only remove participants from active or entries-closed raffles');
      }

      const participants = raffle.participants || [];
      const participantIndex = participants.findIndex(p => p.uid === participantUid);
      
      if (participantIndex === -1) throw new Error('Participant not found in this raffle');

      const entryFee = raffle.isFree ? 0 : (raffle.entryFee || 0);
      const entryFeeSmallestUnit = Math.floor(entryFee * 1e9);

      // If there was an entry fee, we need a refund
      let refundSuccessful = false;
      if (entryFeeSmallestUnit > 0) {
        const walletSnap = await transaction.get(walletRef);
        if (walletSnap.exists()) {
          const currentBalance = walletSnap.data().balance || 0;
          
          // WRITES (Wallet)
          transaction.update(walletRef, {
            balance: currentBalance + entryFeeSmallestUnit,
            updatedAt: serverTimestamp()
          });

          const txRef = doc(collection(db, 'wallets', participantUid, 'transactions'));
          transaction.set(txRef, {
            type: 'raffle_refund',
            amount: entryFeeSmallestUnit,
            raffleId: raffleId,
            itemName: raffle.itemType,
            status: 'completed',
            reason: 'Removed by Admin',
            timestamp: serverTimestamp()
          });
          
          refundSuccessful = true;
        }
      }

      // WRITES (Raffle)
      const updatedParticipants = participants.filter(p => p.uid !== participantUid);
      transaction.update(raffleRef, {
        participants: updatedParticipants,
        participantsCount: updatedParticipants.length,
        totalFeesCollected: (raffle.totalFeesCollected || 0) - (refundSuccessful ? entryFeeSmallestUnit : 0),
        updatedAt: serverTimestamp()
      });

      // Log admin activity
      logActivity({
        user: adminUser,
        type: 'ADMIN',
        action: 'remove_raffle_participant',
        metadata: { raffleId, participantUid, refunded: refundSuccessful }
      });

      return { success: true, refunded: refundSuccessful, itemName: raffle.itemType };
    });

    if (result.success) {
      await createNotification(participantUid, {
        title: 'Removed from Raffle',
        message: `Admin removed you from the ${result.itemName} raffle. ${result.refunded ? 'Your entry fee has been refunded.' : ''}`,
        type: 'raffle'
      });
    }

    return result;
  } catch (error) {
    console.error('Error removing participant:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Manually close raffle entries (Admin only)
 * @param {string} raffleId - Raffle ID
 * @param {Object} user - Admin closing the entries
 */
export async function closeRaffleEntries(raffleId, user) {
  try {
    const raffleRef = doc(db, 'raffles', raffleId);
    await updateDoc(raffleRef, {
      status: 'entries_closed',
      entriesClosedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    logActivity({
      user,
      type: 'ADMIN',
      action: 'close_raffle_entries',
      metadata: { raffleId }
    });

    return { success: true };
  } catch (error) {
    console.error('Error closing raffle entries:', error);
    return { success: false, error: error.message };
  }
}
