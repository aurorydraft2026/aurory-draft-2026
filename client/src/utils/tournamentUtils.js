/**
 * Tournament Utilities for Asgard
 * Generates brackets and fixtures for various tournament types.
 */

/**
 * Generates a Single Elimination bracket.
 * @param {Array} participants - List of UIDs or Team Objects
 * @returns {Object} - Bracket structure with rounds and matches
 */
/**
 * Generates a Single Elimination bracket using a binary tree structure.
 * Each node represents a match, and winners propagate upward.
 * @param {Array} participants - List of UIDs or Team Objects
 * @returns {Array} - Flattened rounds array for UI compatibility
 */
export const generateSingleElimination = (participants) => {
    const shuffled = [...participants].sort(() => Math.random() - 0.5);
    const count = shuffled.length;
    if (count < 2) return [];

    // Calculate depth (number of rounds)
    const totalRounds = Math.ceil(Math.log2(count));
    const totalSlots = Math.pow(2, totalRounds);

    let matchCounter = 1;
    const allMatches = [];

    /**
     * Recursively builds the bracket tree with coordinate slots.
     * @param {Array} players - List of players in this subtree
     * @param {number} round - Current round index
     * @param {number} slotOffset - Vertical slot starting point
     * @param {number} slotSpan - Vertical slots covered by this subtree
     */
    const buildNode = (players, round, slotOffset, slotSpan) => {
        if (players.length === 1) {
            return {
                player: players[0],
                y: slotOffset + (slotSpan / 2)
            };
        }

        const mid = Math.ceil(players.length / 2);
        const leftPlayers = players.slice(0, mid);
        const rightPlayers = players.slice(mid);

        // Calculate spans proportionally
        const subSpan = slotSpan / 2;
        const leftSource = buildNode(leftPlayers, round - 1, slotOffset, subSpan);
        const rightSource = buildNode(rightPlayers, round - 1, slotOffset + subSpan, subSpan);

        const matchId = `r${round}-m${matchCounter++}`;
        const match = {
            id: matchId,
            player1: leftSource.player || null,
            player2: rightSource.player || null,
            winner: null,
            prevMatches: [],
            roundIndex: round - 1,
            y: slotOffset + (slotSpan / 2),
            slotSpan: slotSpan
        };

        // If a source is a match, link it
        if (leftSource.id) {
            match.prevMatches.push(leftSource.id);
            leftSource.parentMatchId = matchId;
            leftSource.parentSide = 'player1';
            leftSource.parentY = match.y;
        }
        if (rightSource.id) {
            match.prevMatches.push(rightSource.id);
            rightSource.parentMatchId = matchId;
            rightSource.parentSide = 'player2';
            rightSource.parentY = match.y;
        }

        allMatches.push(match);
        return match;
    };

    // Build the tree
    buildNode(shuffled, totalRounds, 0, totalSlots);

    // Group matches into rounds
    const rounds = [];
    for (let i = 0; i < totalRounds; i++) {
        const roundMatches = allMatches.filter(m => m.roundIndex === i);
        roundMatches.sort((a, b) => a.y - b.y);

        const isLastRound = i === totalRounds - 1;
        const isSemiFinals = i === totalRounds - 2;

        rounds.push({
            id: `round-${i + 1}`,
            title: isLastRound ? 'Grand Final' : (isSemiFinals ? 'Semifinals' : (totalRounds - i === 3 ? 'Quarterfinals' : `Round ${i + 1}`)),
            matches: roundMatches
        });
    }

    // 3rd Place Match Logic (Losers of Semifinals)
    if (count >= 4) {
        const finalRound = rounds[rounds.length - 1];
        const semifinals = rounds[rounds.length - 2];
        const grandFinal = finalRound.matches[0];

        if (semifinals && finalRound && grandFinal) {
            const thirdPlaceMatch = {
                id: `r${totalRounds}-m-third`,
                player1: null,
                player2: null,
                winner: null,
                prevMatches: semifinals.matches.map(m => m.id),
                isThirdPlaceMatch: true,
                title: '3rd Place Match',
                roundIndex: totalRounds - 1,
                y: grandFinal.y + 1.2 // Distance below Grand Final (closer than 1.5)
            };

            // Mark source matches for loser propagation
            semifinals.matches.forEach((m, idx) => {
                m.thirdPlaceParentId = thirdPlaceMatch.id;
                m.thirdPlaceParentSide = idx === 0 ? 'player1' : 'player2';
            });

            finalRound.matches.push(thirdPlaceMatch);
        }
    }

    return { rounds, totalSlots };
};

/**
 * Generates Round Robin fixtures using the Berger Table algorithm.
 * @param {Array} participants - List of UIDs or Team Objects
 * @returns {Array} - List of rounds, each containing matches
 */
