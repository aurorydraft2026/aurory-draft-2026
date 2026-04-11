require('dotenv').config();
const https = require('https');

const APP_ID = process.env.DISCORD_APP_ID;
const TOKEN = process.env.DISCORD_TOKEN;

const commands = [
  {
    name: 'balance',
    description: 'Check your balance or earnings in Asgard',
    options: [
      {
        name: 'type',
        description: 'What type of balance do you want to check?',
        type: 3, // STRING type
        required: false,
        choices: [
          { name: '💰 Valcoins', value: 'valcoins' },
          { name: '⚡ AURY', value: 'aury' },
          { name: '💲 USDC', value: 'usdc' }
        ]
      }
    ]
  },
  {
    name: 'wealth',
    description: 'Check your minigame earnings in Asgard',
    options: [
      {
        name: 'game',
        description: 'Which minigame earnings do you want to check?',
        type: 3, // STRING type
        required: false,
        choices: [
          { name: '🎰 Slot Machine', value: 'slotMachine' },
          { name: '📦 Loot Box', value: 'treasureChest' },
          { name: '⛵ Drakkar Race', value: 'drakkarRace' }
        ]
      }
    ]
  },
  {
    name: 'leaderboard',
    description: 'View the top players in Asgard',
    options: [
      {
        name: 'category',
        description: 'Which leaderboard do you want to view?',
        type: 3, // STRING type
        required: false,
        choices: [
          { name: '💰 Top Valcoin Earners', value: 'valcoins' },
          { name: '⚡ Top AURY Balances', value: 'aury' },
          { name: '💲 Top USDC Balances', value: 'usdc' },
          { name: '🏆 Best Players', value: 'best_players' },
          { name: '🎰 Slot Machine Top Earners', value: 'slotMachine' },
          { name: '📦 Loot Box Top Earners', value: 'treasureChest' },
          { name: '⛵ Drakkar Race Top Earners', value: 'drakkarRace' }
        ]
      }
    ]
  }
];

const data = JSON.stringify(commands);

const options = {
  hostname: 'discord.com',
  port: 443,
  path: `/api/v10/applications/${APP_ID}/commands`,
  method: 'PUT',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bot ${TOKEN}`,
    'Content-Length': Buffer.byteLength(data)
  }
};

const req = https.request(options, (res) => {
  let responseBody = '';
  res.on('data', (chunk) => {
    responseBody += chunk;
  });
  res.on('end', () => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
        console.log('✅ Successfully registered expanded slash commands!');
    } else {
        console.error('❌ Failed to register commands:');
        console.error(responseBody);
    }
  });
});

req.on('error', (error) => {
  console.error(error);
});

req.write(data);
req.end();
