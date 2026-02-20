import { useState, useEffect, useMemo } from 'react';
import { fetchVerifiedMatches, scanAndVerifyCompletedDrafts } from '../services/matchVerificationService';

export const useLeaderboard = (registeredUsers) => {
    const [matchHistory, setMatchHistory] = useState([]);
    const [matchHistoryLoading, setMatchHistoryLoading] = useState(true);
    const [matchHistoryFilter, setMatchHistoryFilter] = useState('all'); // 'all', 'mode1', 'mode2', 'mode3'
    const [expandedMatch, setExpandedMatch] = useState(null); // draftId of expanded match
    const [leaderboardMode, setLeaderboardMode] = useState('individual'); // 'individual' or 'team'

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

        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();

        const winCounts = {}; // uid -> { wins, losses, displayName, photoURL }

        matchHistory.forEach(match => {
            // Filter to current month only
            if (match.verifiedAt) {
                const matchDate = new Date(match.verifiedAt);
                if (matchDate.getMonth() !== currentMonth || matchDate.getFullYear() !== currentYear) return;
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
    }, [matchHistory, registeredUsers, leaderboardMode]);

    return {
        matchHistory,
        matchHistoryLoading,
        matchHistoryFilter, setMatchHistoryFilter,
        expandedMatch, setExpandedMatch,
        leaderboardMode, setLeaderboardMode,
        topPlayers
    };
};
