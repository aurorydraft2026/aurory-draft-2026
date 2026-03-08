
import { generateSingleElimination } from './tournamentUtils.js';

function testBracket(participants) {
    console.log(`\nTesting with ${participants.length} participants...`);
    const rounds = generateSingleElimination(participants);

    rounds.forEach((round, i) => {
        const winnerCount = round.matches.filter(m => m.winner).length;
        const totalMatches = round.matches.length;
        const thirdPlaceMatch = round.matches.find(m => m.isThirdPlaceMatch);

        console.log(`Round ${i + 1}: ${round.title}`);
        console.log(`  Matches: ${totalMatches} (${winnerCount} auto-resolved)`);
        if (thirdPlaceMatch) {
            console.log(`  [Found 3rd Place Match]`);
        }
    });

    if (rounds.length > 0) {
        const lastRound = rounds[rounds.length - 1];
        console.log(`Final Round Matches: ${lastRound.matches.length}`);
    }
}

try {
    const mock = (id) => ({ uid: `user-${id}`, displayName: `Player ${id}` });

    // Test Case 1: Power of 2 (4 players)
    testBracket([mock(1), mock(2), mock(3), mock(4)]);

    // Test Case 2: Non-Power of 2 (5 players)
    testBracket([mock(1), mock(2), mock(3), mock(4), mock(5)]);

    // Test Case 3: Large bracket (13 players)
    testBracket(Array.from({ length: 13 }, (_, i) => mock(i + 1)));

} catch (err) {
    console.error('Test failed:', err);
}