export const generateRoundRobin = (participants) => {
    let teams = [...participants];
    if (teams.length % 2 !== 0) {
        teams.push(null); // Add a "BYE" team
    }

    const n = teams.length;
    const roundsCount = n - 1;
    const matchesPerRound = n / 2;
    const rounds = [];

    for (let j = 0; j < roundsCount; j++) {
        const matches = [];
        for (let i = 0; i < matchesPerRound; i++) {
            const home = teams[i];
            const away = teams[n - 1 - i];

            if (home !== null && away !== null) {
                matches.push({
                    id: `r${j + 1}-m${i + 1}`,
                    player1: home,
                    player2: away,
                    winner: null
                });
            }
        }
        rounds.push({
            id: `round-${j + 1}`,
            title: `Round ${j + 1}`,
            matches: matches
        });

        // Rotate teams (keep first team fixed, rotate others)
        teams.splice(1, 0, teams.pop());
    }

    return rounds;
};

/**
 * Generates a Two-Phase Realm Round Robin tournament.
 * Phase 1: Teams split into "Realm of Frost" and "Realm of Fire" for intra-group round robin.
 * Phase 2: Top 2 per realm advance to "The Throne of Valhalla" 4-team round robin.
 *
 * @param {Array} participants - List of Team Objects (must be even, minimum 4)
 * @returns {Object} - { realms: { frost, fire }, groupStructure: { frost, fire } }
 */
export const generateRealmRoundRobin = (participants) => {
    if (participants.length < 4) {
        throw new Error('Realm Round Robin requires at least 4 participants.');
    }

    // Shuffle randomly
    const shuffled = [...participants].sort(() => Math.random() - 0.5);

    // Split into two equal groups
    const half = Math.ceil(shuffled.length / 2);
    const frost = shuffled.slice(0, half);
    const fire = shuffled.slice(half);

    // Generate round robin fixtures for each realm
    const frostRounds = generateRoundRobin(frost);
    const fireRounds = generateRoundRobin(fire);

    // Prefix round IDs to avoid collisions
    frostRounds.forEach((round, i) => {
        round.id = `frost-${round.id}`;
        round.title = `Frost Round ${i + 1}`;
        round.realm = 'frost';
        round.matches.forEach(m => { m.id = `frost-${m.id}`; m.realm = 'frost'; });
    });
    fireRounds.forEach((round, i) => {
        round.id = `fire-${round.id}`;
        round.title = `Fire Round ${i + 1}`;
        round.realm = 'fire';
        round.matches.forEach(m => { m.id = `fire-${m.id}`; m.realm = 'fire'; });
    });

    return {
        realms: { frost, fire },
        groupStructure: { frost: frostRounds, fire: fireRounds }
    };
};

/**
 * Generates the Finals Single Elimination bracket ("Throne of Valhalla") for the top 4 teams.
 * Includes Semifinals, Grand Finals, and a 3rd Place Match.
 * @param {Array} top4Teams - Array of 4 team objects [Frost#1, Frost#2, Fire#1, Fire#2]
 * @returns {Array} - Rounds structure for SE finals
 */
export const generateFinalsSingleElimination = (top4Teams) => {
    // Standard 4-player bracket logic
    // Seeding: 
    // SF 1: Frost #1 (0) vs Fire #2 (3)
    // SF 2: Fire #1 (2) vs Frost #2 (1)
    const seededParticipants = [top4Teams[0], top4Teams[3], top4Teams[2], top4Teams[1]];

    const semifinalMatches = [
        {
            id: 'finals-r1-m1',
            player1: seededParticipants[0],
            player2: seededParticipants[1],
            winner: null,
            phase: 'finals',
            title: 'Semifinals 1',
            roundIndex: 0,
            y: 1.0,
            slotSpan: 2,
            parentMatchId: 'finals-r2-m1',
            parentSide: 'player1',
            parentY: 2.0,
            thirdPlaceParentId: 'finals-r2-m2',
            thirdPlaceParentSide: 'player1'
        },
        {
            id: 'finals-r1-m2',
            player1: seededParticipants[2],
            player2: seededParticipants[3],
            winner: null,
            phase: 'finals',
            title: 'Semifinals 2',
            roundIndex: 0,
            y: 3.0,
            slotSpan: 2,
            parentMatchId: 'finals-r2-m1',
            parentSide: 'player2',
            parentY: 2.0,
            thirdPlaceParentId: 'finals-r2-m2',
            thirdPlaceParentSide: 'player2'
        }
    ];

    const finalMatch = {
        id: 'finals-r2-m1',
        player1: null,
        player2: null,
        winner: null,
        phase: 'finals',
        title: 'Grand Finals',
        prevMatches: ['finals-r1-m1', 'finals-r1-m2'],
        roundIndex: 1,
        y: 2.0,
        slotSpan: 4
    };

    const thirdPlaceMatch = {
        id: 'finals-r2-m2',
        player1: null,
        player2: null,
        winner: null,
        phase: 'finals',
        title: '3rd Place Match',
        prevMatches: ['finals-r1-m1', 'finals-r1-m2'],
        isThirdPlaceMatch: true,
        roundIndex: 1,
        y: 3.2, // Positions it closer to the Grand Final (2.0 + 1.2)
        slotSpan: 4
    };

    return [
        {
            id: 'finals-round-1',
            title: 'Semifinals',
            phase: 'finals',
            matches: semifinalMatches
        },
        {
            id: 'finals-round-2',
            title: 'Finals',
            phase: 'finals',
            matches: [finalMatch, thirdPlaceMatch]
        }
    ];
};

