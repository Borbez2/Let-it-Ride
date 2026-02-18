const { Client, GatewayIntentBits, Events, REST, Routes, SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
require('dotenv').config();

const store = require('./data/store');
const blackjack = require('./games/blackjack');
const mines = require('./games/mines');
const simple = require('./games/simple');
const economy = require('./commands/economy');
const adminCmd = require('./commands/admin');
const helpCmd = require('./commands/help');
const statsCmd = require('./commands/stats');

// Load required environment values from .env.
const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const ANNOUNCE_CHANNEL_ID = process.env.ANNOUNCE_CHANNEL_ID;
const DAILY_EVENTS_CHANNEL_ID = '1467976012645269676';
const HOURLY_PAYOUT_CHANNEL_ID = '1473595731893027000';
const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim()).filter(Boolean);
const STATS_RESET_ADMIN_IDS = (process.env.STATS_RESET_ADMIN_IDS || process.env.ADMIN_IDS || '')
  .split(',')
  .map(id => id.trim())
  .filter(Boolean);

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error("Missing env vars.");
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
let isBotActive = true;

// Register all slash command definitions.
const commands = [
  new SlashCommandBuilder().setName('balance').setDescription('Check your coin balance'),
  new SlashCommandBuilder().setName('daily').setDescription('Claim your daily coins'),
  new SlashCommandBuilder().setName('flip').setDescription('Flip coins, instant 50/50')
    .addStringOption(o => o.setName('amount').setDescription('Bet per flip (e.g. 100, 4.7k, 1.2m, all)').setRequired(true))
    .addIntegerOption(o => o.setName('quantity').setDescription('Number of flips (1-10)').setMinValue(1).setMaxValue(10)),
  new SlashCommandBuilder().setName('dice').setDescription('Roll dice, win on 4-6')
    .addStringOption(o => o.setName('amount').setDescription('Bet amount (e.g. 100, 4.7k, 1.2m, all)').setRequired(true)),
  new SlashCommandBuilder().setName('blackjack').setDescription('Play blackjack')
    .addStringOption(o => o.setName('amount').setDescription('Bet amount (e.g. 100, 4.7k, 1.2m, all)').setRequired(true)),
  new SlashCommandBuilder().setName('roulette').setDescription('Play roulette')
    .addStringOption(o => o.setName('amount').setDescription('Bet amount (e.g. 100, 4.7k, 1.2m, all)').setRequired(true)),
  new SlashCommandBuilder().setName('allin17black').setDescription('Go ALL IN on 17 black in roulette'),
  new SlashCommandBuilder().setName('mines').setDescription('Navigate a minefield for multiplied rewards')
    .addStringOption(o => o.setName('amount').setDescription('Bet amount (e.g. 100, 4.7k, 1.2m, all)').setRequired(true))
    .addIntegerOption(o => o.setName('mines').setDescription('Number of mines (1-15)').setRequired(true).setMinValue(1).setMaxValue(15)),
  new SlashCommandBuilder().setName('leaderboard').setDescription('See the richest players'),
  new SlashCommandBuilder().setName('give').setDescription('Give coins to someone')
    .addUserOption(o => o.setName('user').setDescription('Who to give to').setRequired(true))
    .addStringOption(o => o.setName('amount').setDescription('Amount (e.g. 100, 4.7k, 1.2m, all)').setRequired(true)),
  new SlashCommandBuilder().setName('trade').setDescription('Start a trade with someone')
    .addUserOption(o => o.setName('user').setDescription('Who to trade with').setRequired(true)),
  new SlashCommandBuilder().setName('duel').setDescription('Challenge someone to a coin flip duel')
    .addUserOption(o => o.setName('opponent').setDescription('Who to challenge').setRequired(true))
    .addStringOption(o => o.setName('amount').setDescription('Bet amount (e.g. 100, 4.7k, 1.2m, all)').setRequired(true)),
  new SlashCommandBuilder().setName('letitride').setDescription('Win and keep doubling')
    .addStringOption(o => o.setName('amount').setDescription('Starting bet (e.g. 100, 4.7k, 1.2m, all)').setRequired(true)),
  new SlashCommandBuilder().setName('deposit').setDescription('Deposit coins to your bank')
    .addStringOption(o => o.setName('amount').setDescription('Amount to deposit (e.g. 100, 4.7k, 1.2m, all)').setRequired(true)),
  new SlashCommandBuilder().setName('invest').setDescription('Deposit coins to your bank (alias)')
    .addStringOption(o => o.setName('amount').setDescription('Amount to invest (e.g. 100, 4.7k, 1.2m, all)').setRequired(true)),
  new SlashCommandBuilder().setName('withdraw').setDescription('Withdraw from your bank')
    .addStringOption(o => o.setName('amount').setDescription('Amount to withdraw (e.g. 100, 4.7k, 1.2m, all)').setRequired(true)),
  new SlashCommandBuilder().setName('bank').setDescription('Check your bank status'),
  new SlashCommandBuilder().setName('upgrades').setDescription('View and purchase upgrades'),
  new SlashCommandBuilder().setName('inventory').setDescription('View your collectibles')
    .addIntegerOption(o => o.setName('page').setDescription('Page number').setMinValue(1)),
  new SlashCommandBuilder().setName('collection').setDescription('Collectible leaderboard'),
  new SlashCommandBuilder().setName('pool').setDescription('View the universal pool and daily spin pool'),
  new SlashCommandBuilder().setName('stats').setDescription('View your gaming stats and lifetime earnings/losses')
    .addUserOption(o => o.setName('user').setDescription('User to check stats for (optional)').setRequired(false))
    .addStringOption(o => o.setName('username').setDescription('Username to check stats for (optional)').setRequired(false)),
  new SlashCommandBuilder().setName('mysterybox').setDescription('Buy mystery boxes for 5,000 coins each')
    .addIntegerOption(o => o.setName('quantity').setDescription('Number of boxes to buy (1-50)').setMinValue(1).setMaxValue(50)),
  new SlashCommandBuilder().setName('help').setDescription('Get help on game systems')
    .addStringOption(o => o.setName('topic').setDescription('Help topic')
      .addChoices(
        { name: 'General Economy', value: 'general' },
        { name: 'Games and EV', value: 'games' },
        { name: 'Command Reference', value: 'commands' },
      )),
  adminCmd.buildAdminCommand(),
  new SlashCommandBuilder().setName('giveaway').setDescription('Start a giveaway via popup form with an optional message')
    .addStringOption(o => o.setName('message').setDescription('Optional giveaway message').setRequired(false).setMaxLength(200)),
].map(c => c.toJSON());

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  try {
    console.log("Registering commands...");
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log("Commands registered!");
  } catch (err) { console.error("Failed:", err); }
}

