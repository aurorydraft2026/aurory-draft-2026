const admin = require('firebase-admin');
const serviceAccount = require('../functions/serviceAccountKey.json'); // Adjust path if needed

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

const categories = {
  NORSE: 'norse',
  CRYPTO: 'crypto',
  AURORY: 'aurory',
  GAMING: 'gaming',
  ASGARD: 'asgard',
  SKILLSETS: 'skillsets',
  EGG_MASTER: 'egg_master',
  PASSIVES: 'passives',
  WHO_AM_I: 'who_am_i'
};

const riddles = [
  // ── AMIKO SKILLSETS (10) ──
  {
    question: "Which one is not part of Axobubbles Skillset?",
    options: ["Volt Surge III", "Reckless Shriek II", "Bubble Chain II", "Sear I"],
    correctIndex: 3,
    category: categories.SKILLSETS,
    difficulty: 'medium',
    enabled: true
  },
  {
    question: "Which one is not part of Keybab Skillset?",
    options: ["Devour III", "Burning Confidence II", "Spice Layer II", "Rest I"],
    correctIndex: 0,
    category: categories.SKILLSETS,
    difficulty: 'medium',
    enabled: true
  },
  {
    question: "Which one is not part of Bitebit Skillset?",
    options: ["Energetic Jba I", "Volt Surge III", "Flash Step I", "Devour III"],
    correctIndex: 1,
    category: categories.SKILLSETS,
    difficulty: 'hard',
    enabled: true
  },
  {
    question: "Which one is not part of Dracurve Skillset?",
    options: ["Draconic Roar II", "Clear Sky II", "Scorching Bite II", "Burning Confidence II"],
    correctIndex: 3,
    category: categories.SKILLSETS,
    difficulty: 'hard',
    enabled: true
  },
  {
    question: "Which one is not part of Dodorex Skillset?",
    options: ["Dumb Kick I", "Prime Target II", "Flash Step I", "PayBack II"],
    correctIndex: 2,
    category: categories.SKILLSETS,
    difficulty: 'medium',
    enabled: true
  },
  {
    question: "Which one is not part of Unikirin Skillset?",
    options: ["Recharge I", "Draconic Roar II", "Fulgurous Steps I", "Flamethrower I"],
    correctIndex: 1,
    category: categories.SKILLSETS,
    difficulty: 'hard',
    enabled: true
  },
  {
    question: "Which one is not part of Cybertooth Skillset?",
    options: ["Sandering Fang I", "Flowing Strike I", "Aqua Bolt I", "Shattering Wind II"],
    correctIndex: 0,
    category: categories.SKILLSETS,
    difficulty: 'hard',
    enabled: true
  },
  {
    question: "Which one is not part of Walpuff Skillset?",
    options: ["Wingblade II", "Headbutt II", "Stone Skin I", "Dumb Kick I"],
    correctIndex: 3,
    category: categories.SKILLSETS,
    difficulty: 'medium',
    enabled: true
  },
  {
    question: "Which one is not part of Dinotusk Skillset?",
    options: ["Shared Fate III", "Headbutt II", "NoPain, No Gain I", "Peak State I"],
    correctIndex: 1,
    category: categories.SKILLSETS,
    difficulty: 'hard',
    enabled: true
  },
  {
    question: "Which one is not part of Zzoo Skillset?",
    options: ["Flint Snap II", "Mirror Coat II", "Clear Sky II", "Talon Guard I"],
    correctIndex: 2,
    category: categories.SKILLSETS,
    difficulty: 'medium',
    enabled: true
  },

  // ── WHO AM I? (10) ──
  {
    question: "Who Am I?",
    imageUrl: "/amikos/hollowoo.png",
    options: ["Hollowoo", "Ghouliath", "Bloomtail", "Raccoin"],
    correctIndex: 0,
    category: categories.WHO_AM_I,
    difficulty: 'easy',
    enabled: true
  },
  {
    question: "Who Am I?",
    imageUrl: "/amikos/dodorex.png",
    options: ["Chocorex", "Dodorex", "Dinobit", "Keybab"],
    correctIndex: 1,
    category: categories.WHO_AM_I,
    difficulty: 'easy',
    enabled: true
  },
  {
    question: "Who Am I?",
    imageUrl: "/amikos/tokoma.png",
    options: ["Dinotusk", "Tokoma", "Zzoo", "Unikirin"],
    correctIndex: 1,
    category: categories.WHO_AM_I,
    difficulty: 'easy',
    enabled: true
  },
  {
    question: "Who Am I?",
    imageUrl: "/amikos/ghouliath.png",
    options: ["Wassie", "Hollowoo", "Walpuff", "Ghouliath"],
    correctIndex: 3,
    category: categories.WHO_AM_I,
    difficulty: 'easy',
    enabled: true
  },
  {
    question: "Who Am I?",
    imageUrl: "/amikos/bloomtail.png",
    options: ["Lucky", "Axobubble", "N9", "Bloomtail"],
    correctIndex: 3,
    category: categories.WHO_AM_I,
    difficulty: 'easy',
    enabled: true
  },
  {
    question: "Who Am I?",
    imageUrl: "/amikos/oogrock.png",
    options: ["Cybertooth", "Oogrock", "Dinotusk", "Tokoma"],
    correctIndex: 1,
    category: categories.WHO_AM_I,
    difficulty: 'medium',
    enabled: true
  },
  {
    question: "Who Am I?",
    imageUrl: "/amikos/znix.png",
    options: ["Bitebit", "Znix", "Walpuff", "Dipking"],
    correctIndex: 1,
    category: categories.WHO_AM_I,
    difficulty: 'hard',
    enabled: true
  },
  {
    question: "Who Am I?",
    imageUrl: "/amikos/raccoin.png",
    options: ["Unika", "Lucky", "Raccoin", "Shibark"],
    correctIndex: 2,
    category: categories.WHO_AM_I,
    difficulty: 'easy',
    enabled: true
  },
  {
    question: "Who Am I?",
    imageUrl: "/amikos/shiba-ignite.png",
    options: ["Shiba", "Shiba Ignite", "Dracurve", "Unika"],
    correctIndex: 2,
    category: categories.WHO_AM_I,
    difficulty: 'medium',
    enabled: true
  },
  {
    question: "Who Am I?",
    imageUrl: "/amikos/dinobit.png",
    options: ["Dinobit", "Dinotusk", "Dodorex", "Raccoin"],
    correctIndex: 0,
    category: categories.WHO_AM_I,
    difficulty: 'easy',
    enabled: true
  },

  // ── EGG MASTER (10) ──
  {
    question: "Which egg contains the following Amikos: Lucky, Logator, Bubble Popper?",
    options: ["Zen Egg", "Dune Egg", "Cliff Egg", "Marsh Egg"],
    correctIndex: 0,
    category: categories.EGG_MASTER,
    difficulty: 'medium',
    enabled: true
  },
  {
    question: "Which egg contains Beeblock, Chocorex, and Keybab?",
    options: ["Dune Egg", "Frost Egg", "Volatile Egg", "Zen Egg"],
    correctIndex: 0,
    category: categories.EGG_MASTER,
    difficulty: 'medium',
    enabled: true
  },
  {
    question: "Which egg contains Raccoin, Shibark, and Unikirin?",
    options: ["Marsh Egg", "Aurora Egg", "Zen Egg", "Cliff Egg"],
    correctIndex: 3,
    category: categories.EGG_MASTER,
    difficulty: 'medium',
    enabled: true
  },
  {
    question: "Which egg contains Chocomint, Ghouliath, and Walpuff?",
    options: ["Aurora Egg", "Frost Egg", "Marsh Egg", "Volatile Egg"],
    correctIndex: 0,
    category: categories.EGG_MASTER,
    difficulty: 'medium',
    enabled: true
  },
  {
    question: "Which egg contains Cybertooth, Dinotusk, and Oogrock?",
    options: ["Dune Egg", "Cliff Egg", "Frost Egg", "Aurora Egg"],
    correctIndex: 2,
    category: categories.EGG_MASTER,
    difficulty: 'medium',
    enabled: true
  },
  {
    question: "Which egg does Dipking belong to?",
    options: ["Volatile Egg", "Marsh Egg", "Zen Egg", "Coco Egg"],
    correctIndex: 0,
    category: categories.EGG_MASTER,
    difficulty: 'hard',
    enabled: true
  },
  {
    question: "Which egg contains the Matriarch Bloomtail?",
    options: ["Bloomer Egg", "Marsh Egg", "Zen Egg", "Aurora Egg"],
    correctIndex: 0,
    category: categories.EGG_MASTER,
    difficulty: 'hard',
    enabled: true
  },
  {
    question: "Which egg contains Dinobit, Raccoin, and Wassie?",
    options: ["Dune Egg", "Moss Egg", "Zen Egg", "Marsh Egg"],
    correctIndex: 1,
    category: categories.EGG_MASTER,
    difficulty: 'medium',
    enabled: true
  },
  {
    question: "Which egg contains Axobubble, Bloomtail, and N9?",
    options: ["Zen Egg", "Aurora Egg", "Marsh Egg", "Cliff Egg"],
    correctIndex: 2,
    category: categories.EGG_MASTER,
    difficulty: 'medium',
    enabled: true
  },
  {
    question: "Which egg contains Dodorex?",
    options: ["Coco Egg", "Zen Egg", "Cliff Egg", "Marsh Egg"],
    correctIndex: 0,
    category: categories.EGG_MASTER,
    difficulty: 'hard',
    enabled: true
  },

  // ── PASSIVE EFFECTS (10) ──
  {
    question: "What is the Passive Skill of Pandata?",
    options: ["Crabby", "Wash It Down", "Maintenance", "Power Nap"],
    correctIndex: 2,
    category: categories.PASSIVES,
    difficulty: 'medium',
    enabled: true
  },
  {
    question: "What is the Passive Skill of Bubble Popper?",
    options: ["Hexdrinker", "Crabby", "Maintenance", "Second Wind"],
    correctIndex: 1,
    category: categories.PASSIVES,
    difficulty: 'medium',
    enabled: true
  },
  {
    question: "What is the Passive Skill of Block Choy?",
    options: ["Maintenance", "Power Nap", "Wash it Down", "Scarecrow"],
    correctIndex: 2,
    category: categories.PASSIVES,
    difficulty: 'medium',
    enabled: true
  },
  {
    question: "What is the Passive Skill of Raccoin?",
    options: ["Maintenance", "Power Nap", "Hexdrinker", "Swan Song"],
    correctIndex: 1,
    category: categories.PASSIVES,
    difficulty: 'medium',
    enabled: true
  },
  {
    question: "What is the Passive Skill of Number 9?",
    options: ["Hexdrinker", "Scarecrow", "Insulated", "Eye of the Storm"],
    correctIndex: 0,
    category: categories.PASSIVES,
    difficulty: 'hard',
    enabled: true
  },
  {
    question: "What does the 'Swan Song' effect do?",
    options: [
      "After each action, if this Amiko is Cursed, +1 Mana",
      "Heal 7% Max HP on Unlucky Hit",
      "Shadowbind Opponent when swapping in",
      "Starts battle with +5 Lightning Resistance"
    ],
    correctIndex: 0,
    category: categories.PASSIVES,
    difficulty: 'hard',
    enabled: true
  },
  {
    question: "What does the 'Insulated' effect do?",
    options: [
      "Starts battle with +5 Lightning Resistance (Infinite) & Uncleansable",
      "When hit by Lightning, Opponent Attack -2 (4 turns)",
      "Heal 7% Max HP on Unlucky Hit",
      "After each action, if Cursed, +1 Mana"
    ],
    correctIndex: 0,
    category: categories.PASSIVES,
    difficulty: 'hard',
    enabled: true
  },
  {
    question: "What does the 'Eye of the Storm' effect do?",
    options: [
      "Starts battle with +5 Lightning Resistance",
      "Shadowbind Opponent on swap in",
      "When hit by Lightning, Opponent Atk -2 & Ether Atk -2 (4 turns)",
      "+1 Mana after each action if Cursed"
    ],
    correctIndex: 2,
    category: categories.PASSIVES,
    difficulty: 'hard',
    enabled: true
  },
  {
    question: "What does the 'Scarecrow' effect do?",
    options: [
      "Every time this Amiko Swaps in, Shadowbind Opponent (2 turns)",
      "When hit by Lightning, Opponent Attack -2 (4 turns)",
      "Heal 7% Max HP on Unlucky Hit",
      "Starts battle with +5 Lightning Resistance"
    ],
    correctIndex: 0,
    category: categories.PASSIVES,
    difficulty: 'hard',
    enabled: true
  },
  {
    question: "What does the 'Second Wind' effect do?",
    options: [
      "Every time this Amiko Unlucky Hits, Heal 7% Max HP",
      "After each action, if Cursed, +1 Mana",
      "Starts battle with +5 Lightning Resistance",
      "Shadowbind Opponent when swapping in"
    ],
    correctIndex: 0,
    category: categories.PASSIVES,
    difficulty: 'hard',
    enabled: true
  }
];

async function seed() {
  console.log(`🚀 Starting to seed ${riddles.length} new riddles...`);
  let count = 0;
  for (const riddle of riddles) {
    try {
      await db.collection('riddles').add({
        ...riddle,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      count++;
      if (count % 5 === 0) console.log(`✅ Seeded ${count}/${riddles.length}...`);
    } catch (e) {
      console.error(`❌ Failed to seed riddle: ${riddle.question}`, e);
    }
  }
  console.log(`✨ Successfully seeded ${count} riddles!`);
  process.exit(0);
}

seed();
