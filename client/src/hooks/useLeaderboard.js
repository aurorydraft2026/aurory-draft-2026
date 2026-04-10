import { useState, useEffect, useMemo } from 'react';
import { collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { ref, onValue, query as rtdbQuery, orderByChild, limitToLast } from 'firebase/database';
import { db, database } from '../firebase';
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
    const [earnersGameFilter, setEarnersGameFilter] = useState('wealth'); // 'wealth', 'all', 'slotMachine', 'treasureChest', 'drakkarRace'
    const [earnersTimeframe, setEarnersTimeframe] = useState('all_time'); // 'daily', 'weekly', 'monthly', 'all_time'
    const [topEarners, setTopEarners] = useState([]);
    const [earnersLoading, setEarnersLoading] = useState(false);
    
    
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
            const matchTime = match.verifiedAt || match.createdAt;
            if (matchTime) {
                const matchDate = new Date(matchTime);
                if (matchDate.getMonth() !== targetMonth || matchDate.getFullYear() !== targetYear) return;
            } else {
                return;
            }

            if (!match.overallWinner) return;

            if (leaderboardMode === 'team') {
                // --- TEAM MODE: Group by leader + members set ---
                // Skip 1v1 matches in team leaderboard
                if (match.draftType === 'mode3' || match.draftType === 'mode4') return;

                const teams = ['A', 'B'];
                teams.forEach(tCode => {
                    let teamPlayers = match.matchPlayers?.filter(p => p.team === tCode) || [];
                    
                    // Fallback to finalAssignments for legacy drafts
                    if (teamPlayers.length === 0 && match.finalAssignments) {
                        teamPlayers = match.finalAssignments
                            .filter(a => a.team === tCode)
                            .map(a => ({
                                ...a.participant,
                                uid: a.participant.uid || a.participant.id || null
                            }))
                            .filter(p => p.uid); // Ensure we have a UID
                    }

                    if (teamPlayers.length === 0) return;

                    // Identity: First player is leader, rest are members
                    const leader = teamPlayers[0];
                    const members = teamPlayers.slice(1).map(p => p.uid).sort();
                    const teamKey = `${leader.uid}|${members.join(',')}`;

                    const teamName = match.teamNames?.[tCode === 'A' ? 'team1' : 'team2'] || 'Team';
                    const bannerUrl = match.teamBanners?.[tCode === 'A' ? 'team1' : 'team2'] || null;
                    const matchTimeTs = match.verifiedAt || match.createdAt;
                    const matchTime = matchTimeTs?.seconds || (new Date(matchTimeTs).getTime() / 1000) || 0;

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
                // --- INDIVIDUAL MODE ---
                const is1v1 = match.draftType === 'mode3' || match.draftType === 'mode4';

                if (is1v1) {
                    // For 1v1 matches: use matchPlayers/finalAssignments directly
                    // since matchResults may not contain playerA/playerB objects
                    let teamAPlayers = match.matchPlayers?.filter(p => p.team === 'A') || [];
                    let teamBPlayers = match.matchPlayers?.filter(p => p.team === 'B') || [];

                    // Fallback to finalAssignments
                    if (teamAPlayers.length === 0 && match.finalAssignments) {
                        teamAPlayers = match.finalAssignments
                            .filter(a => a.team === 'A')
                            .map(a => ({ ...a.participant, uid: a.participant.uid || a.participant.id }))
                            .filter(p => p.uid);
                    }
                    if (teamBPlayers.length === 0 && match.finalAssignments) {
                        teamBPlayers = match.finalAssignments
                            .filter(a => a.team === 'B')
                            .map(a => ({ ...a.participant, uid: a.participant.uid || a.participant.id }))
                            .filter(p => p.uid);
                    }

                    const pA = teamAPlayers[0];
                    const pB = teamBPlayers[0];
                    const uidA = pA?.uid || pA?.id;
                    const uidB = pB?.uid || pB?.id;

                    // Record win/loss for player A
                    if (uidA) {
                        if (!winCounts[uidA]) {
                            const userData = registeredUsers.find(u => u.id === uidA);
                            winCounts[uidA] = {
                                uid: uidA,
                                displayName: userData?.auroryPlayerName || pA?.auroryPlayerName || pA?.displayName || userData?.displayName || 'Player',
                                photoURL: userData?.auroryProfilePicture || userData?.photoURL || null,
                                wins: 0,
                                losses: 0
                            };
                        }
                        if (match.overallWinner === 'A') winCounts[uidA].wins += 1;
                        else winCounts[uidA].losses += 1;
                    }

                    // Record win/loss for player B
                    if (uidB) {
                        if (!winCounts[uidB]) {
                            const userData = registeredUsers.find(u => u.id === uidB);
                            winCounts[uidB] = {
                                uid: uidB,
                                displayName: userData?.auroryPlayerName || pB?.auroryPlayerName || pB?.displayName || userData?.displayName || 'Player',
                                photoURL: userData?.auroryProfilePicture || userData?.photoURL || null,
                                wins: 0,
                                losses: 0
                            };
                        }
                        if (match.overallWinner === 'B') winCounts[uidB].wins += 1;
                        else winCounts[uidB].losses += 1;
                    }
                } else {
                    // For 3v3 modes: iterate through each battle result
                    (match.matchResults || []).forEach(result => {
                        if (!result.winner || !result.playerA || !result.playerB) return;

                        // Process Player A (Look in matchPlayers first, then finalAssignments)
                        let pA = match.matchPlayers?.find(mp => mp.auroryPlayerId === result.playerA.playerId || mp.displayName === result.playerA.displayName);
                        if (!pA && match.finalAssignments) {
                            pA = match.finalAssignments.find(a => a.participant?.auroryPlayerId === result.playerA.playerId || a.participant?.displayName === result.playerA.displayName)?.participant;
                        }
                        const uidA = pA?.uid || pA?.id;

                        if (uidA) {
                            if (!winCounts[uidA]) {
                                const userData = registeredUsers.find(u => u.id === uidA);
                                winCounts[uidA] = {
                                    uid: uidA,
                                    displayName: userData?.auroryPlayerName || pA?.displayName || userData?.displayName || 'Player',
                                    photoURL: userData?.auroryProfilePicture || userData?.photoURL || null,
                                    wins: 0,
                                    losses: 0
                                };
                            }
                            if (result.winner === 'A') winCounts[uidA].wins += 1;
                            else winCounts[uidA].losses += 1;
                        }

                        // Process Player B (Look in matchPlayers first, then finalAssignments)
                        let pB = match.matchPlayers?.find(mp => mp.auroryPlayerId === result.playerB.playerId || mp.displayName === result.playerB.displayName);
                        if (!pB && match.finalAssignments) {
                            pB = match.finalAssignments.find(a => a.participant?.auroryPlayerId === result.playerB.playerId || a.participant?.displayName === result.playerB.displayName)?.participant;
                        }
                        const uidB = pB?.uid || pB?.id;

                        if (uidB) {
                            if (!winCounts[uidB]) {
                                const userData = registeredUsers.find(u => u.id === uidB);
                                winCounts[uidB] = {
                                    uid: uidB,
                                    displayName: userData?.auroryPlayerName || pB?.displayName || userData?.displayName || 'Player',
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

    // --- THE NEW LEADERBOARD ENGINE (RTDB + Focus Queries) ---
    useEffect(() => {
        setEarnersLoading(true);

        if (earnersGameFilter === 'wealth') {
            // ─── WEALTH MODE: Direct Firestore Query (Top 10) ───
            const loadWealth = async () => {
                try {
                    if (earnersCurrency === 'valcoins') {
                        const q = query(collection(db, 'users'), orderBy('points', 'desc'), limit(10));
                        const snap = await getDocs(q);
                        const results = snap.docs.map(doc => {
                            const data = doc.data();
                            return {
                                uid: doc.id,
                                ...data,
                                displayName: data.auroryPlayerName || data.displayName || 'Guest',
                                photoURL: data.auroryProfilePicture || data.photoURL || '',
                                earnedValue: data.points || 0
                            };
                        });
                        setTopEarners(results);
                    } else {
                        // AURY/USDC: Query wallets first
                        const field = earnersCurrency === 'aury' ? 'balance' : 'usdcBalance';
                        const wq = query(collection(db, 'wallets'), orderBy(field, 'desc'), limit(10));
                        const wSnap = await getDocs(wq);
                        
                        const results = await Promise.all(wSnap.docs.map(async (wDoc) => {
                            const wData = wDoc.data();
                            const val = earnersCurrency === 'aury' ? (wData.balance || 0) / 1e9 : (wData.usdcBalance || 0) / 1e6;
                            
                            // Find in current registeredUsers list
                            const u = registeredUsers?.find(ru => ru.id === wDoc.id);
                            
                            // Fallback: If not found in memory, we could fetch, but for now just use data if it exists
                            return {
                                uid: wDoc.id,
                                displayName: u?.auroryPlayerName || u?.displayName || 'Guest',
                                photoURL: u?.auroryProfilePicture || u?.photoURL || '',
                                earnedValue: val
                            };
                        }));
                        setTopEarners(results.filter(r => r.earnedValue > 0));
                    }
                } catch (err) {
                    console.error('Wealth query failed:', err);
                } finally {
                    setEarnersLoading(false);
                }
            };
            loadWealth();
            return;
        }

        // ─── EARNINGS MODE: Realtime Database Listeners ───
        const now = new Date();
        let timeframeKey = 'all_time';
        
        if (earnersTimeframe === 'daily') {
            timeframeKey = now.toISOString().split('T')[0];
        } else if (earnersTimeframe === 'monthly') {
            timeframeKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        } else if (earnersTimeframe === 'weekly') {
            const sunday = new Date(now);
            sunday.setDate(now.getDate() - now.getDay());
            timeframeKey = sunday.toISOString().split('T')[0];
        }

        const timeframePath = earnersTimeframe === 'all_time' ? 'all_time' : `${earnersTimeframe}/${timeframeKey}`;
        const path = `leaderboards/earnings/${earnersCurrency}/${earnersGameFilter}/${timeframePath}`;
        
        const leaderboardRef = rtdbQuery(ref(database, path), orderByChild('score'), limitToLast(10));
        
        const unsubscribe = onValue(leaderboardRef, (snapshot) => {
            const data = snapshot.val();
            if (!data) {
                setTopEarners([]);
                setEarnersLoading(false);
                return;
            }

            const list = Object.entries(data)
                .map(([uid, val]) => ({
                    uid,
                    displayName: val.displayName || 'Guest',
                    photoURL: val.photoURL || '',
                    earnedValue: val.score || 0
                }))
                .sort((a, b) => b.earnedValue - a.earnedValue);

            setTopEarners(list);
            setEarnersLoading(false);
        }, (err) => {
            console.error('RTDB Leaderboard error:', err);
            setEarnersLoading(false);
        });

        return () => unsubscribe();
    }, [earnersCurrency, earnersGameFilter, earnersTimeframe, registeredUsers]);

    const topEarnersFiltered = topEarners;

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
        earnersGameFilter, setEarnersGameFilter,
        earnersTimeframe, setEarnersTimeframe,
        earnersLoading
    };
};