// Distribute hourly bank interest and universal pool shares.
async function distributeUniversalPool() {
  const wallets = store.getAllWallets();
  const poolData = store.getPoolData();
  const ids = Object.keys(wallets);

  if (ids.length === 0) return;

  const interestRows = [];
  for (const id of ids) {
    const interest = store.processBank(id);
    interestRows.push({ id, interest });
  }

  let share = 0;
  if (poolData.universalPool > 0) {
    share = Math.floor(poolData.universalPool / ids.length);
  }

  const doubledPayouts = [];
  if (share > 0) {
    for (const id of ids) {
      const doubleChance = store.getUniversalIncomeDoubleChance(id);
      const gotDouble = Math.random() < doubleChance;
      const payout = gotDouble ? share * 2 : share;
      store.getWallet(id).bank += payout;
      store.trackUniversalIncome(id, payout);
      if (gotDouble) {
        doubledPayouts.push({ id, payout });
      }
    }
    poolData.universalPool -= share * ids.length;
  }

  poolData.lastHourlyPayout = Date.now();
  store.savePool();
  store.saveWallets();

  const channel = await client.channels.fetch(HOURLY_PAYOUT_CHANNEL_ID).catch((err) => {
    console.error(`Hourly channel fetch failed for ${HOURLY_PAYOUT_CHANNEL_ID}:`, err);
    return null;
  });
  if (channel) {
    const rows = [];
    for (const row of interestRows) {
      const u = await client.users.fetch(row.id).catch(() => null);
      const name = (u ? u.username : 'Unknown').substring(0, 14).padEnd(14);
      rows.push(`${name} ${store.formatNumber(row.interest).padStart(11)}`);
    }

    let table = '**Hourly Bank Interest (paid to bank)**\n```\nPlayer          Interest\n-------------- -----------\n';
    table += rows.join('\n');
    table += '\n```';

    await channel.send(table).catch((err) => {
      console.error(`Hourly interest message send failed for ${HOURLY_PAYOUT_CHANNEL_ID}:`, err);
    });
    await channel.send(
      `Universal income paid to bank: **${store.formatNumber(share)}** coins per player this hour (${ids.length} players).`
    ).catch((err) => {
      console.error(`Hourly universal message send failed for ${HOURLY_PAYOUT_CHANNEL_ID}:`, err);
    });
    if (doubledPayouts.length > 0) {
      const lines = doubledPayouts.map(entry => `<@${entry.id}> earned **double universal income** from their perk (**${store.formatNumber(entry.payout)}** total).`);
      await channel.send(`✨ **Hourly Universal Income Mult Procs**\n${lines.join('\n')}`).catch((err) => {
        console.error(`Hourly perk message send failed for ${HOURLY_PAYOUT_CHANNEL_ID}:`, err);
      });
    }
  } else {
    console.error(`Hourly payout skipped: channel ${HOURLY_PAYOUT_CHANNEL_ID} not accessible.`);
  }

  console.log(`Hourly distribution complete. Players: ${ids.length}, universal share: ${share}`);
}

