/**
 * draftData.ts
 * Shared constants for Cloud Functions - mirrors the client-side amikos.js
 * Only includes what the server needs (IDs and pick orders)
 */

// All 27 Amiko IDs (must stay in sync with client amikos.js)
export const AMIKO_IDS: string[] = [
  'axobubble', 'beeblock', 'bitebit', 'block-choy', 'bloomtail',
  'chocomint', 'chocorex', 'cybertooth', 'dinobit', 'dinotusk',
  'dipking', 'dodorex', 'dracurve', 'ghouliath', 'hollowoo',
  'keybab', 'number-9', 'oogrock', 'raccoin', 'shiba-ignite',
  'shibark', 'tokoma', 'unika', 'unikirin', 'walpuff',
  'wassie', 'zzoo'
];

// Pick order definitions (mirrors client-side getPICK_ORDER)
export interface PhaseConfig {
  team: string;
  count: number;
  label: string;
  simultaneous?: boolean;
  picksPerPlayer?: number;
  isBan?: boolean;
}

export const PICK_ORDER_MODE_1: PhaseConfig[] = [
  { team: 'A', count: 3, label: 'Phase 1: Team A - Player 1 (3 picks)' },
  { team: 'B', count: 6, label: 'Phase 2: Team B - Players 1 & 2 (6 picks)' },
  { team: 'A', count: 6, label: 'Phase 3: Team A - Players 2 & 3 (6 picks)' },
  { team: 'B', count: 3, label: 'Phase 4: Team B - Player 3 (3 picks)' }
];

export const PICK_ORDER_MODE_2: PhaseConfig[] = [
  { team: 'A', count: 1, label: 'Phase 1: Team A (1 pick)' },
  { team: 'B', count: 2, label: 'Phase 2: Team B (2 picks)' },
  { team: 'A', count: 2, label: 'Phase 3: Team A (2 picks)' },
  { team: 'B', count: 2, label: 'Phase 4: Team B (2 picks)' },
  { team: 'A', count: 2, label: 'Phase 5: Team A (2 picks)' },
  { team: 'B', count: 2, label: 'Phase 6: Team B (2 picks)' },
  { team: 'A', count: 2, label: 'Phase 7: Team A (2 picks)' },
  { team: 'B', count: 2, label: 'Phase 8: Team B (2 picks)' },
  { team: 'A', count: 2, label: 'Phase 9: Team A (2 picks)' },
  { team: 'B', count: 1, label: 'Phase 10: Team B (1 pick)' }
];

export const PICK_ORDER_MODE_3: PhaseConfig[] = [
  { team: 'AB', count: 3, label: '1v1 Draft: Pick 3 Amikos', simultaneous: true, picksPerPlayer: 3 }
];

export const PICK_ORDER_MODE_4: PhaseConfig[] = [
  // Ban phases (0-3): A bans 1, B bans 2, A bans 2, B bans 1
  { team: 'A', count: 1, label: 'Ban Phase 1: Player 1 — Ban 1 Amiko', isBan: true },
  { team: 'B', count: 2, label: 'Ban Phase 2: Player 2 — Ban 2 Amikos', isBan: true },
  { team: 'A', count: 2, label: 'Ban Phase 3: Player 1 — Ban 2 Amikos', isBan: true },
  { team: 'B', count: 1, label: 'Ban Phase 4: Player 2 — Ban 1 Amiko', isBan: true },
  // Pick phases (4-7): B picks 1, A picks 2, B picks 2, A picks 1
  { team: 'B', count: 1, label: 'Pick Phase 1: Player 2 — Pick 1 Amiko' },
  { team: 'A', count: 2, label: 'Pick Phase 2: Player 1 — Pick 2 Amikos' },
  { team: 'B', count: 2, label: 'Pick Phase 3: Player 2 — Pick 2 Amikos' },
  { team: 'A', count: 1, label: 'Pick Phase 4: Player 1 — Pick 1 Amiko' }
];

export function getPICK_ORDER(draftType: string): PhaseConfig[] {
  if (draftType === 'mode4') return PICK_ORDER_MODE_4;
  if (draftType === 'mode3') return PICK_ORDER_MODE_3;
  if (draftType === 'mode2') return PICK_ORDER_MODE_2;
  return PICK_ORDER_MODE_1;
}

/**
 * Fisher-Yates shuffle (unbiased)
 */
export function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}