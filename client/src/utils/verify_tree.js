
import { generateSingleElimination } from './tournamentUtils.js';

function testTree(n) {
    const mock = (id) => ({ uid: `u${id}`, displayName: `P${id}` });
    const players = Array.from({ length: n }, (_, i) => mock(i + 1));
    const rounds = generateSingleElimination(players);

    let totalMatches = 0;
    rounds.forEach(r => totalMatches += r.matches.filter(m => !m.isThirdPlaceMatch).length);

    console.log(`\nN=${n} Players:`);
    console.log(`- Total Rounds: ${rounds.length}`);
    console.log(`- Total Matches (excluding 3rd place): ${totalMatches} (Expected: ${n - 1})`);

    // Check for parent links consistency
    rounds.forEach((round, rIdx) => {
        round.matches.forEach(m => {
            if (m.parentMatchId && !m.isThirdPlaceMatch) {
                const nextRound = rounds[rIdx + 1];
                const parentMatch = nextRound?.matches.find(pm => pm.id === m.parentMatchId);
                if (!parentMatch) {
                    console.error(`  [ERROR] Match ${m.id} has invalid parentMatchId ${m.parentMatchId}`);
                }
            }
        });
    });
}

[2, 3, 4, 5, 8, 13, 16].forEach(testTree);