async function buildLeaderboardBoard(title = '**Leaderboard**') {
  const wallets = store.getAllWallets();
  const entries = Object.entries(wallets)
    .map(([id, d]) => ({ id, balance: d.balance || 0, bank: d.bank || 0 }))
    .sort((a, b) => (b.balance + b.bank) - (a.balance + a.bank)).slice(0, 10);
  if (entries.length === 0) return null;

  let board = `${title}\n\`\`\`\nRank Player          Purse       Bank        Total\n---- -------------- ----------- ----------- -----------\n`;
  const medals = ['1st', '2nd', '3rd'];
  for (let i = 0; i < entries.length; i++) {
    const u = await client.users.fetch(entries[i].id).catch(() => null);
    const name = (u ? u.username : 'Unknown').substring(0, 14).padEnd(14);
    const rank = (medals[i] || `${i + 1}th`).padEnd(4);
    board += `${rank} ${name} ${store.formatNumber(entries[i].balance).padStart(11)} ${store.formatNumber(entries[i].bank).padStart(11)} ${store.formatNumber(entries[i].balance + entries[i].bank).padStart(11)}\n`;
  }
  board += '\`\`\`';
  return board;
}

// Run the daily spin payout.
async function runDailySpin() {
  const poolData = store.getPoolData();
  if (poolData.lossPool <= 0) return;
  try {
    const channel = await client.channels.fetch(DAILY_EVENTS_CHANNEL_ID).catch(() => null);
    if (!channel) return;
    const wallets = store.getAllWallets();
    const entries = Object.entries(wallets)
      .map(([id, d]) => ({ id, total: (d.balance || 0) + (d.bank || 0), weight: store.getSpinWeight(id) }))
      .filter(e => e.total > 0);
    if (entries.length === 0) return;

    const totalWeight = entries.reduce((s, e) => s + e.weight, 0);
    const prize = poolData.lossPool;
    let roll = Math.random() * totalWeight;
    let winner = entries[0];
    for (const e of entries) { roll -= e.weight; if (roll <= 0) { winner = e; break; } }

    store.getWallet(winner.id).balance += prize;
    store.trackDailySpinWin(winner.id, prize);
    poolData.lossPool = 0;
    poolData.lastDailySpin = Date.now();
    store.savePool(); store.saveWallets();

    const names = [];
    for (const e of entries) {
      const u = await client.users.fetch(e.id).catch(() => null);
      names.push(u ? u.username : 'Unknown');
    }
    const winnerUser = await client.users.fetch(winner.id).catch(() => null);
    const winnerName = winnerUser ? winnerUser.username : 'Unknown';
    const winnerWeight = store.getSpinWeight(winner.id);

    const arrows = ['▶', '▷', '►', '▹'];
    let msg = await channel.send(`🎰 **DAILY SPIN** 🎰\nPrize Pool: **${store.formatNumber(prize)}** coins\n\nSpinning...`);
    for (let f = 0; f < 8; f++) {
      await new Promise(r => setTimeout(r, 500 + f * 80));
      const rn = names[Math.floor(Math.random() * names.length)];
      await msg.edit(`🎰 **DAILY SPIN** 🎰\nPrize Pool: **${store.formatNumber(prize)}** coins\n\n${arrows[f % 4]} ${rn} ${arrows[f % 4]}`);
    }
    await new Promise(r => setTimeout(r, 1200));
    await msg.edit(
      `🎰 **DAILY SPIN** 🎰\nPrize Pool: **${store.formatNumber(prize)}** coins\n\n` +
      `🎉🎉🎉\n<@${winner.id}> (**${winnerName}**) WINS **${store.formatNumber(prize)}** COINS!\nSpin Mult Applied: **x${winnerWeight}**\n🎉🎉🎉`
    );
    console.log(`Daily spin: ${winnerName} won ${prize}`);
  } catch (err) { console.error("Daily spin error:", err); }
}

