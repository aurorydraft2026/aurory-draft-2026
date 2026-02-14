export const DRAFT_RULES = {
    mode1: {
        title: "3v3 Swiss Draft (Standard)",
        description: "A competitive 3v3 draft where two teams of three players each take turns picking Amikos using a balanced pick order.",
        rules: [
            {
                id: 1,
                title: "Team Structure",
                content: "Two teams (A and B), each consisting of three players. One leader per team oversees the draft."
            },
            {
                id: 2,
                title: "Swiss Pick Order",
                content: "Teams take turns picking Amikos according to a pre-set balanced sequence to ensure fairness (e.g., 1-2-2-1)."
            },
            {
                id: 3,
                title: "Unique Selections",
                content: "Once an Amiko is selected, it is locked for that team. Mirror picks (same Amiko on both teams) are not allowed."
            },
            {
                id: 4,
                title: "Draft Completion",
                content: "The draft is complete once all 6 players (3 per team) have their required Amikos assigned."
            },
            {
                id: 5,
                title: "Match Verification",
                content: "Players must use the provided Battle Codes in-game. Results are automatically verified via the Aurory API."
            }
        ]
    },
    mode2: {
        title: "3v3 Swiss Draft (Alternate)",
        description: "An alternate version of the 3v3 Swiss draft with modified picking sequences for different tactical play.",
        rules: [
            {
                id: 1,
                title: "Team Structure",
                content: "3v3 format with Team Leaders managing the picking process for their respective members."
            },
            {
                id: 2,
                title: "Alternate Order",
                content: "Features a specific pick rotation designed for diverse team strategies."
            },
            {
                id: 3,
                title: "No Mirroring",
                content: "All picks are unique across both teams. Strategic blocking is encouraged."
            },
            {
                id: 4,
                title: "Draft Lock",
                content: "Once a pick is confirmed, it cannot be changed. Ensure your selection is final before locking."
            },
            {
                id: 5,
                title: "Match Verification",
                content: "Battle codes are required for all three matches. All results must be verified for the payout to trigger."
            }
        ]
    },
    mode3: {
        title: "1v1 Random Pool Draft",
        description: "A fast-paced 1v1 mode where players pick from private, randomized pools of Amikos.",
        rules: [
            {
                id: 1,
                title: "Randomized Pools",
                content: "Each player is assigned a unique, random pool of 8 Amikos at the start of the draft."
            },
            {
                id: 2,
                title: "Private Selection",
                content: "Players cannot see the opponent's pool or their current picks until the draft is finalized."
            },
            {
                id: 3,
                title: "Simultaneous Picking",
                content: "Both players select 3 Amikos from their respective pools at the same time."
            },
            {
                id: 4,
                title: "Strategic Depth",
                content: "Focus on maximizing the synergy of your specific pool rather than countering the opponent."
            },
            {
                id: 5,
                title: "Quick Start",
                content: "Once both players lock their 3 picks, the battle code is revealed immediately."
            }
        ]
    },
    mode4: {
        title: "1v1 Ban Draft",
        description: "The ultimate 1v1 test. Ban threats from the global pool before drafting your winning team.",
        rules: [
            {
                id: 1,
                title: "Tactical Flip & Choice",
                content: "Starts with a Blue/Red coin roll. The winner chooses their strategic advantage: 1st Ban or 1st Pick."
            },
            {
                id: 2,
                title: "Advanced Ban Phase",
                content: "Each player bans 3 Amikos (1-2-2-1 rotation). Element Rule: You cannot ban more than one Amiko of the same element."
            },
            {
                id: 3,
                title: "Strategic Pick Phase",
                content: "Pick 3 Amikos (1-2-2-1 rotation). The player who did not ban first will pick first."
            },
            {
                id: 4,
                title: "Mirror Pick Allowance",
                content: "Mirror matches are allowed (both players can pick the same Amiko), but you cannot have duplicates on your own team."
            },
            {
                id: 5,
                title: "Winning & Verification",
                content: "Results are automatically verified. The system checks both the winner and the used lineup via the Aurory API."
            }
        ]
    }
};