/**
 * Calculate final standings for the Single Elimination finals with 3rd place match.
 * @param {Array} finalsStructure - The rounds and matches of the finals
 * @returns {Array} - Ranked teams
 */
export const calculateFinalsStandings = (finalsStructure) => {
    const round2 = finalsStructure.find(r => r.id === 'finals-round-2');
    if (!round2) return [];

    const grandFinal = round2.matches[0];
    const thirdPlace = round2.matches[1];

    const standings = [];

    const getTeamId = (p) => p?.leader || p?.uid || p;

    // 1st & 2nd from Grand Final
    if (grandFinal.winner) {
        const winnerId = grandFinal.winner;
        const winnerObj = getTeamId(grandFinal.player1) === winnerId ? grandFinal.player1 : grandFinal.player2;
        const loserObj = getTeamId(grandFinal.player1) === winnerId ? grandFinal.player2 : grandFinal.player1;

        standings.push({ rank: 1, team: winnerObj, teamId: winnerId });
        standings.push({ rank: 2, team: loserObj, teamId: getTeamId(loserObj) });
    }

    // 3rd & 4th from 3rd Place Match (or SF losers if match not yet resolved)
    if (thirdPlace && thirdPlace.winner) {
        const winnerId = thirdPlace.winner;
        const winnerObj = getTeamId(thirdPlace.player1) === winnerId ? thirdPlace.player1 : thirdPlace.player2;
        const loserObj = getTeamId(thirdPlace.player1) === winnerId ? thirdPlace.player2 : thirdPlace.player1;

        standings.push({ rank: 3, team: winnerObj, teamId: winnerId });
        standings.push({ rank: 4, team: loserObj, teamId: getTeamId(loserObj) });
    }

    return standings;
};

/**
 * Calculate round robin standings from match results.
 * Uses football-style scoring: Win = 3pts, Draw = 1pt, Loss = 0pts.
 * @param {Array} teams - Array of team objects in the group
 * @param {Array} rounds - Round robin rounds with match results
 * @param {string} format - 'teams' or 'individual'
 * @param {Object} playerScores - Map of uid to points (optional, used for battle-based scoring)
 * @returns {Array} - Sorted standings [{ team, wins, draws, losses, points, played }]
 */
export const calculateRoundRobinStandings = (teams, rounds, format = 'teams', playerScores = null) => {
    const getTeamId = (p) => {
        if (!p) return null;
        return format === 'teams' ? p.leader : (p.uid || p);
    };

    const standings = {};
    teams.forEach(team => {
        const id = getTeamId(team);

        let initialPoints = 0;
        if (playerScores && format === 'teams') {
            const allUids = [team.leader, ...(team.members || [])].filter(Boolean);
            allUids.forEach(uid => {
                initialPoints += (playerScores[uid] || 0);
            });
        } else if (playerScores && id) {
            initialPoints = playerScores[id] || 0;
        }

        standings[id] = {
            team,
            teamId: id,
            wins: 0,
            draws: 0,
            losses: 0,
            points: initialPoints,
            played: 0,
            battleWins: 0,
            battleLosses: 0
        };
    });

    rounds.forEach(round => {
        round.matches.forEach(match => {
            if (!match.winner) return; // Skip unresolved

            const p1Id = getTeamId(match.player1);
            const p2Id = getTeamId(match.player2);
            if (!p1Id || !p2Id) return;
            if (!standings[p1Id] || !standings[p2Id]) return;

            standings[p1Id].played++;
            standings[p2Id].played++;

            if (match.winner === 'draw') {
                standings[p1Id].draws++;
                standings[p2Id].draws++;
                if (!playerScores) {
                    standings[p1Id].points += 1;
                    standings[p2Id].points += 1;
                }
            } else if (match.winner === p1Id) {
                standings[p1Id].wins++;
                standings[p2Id].losses++;
                if (!playerScores) standings[p1Id].points += 3;
            } else if (match.winner === p2Id) {
                standings[p2Id].wins++;
                standings[p1Id].losses++;
                if (!playerScores) standings[p2Id].points += 3;
            }

            // Track battle score if available
            if (match.score) {
                const [a, b] = match.score.split('-').map(Number);
                standings[p1Id].battleWins += a || 0;
                standings[p1Id].battleLosses += b || 0;
                standings[p2Id].battleWins += b || 0;
                standings[p2Id].battleLosses += a || 0;
            }
        });
    });

    // Sort: points desc → battle wins desc → battle diff desc
    return Object.values(standings).sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        if (b.battleWins !== a.battleWins) return b.battleWins - a.battleWins;
        return (b.battleWins - b.battleLosses) - (a.battleWins - a.battleLosses);
    });
};