// End giveaways once their timers expire.
async function checkExpiredGiveaways() {
  try {
    // Loop through giveaways and process anything that expired.
    const giveaways = store.getAllGiveaways();
    for (const giveaway of giveaways) {
      if (Date.now() > giveaway.expiresAt) {
        const announceChannelId = giveaway.channelId || ANNOUNCE_CHANNEL_ID;
        const channel = announceChannelId
          ? await client.channels.fetch(announceChannelId).catch(() => null)
          : null;
        const disabledRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`giveaway_ended_${giveaway.id}`)
            .setLabel('Giveaway Ended')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true),
        );

        if (giveaway.participants.length > 0) {
          // Pick a random winner from participants.
          const winner = giveaway.participants[Math.floor(Math.random() * giveaway.participants.length)];
          store.getWallet(winner).balance += giveaway.amount;
          store.trackGiveawayWin(winner, giveaway.amount);
          store.trackGiveawayCreated(giveaway.initiatorId, giveaway.amount);
          store.saveWallets();
          
          const initiatorUser = await client.users.fetch(giveaway.initiatorId).catch(() => null);
          const initiatorName = initiatorUser ? initiatorUser.username : 'Unknown';

          const giveawayMessageLine = giveaway.message ? `\nMessage: ${giveaway.message}` : '';

          if (channel && giveaway.messageId) {
            const originalMessage = await channel.messages.fetch(giveaway.messageId).catch(() => null);
            if (originalMessage) {
              await originalMessage.edit({
                content:
                  `🎉 **GIVEAWAY ENDED!**\n\nHost: <@${giveaway.initiatorId}>\nPrize Pool: **${store.formatNumber(giveaway.amount)}** coins\n` +
                  `Participants: ${giveaway.participants.length}${giveawayMessageLine}\nEnds: **ENDED**\nWinner: <@${winner}>`,
                components: [disabledRow],
              }).catch(() => {});
            }
          }

          if (channel) {
            await channel.send(
              `🎉 **GIVEAWAY ENDED!**\n\n` +
              `<@${winner}> won **${store.formatNumber(giveaway.amount)}** coins from **${initiatorName}**'s giveaway!\n` +
              `Participants: ${giveaway.participants.length}${giveawayMessageLine}`
            ).catch(() => {});
          }
        } else {
          // Refund the host if nobody joined.
          store.getWallet(giveaway.initiatorId).balance += giveaway.amount;
          store.saveWallets();

          const giveawayMessageLine = giveaway.message ? `\nMessage: ${giveaway.message}` : '';

          if (channel && giveaway.messageId) {
            const originalMessage = await channel.messages.fetch(giveaway.messageId).catch(() => null);
            if (originalMessage) {
              await originalMessage.edit({
                content:
                  `🎉 **GIVEAWAY ENDED**\n\nHost: <@${giveaway.initiatorId}>\nPrize Pool: **${store.formatNumber(giveaway.amount)}** coins\n` +
                  `Participants: 0${giveawayMessageLine}\nEnds: **ENDED**\nNo participants joined. Host refunded.`,
                components: [disabledRow],
              }).catch(() => {});
            }
          }

          if (channel) {
            await channel.send(
              `🎉 **GIVEAWAY ENDED**\n\nNo participants joined, so <@${giveaway.initiatorId}> was refunded **${store.formatNumber(giveaway.amount)}** coins.`
            ).catch(() => {});
          }
        }
        
        store.removeGiveaway(giveaway.id);
      }
    }
    
  } catch (err) { console.error("Giveaway check error:", err); }
}

