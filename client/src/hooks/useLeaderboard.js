import { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { fetchVerifiedMatches, scanAndVerifyCompletedDrafts } from '../services/matchVerificationService';

export const useLeaderboard = (registeredUsers) => {
    const [matchHistory, setMatchHistory] = useState([]);
    const [matchHistoryLoading, setMatchHistoryLoading] = useState(true);
    const [matchHistoryFilter, setMatchHistoryFilter] = useState('all'); // 'all', 'mode1', 'mode2', 'mode3'
    const [expandedMatch, setExpandedMatch] = useState(null); // draftId of expanded match
    const [leaderboardMode, setLeaderboardMode] = useState('individual'); // 'individual' or 'team'
    const [selectedMonth, setSelectedMonth] = useState(() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    });

    // --- Earners Leaderboard Filters ---
    const [earnersCurrency, setEarnersCurrency] = useState('valcoins'); // 'valcoins', 'aury', 'usdc'
    const [earnersGameFilter, setEarnersGameFilter] = useState('all'); // 'all', 'slotMachine', 'treasureChest'
    const [wallets, setWallets] = useState([]); // [{id, balance, usdcBalance}]

    // Fetch match history (verified matches from all tournaments)
    useEffect(() => {
        const loadMatchHistory = async () => {
            setMatchHistoryLoading(true);
            try {
                const modeParam = matchHistoryFilter === 'all' ? null : matchHistoryFilter;

                // 1. Load existing verified matches immediately
                let matches = await fetchVerifiedMatches(50, modeParam);
                setMatchHistory(matches);
                setMatchHistoryLoading(false);

                // 2. Scan for unverified completed drafts in background
                const newlyVerified = await scanAndVerifyCompletedDrafts();

                // 3. If scan found new results, refetch
                if (newlyVerified > 0) {
                    matches = await fetchVerifiedMatches(50, modeParam);
                    setMatchHistory(matches);
                }
            } catch (error) {
                console.error('Error loading match history:', error);
                setMatchHistory([]);
                setMatchHistoryLoading(false);
            }
        };

        loadMatchHistory();
    }, [matchHistoryFilter]);

    // Compute top players of the month by wins
    const topPlayers = useMemo(() => {
        if (!matchHistory || matchHistory.length === 0) return [];

        const [selectedYear, selectedMonthIndex] = selectedMonth.split('-').map(Number);
        // monthIndex in selectedMonth is 1-based, Date.getMonth() is 0-based
        const targetMonth = selectedMonthIndex - 1;
        const targetYear = selectedYear;

        const winCounts = {}; // uid -> { wins, losses, displayName, photoURL }

        matchHistory.forEach(match => {
            // Filter to selected month
            if (match.verifiedAt) {
                const matchDate = new Date(match.verifiedAt);
                if (matchDate.getMonth() !== targetMonth || matchDate.getFullYear() !== targetYear) return;
            }

            if (!match.overallWinner) return;

            if (leaderboardMode === 'team') {
                // --- TEAM MODE: Group by leader + members set ---
                // Skip 1v1 matches in team leaderboard
                if (match.draftType === 'mode3' || match.draftType === 'mode4') return;

                const teams = ['A', 'B'];
                teams.forEach(tCode => {
                    const teamPlayers = match.matchPlayers?.filter(p => p.team === tCode) || [];
                    if (teamPlayers.length === 0) return;

                    // Identity: First player is leader, rest are members
                    const leader = teamPlayers[0];
                    const members = teamPlayers.slice(1).map(p => p.uid).sort();
                    const teamKey = `${leader.uid}|${members.join(',')}`;

                    const teamName = match.teamNames?.[tCode === 'A' ? 'team1' : 'team2'] || 'Team';
                    const bannerUrl = match.teamBanners?.[tCode === 'A' ? 'team1' : 'team2'] || null;
                    const matchTime = match.verifiedAt?.seconds || (new Date(match.verifiedAt).getTime() / 1000) || 0;

                    if (!winCounts[teamKey]) {
                        winCounts[teamKey] = {
                            teamKey,
                            teamName,
                            bannerUrl,
                            wins: 0,
                            losses: 0,
                            lastUpdated: matchTime,
                            members: teamPlayers.map(p => {
                                const userData = registeredUsers.find(u => u.id === p.uid);
                                return {
                                    uid: p.uid,
                                    displayName: p.auroryPlayerName || p.displayName || userData?.displayName || 'Player',
                                    photoURL: userData?.auroryProfilePicture || userData?.photoURL || null
                                };
                            })
                        };
                    } else {
                        // Update to latest team name and banner if match is newer
                        if (matchTime > winCounts[teamKey].lastUpdated) {
                            winCounts[teamKey].teamName = teamName;
                            winCounts[teamKey].bannerUrl = bannerUrl;
                            winCounts[teamKey].lastUpdated = matchTime;
                        }
                    }

                    if (tCode === match.overallWinner) {
                        winCounts[teamKey].wins += 1;
                    } else {
                        winCounts[teamKey].losses += 1;
                    }
                });

            } else {
                // --- INDIVIDUAL MODE: Use individual battle results ---
                // Iterate through each battle result
                (match.matchResults || []).forEach(result => {
                    if (!result.winner || !result.playerA || !result.playerB) return;

                    // Process Player A
                    const uidA = match.matchPlayers?.find(mp => mp.auroryPlayerId === result.playerA.playerId || mp.displayName === result.playerA.displayName)?.uid;
                    if (uidA) {
                        if (!winCounts[uidA]) {
                            const userData = registeredUsers.find(u => u.id === uidA);
                            winCounts[uidA] = {
                                uid: uidA,
                                displayName: userData?.auroryPlayerName || result.playerA.displayName || userData?.displayName || 'Player',
                                photoURL: userData?.auroryProfilePicture || userData?.photoURL || null,
                                wins: 0,
                                losses: 0
                            };
                        }
                        if (result.winner === 'A') winCounts[uidA].wins += 1;
                        else winCounts[uidA].losses += 1;
                    }

                    // Process Player B
                    const uidB = match.matchPlayers?.find(mp => mp.auroryPlayerId === result.playerB.playerId || mp.displayName === result.playerB.displayName)?.uid;
                    if (uidB) {
                        if (!winCounts[uidB]) {
                            const userData = registeredUsers.find(u => u.id === uidB);
                            winCounts[uidB] = {
                                uid: uidB,
                                displayName: userData?.auroryPlayerName || result.playerB.displayName || userData?.displayName || 'Player',
                                photoURL: userData?.auroryProfilePicture || userData?.photoURL || null,
                                wins: 0,
                                losses: 0
                            };
                        }
                        if (result.winner === 'B') winCounts[uidB].wins += 1;
                        else winCounts[uidB].losses += 1;
                    }
                });
            }
        });

        return Object.values(winCounts)
            .sort((a, b) => b.wins - a.wins || a.losses - b.losses)
            .slice(0, 10);
    }, [matchHistory, registeredUsers, leaderboardMode, selectedMonth]);

    // Discover available months from match history
    const availableMonths = useMemo(() => {
        if (!matchHistory || matchHistory.length === 0) {
            const now = new Date();
            return [`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`];
        }

        const months = new Set();
        const now = new Date();
        const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        months.add(currentMonthKey);

        matchHistory.forEach(match => {
            if (match.verifiedAt) {
                const date = new Date(match.verifiedAt);
                const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
                months.add(key);
            }
        });

        return Array.from(months).sort().reverse();
    }, [matchHistory]);

    // Listen to wallets collection for AURY/USDC leaderboard
    useEffect(() => {
        const walletsRef = collection(db, 'wallets');
        const unsubscribe = onSnapshot(walletsRef, (snapshot) => {
            const walletData = snapshot.docs.map(doc => ({
                id: doc.id,
                balance: doc.data().balance || 0,
                usdcBalance: doc.data().usdcBalance || 0
            }));
            setWallets(walletData);
        }, (err) => {
            console.error('Error listening to wallets:', err);
        });
        return () => unsubscribe();
    }, []);

    // Compute top earners based on selected currency + game filter
    const topEarnersFiltered = useMemo(() => {
        if (!registeredUsers) return [];

        const gameKey = earnersGameFilter; // 'all', 'slotMachine', 'treasureChest'

        return [...registeredUsers]
            .map(u => {
                let value = 0;
                const wallet = wallets.find(w => w.id === u.id);

                if (earnersCurrency === 'valcoins') {
                    if (gameKey === 'all') {
                        // Total Valcoin balance (includes all sources)
                        value = u.points || 0;
                    } else {
                        // Game-specific Valcoin winnings from stats
                        value = u.stats?.miniGames?.[gameKey]?.totalWon?.valcoins || 0;
                    }
                } else if (earnersCurrency === 'aury') {
                    if (gameKey === 'all') {
                        // Total AURY wallet balance (stored in lamports, convert to display)
                        value = wallet ? wallet.balance / 1e9 : 0;
                    } else {
                        // Game-specific AURY winnings from stats
                        value = u.stats?.miniGames?.[gameKey]?.totalWon?.aury || 0;
                    }
                } else if (earnersCurrency === 'usdc') {
                    if (gameKey === 'all') {
                        // Total USDC wallet balance (stored in smallest units)
                        value = wallet ? wallet.usdcBalance / 1e6 : 0;
                    } else {
                        // Game-specific USDC winnings from stats
                        value = u.stats?.miniGames?.[gameKey]?.totalWon?.usdc || 0;
                    }
                }

                return { ...u, earnedValue: value };
            })
            .filter(u => u.earnedValue > 0)
            .sort((a, b) => b.earnedValue - a.earnedValue)
            .slice(0, 10);
    }, [registeredUsers, wallets, earnersCurrency, earnersGameFilter]);

    return {
        matchHistory,
        matchHistoryLoading,
        matchHistoryFilter, setMatchHistoryFilter,
        expandedMatch, setExpandedMatch,
        leaderboardMode, setLeaderboardMode,
        selectedMonth, setSelectedMonth,
        availableMonths,
        topPlayers,
        topEarnersFiltered,
        earnersCurrency, setEarnersCurrency,
        earnersGameFilter, setEarnersGameFilter
    };
};
