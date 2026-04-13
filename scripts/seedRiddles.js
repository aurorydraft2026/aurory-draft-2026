// Odin's Riddle — Seed Script
// Run: node scripts/seedRiddles.js
// Seeds 60 trivia riddles into Firestore

const admin = require('firebase-admin');
const serviceAccount = require('../functions/lib/serviceAccountKey.json');

// Initialize with your project
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://asgard-duels-default-rtdb.asia-southeast1.firebasedatabase.app"
});

const db = admin.firestore();

const RIDDLES = [
  // ═══════════════════════════════════════════════════════
  //  NORSE MYTHOLOGY (20)
  // ═══════════════════════════════════════════════════════
  { question: "What is the name of the giant tree that connects the nine worlds in Norse mythology?", options: ["Yggdrasil", "Bifröst", "Mjölnir", "Gungnir"], correctIndex: 0, category: "norse", difficulty: "easy" },
  { question: "Who is the ruler of Asgard and the king of the Norse gods?", options: ["Thor", "Loki", "Odin", "Freya"], correctIndex: 2, category: "norse", difficulty: "easy" },
  { question: "What is the name of Thor's legendary hammer?", options: ["Gungnir", "Mjölnir", "Gram", "Tyrfing"], correctIndex: 1, category: "norse", difficulty: "easy" },
  { question: "In Norse mythology, what bridge connects Midgard to Asgard?", options: ["Yggdrasil", "Bifröst", "Hel", "Niflheim"], correctIndex: 1, category: "norse", difficulty: "easy" },
  { question: "Who is the Norse god of mischief and trickery?", options: ["Heimdall", "Tyr", "Loki", "Baldur"], correctIndex: 2, category: "norse", difficulty: "easy" },
  { question: "What are Odin's two ravens called?", options: ["Geri & Freki", "Huginn & Muninn", "Tanngrisnir & Tanngnjóstr", "Skoll & Hati"], correctIndex: 1, category: "norse", difficulty: "medium" },
  { question: "Which realm is the land of the dead in Norse mythology?", options: ["Muspelheim", "Jotunheim", "Helheim", "Svartalfheim"], correctIndex: 2, category: "norse", difficulty: "medium" },
  { question: "What is the name of the great wolf destined to devour Odin at Ragnarök?", options: ["Sköll", "Fenrir", "Jörmungandr", "Nidhogg"], correctIndex: 1, category: "norse", difficulty: "medium" },
  { question: "Who guards the Bifröst bridge?", options: ["Tyr", "Heimdall", "Vidar", "Baldur"], correctIndex: 1, category: "norse", difficulty: "medium" },
  { question: "What is the Norse apocalypse called?", options: ["Valhalla", "Ragnarök", "Götterdämmerung", "Niflheim"], correctIndex: 1, category: "norse", difficulty: "easy" },
  { question: "Odin sacrificed which body part to gain wisdom from Mimir's well?", options: ["His hand", "His eye", "His ear", "His tongue"], correctIndex: 1, category: "norse", difficulty: "medium" },
  { question: "What is the name of Odin's eight-legged horse?", options: ["Arvak", "Sleipnir", "Gulltoppr", "Hofvarpnir"], correctIndex: 1, category: "norse", difficulty: "medium" },
  { question: "Which Norse god sacrificed his hand to bind Fenrir?", options: ["Thor", "Tyr", "Vidar", "Heimdall"], correctIndex: 1, category: "norse", difficulty: "hard" },
  { question: "What creatures does the dragon Nidhogg gnaw at the roots of?", options: ["Bifröst", "Yggdrasil", "Valhalla", "Asgard"], correctIndex: 1, category: "norse", difficulty: "hard" },
  { question: "How many realms are connected by Yggdrasil?", options: ["Seven", "Nine", "Twelve", "Five"], correctIndex: 1, category: "norse", difficulty: "medium" },
  { question: "Who are the Valkyries?", options: ["Odin's wolves", "Choosers of the slain", "Giants from Jotunheim", "Dwarven craftsmen"], correctIndex: 1, category: "norse", difficulty: "easy" },
  { question: "Where do fallen warriors go after death in Norse mythology?", options: ["Helheim", "Midgard", "Valhalla", "Niflheim"], correctIndex: 2, category: "norse", difficulty: "easy" },
  { question: "What is the name of Freya's necklace?", options: ["Draupnir", "Brísingamen", "Gleipnir", "Andvaranaut"], correctIndex: 1, category: "norse", difficulty: "hard" },
  { question: "Which world is the realm of fire in Norse cosmology?", options: ["Niflheim", "Jotunheim", "Muspelheim", "Alfheim"], correctIndex: 2, category: "norse", difficulty: "hard" },
  { question: "What is the Midgard Serpent also known as?", options: ["Fenrir", "Nidhogg", "Jörmungandr", "Surtr"], correctIndex: 2, category: "norse", difficulty: "medium" },

  // ═══════════════════════════════════════════════════════
  //  CRYPTO & BLOCKCHAIN (15)
  // ═══════════════════════════════════════════════════════
  { question: "What is the largest cryptocurrency by market capitalization?", options: ["Ethereum", "Bitcoin", "Solana", "Cardano"], correctIndex: 1, category: "crypto", difficulty: "easy" },
  { question: "What does 'DeFi' stand for?", options: ["Digital Finance", "Decentralized Finance", "Defacto Finance", "Defined Finance"], correctIndex: 1, category: "crypto", difficulty: "easy" },
  { question: "What consensus mechanism does Bitcoin use?", options: ["Proof of Stake", "Proof of Work", "Proof of Authority", "Delegated Proof of Stake"], correctIndex: 1, category: "crypto", difficulty: "medium" },
  { question: "What does NFT stand for?", options: ["Non-Fungible Token", "New Financial Technology", "Network File Transfer", "Non-Fixed Token"], correctIndex: 0, category: "crypto", difficulty: "easy" },
  { question: "What blockchain does Aurory primarily operate on?", options: ["Ethereum", "Polygon", "Solana", "Avalanche"], correctIndex: 2, category: "crypto", difficulty: "easy" },
  { question: "What is a 'smart contract'?", options: ["A legal document", "Self-executing code on blockchain", "A phone contract", "An AI assistant"], correctIndex: 1, category: "crypto", difficulty: "easy" },
  { question: "What does 'HODL' mean in crypto culture?", options: ["Hold On for Dear Life", "High Order Digital Ledger", "Hosted On Distributed Ledger", "Highly Optimized Data Layer"], correctIndex: 0, category: "crypto", difficulty: "easy" },
  { question: "What is a 'gas fee' in blockchain?", options: ["Fuel cost for mining rigs", "Transaction processing cost", "Electricity bill", "Subscription fee"], correctIndex: 1, category: "crypto", difficulty: "medium" },
  { question: "Who created Bitcoin?", options: ["Vitalik Buterin", "Satoshi Nakamoto", "Elon Musk", "Charlie Lee"], correctIndex: 1, category: "crypto", difficulty: "easy" },
  { question: "What is a 'rug pull' in crypto?", options: ["A mining technique", "A scam where developers abandon a project", "A trading strategy", "A wallet backup method"], correctIndex: 1, category: "crypto", difficulty: "medium" },
  { question: "What is the maximum supply of Bitcoin?", options: ["100 million", "21 million", "50 million", "Unlimited"], correctIndex: 1, category: "crypto", difficulty: "medium" },
  { question: "What is a 'DEX'?", options: ["Digital Exchange", "Decentralized Exchange", "Data Exchange", "Derivative Exchange"], correctIndex: 1, category: "crypto", difficulty: "medium" },
  { question: "What year was Bitcoin launched?", options: ["2007", "2009", "2011", "2013"], correctIndex: 1, category: "crypto", difficulty: "hard" },
  { question: "What is 'staking' in cryptocurrency?", options: ["Gambling tokens", "Locking tokens to earn rewards", "Burning tokens", "Trading tokens frequently"], correctIndex: 1, category: "crypto", difficulty: "medium" },
  { question: "What does 'DYOR' mean in crypto?", options: ["Do Your Own Research", "Double Your Own Returns", "Distribute Your Own Resources", "Don't Yield On Requests"], correctIndex: 0, category: "crypto", difficulty: "easy" },

  // ═══════════════════════════════════════════════════════
  //  AURORY & GAMING (15)
  // ═══════════════════════════════════════════════════════
  { question: "What type of game is Aurory?", options: ["Racing game", "Tactical RPG", "First-person shooter", "Puzzle game"], correctIndex: 1, category: "aurory", difficulty: "easy" },
  { question: "On which blockchain was Aurory built?", options: ["Ethereum", "Solana", "BNB Chain", "Polygon"], correctIndex: 1, category: "aurory", difficulty: "easy" },
  { question: "What are the collectible creatures in Aurory called?", options: ["Pokémon", "Nefties", "Axies", "Sprites"], correctIndex: 1, category: "aurory", difficulty: "easy" },
  { question: "What is the native token of the Aurory ecosystem?", options: ["AUR", "AURY", "AURORY", "AOY"], correctIndex: 1, category: "aurory", difficulty: "easy" },
  { question: "What is the PvP mode in Aurory called?", options: ["Arena", "Amiko Legends", "Battle Zone", "Clash Mode"], correctIndex: 1, category: "aurory", difficulty: "medium" },
  { question: "What does 'P2E' stand for in gaming?", options: ["Pay to Enter", "Play to Earn", "Peer to Exchange", "Premium to Experience"], correctIndex: 1, category: "aurory", difficulty: "easy" },
  { question: "What is a 'guild' in online gaming?", options: ["A solo quest", "An organized group of players", "A game difficulty level", "An in-game shop"], correctIndex: 1, category: "aurory", difficulty: "easy" },
  { question: "What does 'GG' mean in gaming?", options: ["Get Going", "Good Game", "Great Graphics", "Game Glitch"], correctIndex: 1, category: "aurory", difficulty: "easy" },
  { question: "What is a 'metaverse'?", options: ["A type of cryptocurrency", "A virtual shared universe", "A gaming console", "A blockchain protocol"], correctIndex: 1, category: "aurory", difficulty: "medium" },
  { question: "In gaming, what does 'PvP' stand for?", options: ["Player vs Player", "Pay vs Play", "Power vs Power", "Prize vs Prize"], correctIndex: 0, category: "aurory", difficulty: "easy" },
  { question: "What does 'FPS' stand for in gaming?", options: ["Free Play System", "Frames Per Second", "First Player Start", "Fast Processing Speed"], correctIndex: 1, category: "aurory", difficulty: "easy" },
  { question: "What is 'minting' in the context of NFTs?", options: ["Mining cryptocurrency", "Creating a new NFT on the blockchain", "Transferring tokens", "Burning an NFT"], correctIndex: 1, category: "aurory", difficulty: "medium" },
  { question: "What type of wallet is commonly used on Solana?", options: ["MetaMask", "Phantom", "Trust Wallet", "Coinbase Wallet"], correctIndex: 1, category: "aurory", difficulty: "medium" },
  { question: "What does 'alpha' mean in gaming community context?", options: ["The first letter", "Early insider information", "A character class", "A game version"], correctIndex: 1, category: "aurory", difficulty: "medium" },
  { question: "What is a 'whitelist' in the NFT space?", options: ["A banned user list", "Priority access to mint/buy", "A list of fake projects", "A blockchain record"], correctIndex: 1, category: "aurory", difficulty: "medium" },

  // ═══════════════════════════════════════════════════════
  //  ASGARD DUELS (10)
  // ═══════════════════════════════════════════════════════
  { question: "What is the main currency earned on Asgard Duels?", options: ["Gold Coins", "Valcoins", "Rune Tokens", "Asgard Credits"], correctIndex: 1, category: "asgard", difficulty: "easy" },
  { question: "Who is the AI guide of Asgard Duels?", options: ["Odin", "Runie", "Freya", "Loki"], correctIndex: 1, category: "asgard", difficulty: "easy" },
  { question: "What is the ship betting minigame called on Asgard Duels?", options: ["Viking Race", "Drakkar Race", "Ship Battle", "Norse Chase"], correctIndex: 1, category: "asgard", difficulty: "easy" },
  { question: "What is the slot machine minigame called?", options: ["Lucky Wheels", "Odin's Fortune", "Norse Slots", "Valkyrie Spins"], correctIndex: 1, category: "asgard", difficulty: "easy" },
  { question: "What tournament format does Asgard Duels use?", options: ["Battle Royale", "Draft-based matchmaking", "Open world PvP", "Round robin"], correctIndex: 1, category: "asgard", difficulty: "medium" },
  { question: "What is the arcade area of Asgard Duels called?", options: ["Game Zone", "Asgard Trials", "Fun House", "Norse Arcade"], correctIndex: 1, category: "asgard", difficulty: "easy" },
  { question: "Which game does Asgard Duels support for competitive play?", options: ["Fortnite", "Aurory", "Axie Infinity", "Pokémon"], correctIndex: 1, category: "asgard", difficulty: "easy" },
  { question: "How can you increase your Valcoin earn rate on Asgard Duels?", options: ["Buy premium", "Upgrade your tier", "Use a VPN", "Create multiple accounts"], correctIndex: 1, category: "asgard", difficulty: "medium" },
  { question: "What type of reward system does the Drakkar Race use?", options: ["Fixed payout", "Parimutuel betting", "Lottery draw", "Auction system"], correctIndex: 1, category: "asgard", difficulty: "hard" },
  { question: "What does the referral system on Asgard Duels reward you with?", options: ["NFTs", "Valcoins", "Real money", "Premium membership"], correctIndex: 1, category: "asgard", difficulty: "medium" },
];

async function seedRiddles() {
  console.log(`Seeding ${RIDDLES.length} riddles into Firestore...`);
  
  const batch = db.batch();
  
  for (const riddle of RIDDLES) {
    const ref = db.collection('riddles').doc();
    batch.set(ref, {
      ...riddle,
      enabled: true,
      timesAsked: 0,
      timesCorrect: 0,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  await batch.commit();
  console.log(`✅ Successfully seeded ${RIDDLES.length} riddles!`);
  process.exit(0);
}

seedRiddles().catch(err => {
  console.error('❌ Seeding failed:', err);
  process.exit(1);
});