// Post a daily leaderboard snapshot.
async function postDailyLeaderboard() {
  try {
    const channel = await client.channels.fetch(DAILY_EVENTS_CHANNEL_ID).catch(() => null);
    if (!channel) return;
    const board = await buildLeaderboardBoard('**Daily Leaderboard**');
    if (!board) return;
    await channel.send(board);
  } catch (err) { console.error("Leaderboard post error:", err); }
}

// Schedule recurring jobs and daily timers.
function scheduleAll() {
  function msUntilNextUtcHour() {
    const now = new Date();
    const next = new Date(now);
    next.setUTCMinutes(0, 0, 0);
    next.setUTCHours(next.getUTCHours() + 1);
    return next - now;
  }

  function msUntilNextDaily1115() {
    const now = new Date();
    const next = new Date(now);
    next.setHours(11, 15, 0, 0);
    if (now >= next) next.setDate(next.getDate() + 1);
    return next - now;
  }

  function scheduleNextHourly() {
    const delay = msUntilNextUtcHour();
    setTimeout(async () => {
      try {
        await distributeUniversalPool();
      } catch (err) {
        console.error('Hourly distribution error:', err);
      } finally {
        scheduleNextHourly();
      }
    }, delay);
  }

  function scheduleNextDaily1115() {
    const delay = msUntilNextDaily1115();
    setTimeout(async () => {
      try {
        await runDailySpin();
      } catch (err) {
        console.error('Daily 11:15 cycle error:', err);
      } finally {
        scheduleNextDaily1115();
      }
    }, delay);
  }

  const missedHourlyMs = Date.now() - (store.getPoolData().lastHourlyPayout || 0);
  if (missedHourlyMs >= 3600000) {
    distributeUniversalPool().catch((err) => console.error('Startup catch-up hourly error:', err));
  }

  scheduleNextHourly();
  setInterval(checkExpiredGiveaways, 30000);
  scheduleNextDaily1115();

  const hourlyMs = msUntilNextUtcHour();
  const dailyMs = msUntilNextDaily1115();
  console.log(
    `Daily 11:15 cycle in ${Math.round(dailyMs / 60000)} min (spin only). ` +
    `Hourly payout in ${Math.round(hourlyMs / 60000)} min (next UTC hour).`
  );
}

// Run startup logic when the bot is ready.
client.once(Events.ClientReady, async () => {
  console.log(`Bot online: ${client.user.tag}`);
  await registerCommands();
  scheduleAll();
});

