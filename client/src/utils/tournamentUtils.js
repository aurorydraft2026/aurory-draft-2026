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
