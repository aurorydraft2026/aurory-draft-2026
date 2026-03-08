/**
 * Tournament Utilities for Asgard Duels
 * Generates brackets and fixtures for various tournament types.
 */

/**
 * Generates a Single Elimination bracket.
 * @param {Array} participants - List of UIDs or Team Objects
 * @returns {Object} - Bracket structure with rounds and matches
 */
export const generateSingleElimination = (participants) => {
    const shuffled = [...participants].sort(() => Math.random() - 0.5);
    const count = shuffled.length;

    // Calculate next power of 2 for bracket size
    const powerOf2 = Math.pow(2, Math.ceil(Math.log2(count)));

    const rounds = [];
    let currentRoundMatches = [];

    // Round 1 (including BYEs)
    for (let i = 0; i < powerOf2; i += 2) {
        const p1 = shuffled[i] || null;
        const p2 = shuffled[i + 1] || null;

        currentRoundMatches.push({
            id: `r1-m${Math.floor(i / 2) + 1}`,
            player1: p1,
            player2: p2,
            winner: p2 === null ? p1 : (p1 === null ? p2 : null), // Auto-advance if BYE
            isBye: p1 === null || p2 === null
        });
    }

    rounds.push({
        id: 'round-1',
        title: 'Round 1',
        matches: currentRoundMatches
    });

    // Generate subsequent rounds
    let prevMatches = currentRoundMatches;
    let roundNum = 2;
    while (prevMatches.length > 1) {
        const nextMatches = [];
        for (let i = 0; i < prevMatches.length; i += 2) {
            const m1 = prevMatches[i];
            const m2 = prevMatches[i + 1];

            nextMatches.push({
                id: `r${roundNum}-m${Math.floor(i / 2) + 1}`,
                player1: m1.winner || null, // Propagate winner if already decided (e.g. Bye)
                player2: m2.winner || null,
                winner: null,
                prevMatches: [m1.id, m2.id]
            });
        }
        rounds.push({
            id: `round-${roundNum}`,
            title: roundNum === Math.ceil(Math.log2(powerOf2)) ? 'Finals' :
                roundNum === Math.ceil(Math.log2(powerOf2)) - 1 ? 'Semi-Finals' : `Round ${roundNum}`,
            matches: nextMatches
        });
        prevMatches = nextMatches;
        roundNum++;
    }

    return rounds;
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
 * Generates the Finals Round Robin ("Throne of Valhalla") for the top 4 teams.
 * @param {Array} top4Teams - Array of 4 team objects advancing from group stage
 * @returns {Array} - Round robin rounds for the finals
 */
export const generateFinalsRoundRobin = (top4Teams) => {
    const rounds = generateRoundRobin(top4Teams);

    // Relabel rounds for the finals
    rounds.forEach((round, i) => {
        round.id = `finals-${round.id}`;
        round.title = `Valhalla Round ${i + 1}`;
        round.phase = 'finals';
        round.matches.forEach(m => { m.id = `finals-${m.id}`; m.phase = 'finals'; });
    });

    return rounds;
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