// Route every incoming Discord interaction.
client.on(Events.InteractionCreate, async (interaction) => {

  const isAdminUser = ADMIN_IDS.includes(interaction.user.id);
  if (!isBotActive && !isAdminUser) {
    return interaction.reply({ content: 'Ask admin to start the bot.', ephemeral: true }).catch(() => {});
  }

  // Handle modal submissions.
  if (interaction.isModalSubmit()) {
    try {
      if (interaction.customId.startsWith('trade_coinmodal_')) return await economy.handleTradeModal(interaction);
      if (interaction.customId === 'giveaway_create_modal') return await economy.handleGiveawayModal(interaction);
    } catch (e) { console.error(e); }
    return;
  }

  // Handle select menu interactions.
  if (interaction.isStringSelectMenu()) {
    try {
      if (interaction.customId.startsWith('trade_selectitem_') || interaction.customId.startsWith('trade_unselectitem_'))
        return await economy.handleTradeSelectMenu(interaction);
    } catch (e) { console.error(e); }
    return;
  }

  // Handle button interactions.
  if (interaction.isButton()) {
    const parts = interaction.customId.split('_');
    try {
      if (interaction.customId.startsWith('upgrade_'))  return await economy.handleUpgradeButton(interaction, parts);
      if (interaction.customId.startsWith('trade_'))    return await economy.handleTradeButton(interaction, parts);
      if (interaction.customId.startsWith('invpage_'))  return await economy.handleInventoryButton(interaction, parts);
      if (interaction.customId.startsWith('mines_'))    return await mines.handleButton(interaction, parts);
      if (interaction.customId.startsWith('duel_'))     return await simple.handleDuelButton(interaction, parts);
      if (interaction.customId.startsWith('ride_'))     return await simple.handleRideButton(interaction, parts);
      if (interaction.customId.startsWith('bjsplit_'))  return await blackjack.handleButton(interaction, parts);
      if (interaction.customId.startsWith('bj_'))       return await blackjack.handleButton(interaction, parts);
      if (interaction.customId.startsWith('roulette_')) return await simple.handleRouletteButton(interaction, parts);
      if (interaction.customId.startsWith('dice_'))     return await simple.handleDiceButton(interaction, parts);
      if (interaction.customId.startsWith('giveaway_join_')) {
        const giveawayId = interaction.customId.slice('giveaway_join_'.length);
        return await economy.handleGiveawayJoin(interaction, giveawayId);
      }
    } catch (e) { console.error(e); }
    return;
  }

  // Handle slash commands.
  if (!interaction.isChatInputCommand()) return;
  const cmd = interaction.commandName;
  const userId = interaction.user.id;
  const isAdmin = ADMIN_IDS.includes(userId);

  if (!isBotActive && !(cmd === 'admin' && isAdmin)) {
    return interaction.reply({ content: 'Ask admin to start the bot.', ephemeral: true });
  }

  try {
    // Apply pending bank interest whenever a user runs a command.
    store.processBank(userId);

    switch (cmd) {
      case 'balance':      return await economy.handleBalance(interaction);
      case 'daily':        return await economy.handleDaily(interaction);
      case 'flip':         return await simple.handleFlip(interaction);
      case 'dice':         return await simple.handleDice(interaction);
      case 'blackjack':    return await blackjack.handleCommand(interaction);
      case 'roulette':     return await simple.handleRoulette(interaction);
      case 'allin17black': return await simple.handleAllIn17(interaction);
      case 'mines':        return await mines.handleCommand(interaction);
      case 'leaderboard':  return await economy.handleLeaderboard(interaction, client);
      case 'give':         return await economy.handleGive(interaction);
      case 'trade':        return await economy.handleTrade(interaction);
      case 'duel':         return await simple.handleDuel(interaction);
      case 'letitride':    return await simple.handleLetItRide(interaction);
      case 'deposit':
      case 'invest':       return await economy.handleDeposit(interaction);
      case 'withdraw':     return await economy.handleWithdraw(interaction);
      case 'bank':         return await economy.handleBank(interaction);
      case 'upgrades':     return await economy.handleUpgrades(interaction);
      case 'mysterybox':   return await economy.handleMysteryBox(interaction);
      case 'inventory':    return await economy.handleInventory(interaction);
      case 'collection':   return await economy.handleCollection(interaction, client);
      case 'pool':         return await economy.handlePool(interaction);
      case 'stats':        return await statsCmd.handleStats(interaction);
      case 'help':         return await helpCmd.handleHelp(interaction);
      case 'giveaway':     return await economy.handleGiveawayStart(interaction);
      case 'admin':        return await adminCmd.handleAdmin(
        interaction,
        client,
        ADMIN_IDS,
        STATS_RESET_ADMIN_IDS,
        runDailySpin,
        distributeUniversalPool,
        ANNOUNCE_CHANNEL_ID,
        HOURLY_PAYOUT_CHANNEL_ID,
        () => isBotActive,
        (nextState) => { isBotActive = !!nextState; }
      );
    }
  } catch (err) {
    console.error(err);
    if (!interaction.replied) await interaction.reply("Something went wrong").catch(() => {});
  }
});

client.login(TOKEN);
