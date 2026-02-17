const { Client, GatewayIntentBits, Events, REST, Routes, SlashCommandBuilder } = require('discord.js');
require('dotenv').config();

const store = require('./data/store');
const blackjack = require('./games/blackjack');
const mines = require('./games/mines');
const simple = require('./games/simple');
const economy = require('./commands/economy');
const adminCmd = require('./commands/admin');
const helpCmd = require('./commands/help');
const statsCmd = require('./commands/stats');

// Environment, create and .env file and edit it there with your values
const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const ANNOUNCE_CHANNEL_ID = process.env.ANNOUNCE_CHANNEL_ID;
const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim());

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error("Missing env vars.");
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
let isBotActive = true;

// ─── Command definitions ───
const commands = [
  new SlashCommandBuilder().setName('balance').setDescription('Check your coin balance'),
  new SlashCommandBuilder().setName('daily').setDescription('Claim your daily coins'),
  new SlashCommandBuilder().setName('flip').setDescription('Flip coins, instant 50/50')
    .addStringOption(o => o.setName('amount').setDescription('Bet per flip (e.g. 1000, 1k, all)').setRequired(true))
    .addIntegerOption(o => o.setName('quantity').setDescription('Number of flips (1-10)').setMinValue(1).setMaxValue(10)),
  new SlashCommandBuilder().setName('dice').setDescription('Roll dice, win on 4-6')
    .addStringOption(o => o.setName('amount').setDescription('Bet amount (e.g. 1000, 1k, all)').setRequired(true)),
  new SlashCommandBuilder().setName('blackjack').setDescription('Play blackjack')
    .addStringOption(o => o.setName('amount').setDescription('Bet amount (e.g. 1000, 1k, all)').setRequired(true)),
  new SlashCommandBuilder().setName('roulette').setDescription('Play roulette')
    .addStringOption(o => o.setName('amount').setDescription('Bet amount (e.g. 1000, 1k, all)').setRequired(true)),
  new SlashCommandBuilder().setName('allin17black').setDescription('Go ALL IN on 17 black in roulette'),
  new SlashCommandBuilder().setName('mines').setDescription('Navigate a minefield for multiplied rewards')
    .addStringOption(o => o.setName('amount').setDescription('Bet amount (e.g. 1000, 1k, all)').setRequired(true))
    .addIntegerOption(o => o.setName('mines').setDescription('Number of mines (1-15)').setRequired(true).setMinValue(1).setMaxValue(15)),
  new SlashCommandBuilder().setName('leaderboard').setDescription('See the richest players'),
  new SlashCommandBuilder().setName('give').setDescription('Give coins to someone')
    .addUserOption(o => o.setName('user').setDescription('Who to give to').setRequired(true))
    .addStringOption(o => o.setName('amount').setDescription('Amount (e.g. 1000, 1k, all)').setRequired(true)),
  new SlashCommandBuilder().setName('trade').setDescription('Start a trade with someone')
    .addUserOption(o => o.setName('user').setDescription('Who to trade with').setRequired(true)),
  new SlashCommandBuilder().setName('duel').setDescription('Challenge someone to a coin flip duel')
    .addUserOption(o => o.setName('opponent').setDescription('Who to challenge').setRequired(true))
    .addStringOption(o => o.setName('amount').setDescription('Bet amount (e.g. 1000, 1k, all)').setRequired(true)),
  new SlashCommandBuilder().setName('letitride').setDescription('Win and keep doubling')
    .addStringOption(o => o.setName('amount').setDescription('Starting bet (e.g. 1000, 1k, all)').setRequired(true)),
  new SlashCommandBuilder().setName('deposit').setDescription('Deposit coins to your bank')
    .addStringOption(o => o.setName('amount').setDescription('Amount to deposit (e.g. 1000, 1k, all)').setRequired(true)),
  new SlashCommandBuilder().setName('invest').setDescription('Deposit coins to your bank (alias)')
    .addStringOption(o => o.setName('amount').setDescription('Amount to invest (e.g. 1000, 1k, all)').setRequired(true)),
  new SlashCommandBuilder().setName('withdraw').setDescription('Withdraw from your bank')
    .addStringOption(o => o.setName('amount').setDescription('Amount to withdraw (e.g. 1000, 1k, all)').setRequired(true)),
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
        { name: 'Collectibles', value: 'collectibles' },
        { name: 'Universal Income', value: 'universalincome' },
      )),
  new SlashCommandBuilder().setName('admin').setDescription('[ADMIN] Admin commands')
    .addSubcommand(s => s.setName('give').setDescription('[ADMIN] Give coins')
      .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
      .addIntegerOption(o => o.setName('amount').setDescription('Amount').setRequired(true)))
    .addSubcommand(s => s.setName('set').setDescription('[ADMIN] Set balance')
      .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
      .addIntegerOption(o => o.setName('amount').setDescription('Amount').setRequired(true)))
    .addSubcommand(s => s.setName('reset').setDescription('[ADMIN] Reset a user')
      .addUserOption(o => o.setName('user').setDescription('User').setRequired(true)))
    .addSubcommand(s => s.setName('resetupgrades').setDescription('[ADMIN] Reset upgrades')
      .addUserOption(o => o.setName('user').setDescription('User').setRequired(true)))
    .addSubcommand(s => s.setName('forcespin').setDescription('[ADMIN] Force the daily spin now'))
    .addSubcommand(s => s.setName('forcepoolpayout').setDescription('[ADMIN] Force hourly pool payout'))
    .addSubcommand(s => s.setName('start').setDescription('[ADMIN] Start the bot for everyone'))
    .addSubcommand(s => s.setName('stop').setDescription('[ADMIN] Stop the bot for non-admin users'))
    .addSubcommand(s => s.setName('resetstats').setDescription('[ADMIN] Reset a user\'s stats')
      .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))),
  new SlashCommandBuilder().setName('giveaway').setDescription('Start a giveaway')
    .addStringOption(o => o.setName('amount').setDescription('Prize pool amount (e.g. 1000, 1k, all)').setRequired(true))
    .addIntegerOption(o => o.setName('duration').setDescription('Duration in minutes (1-1440)').setRequired(true).setMinValue(1).setMaxValue(1440)),
].map(c => c.toJSON());

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  try {
    console.log("Registering commands...");
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log("Commands registered!");
  } catch (err) { console.error("Failed:", err); }
}

// ─── Hourly interest + Universal Pool distribution ───
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

  if (share > 0) {
    for (const id of ids) {
      store.getWallet(id).balance += share;
      store.trackUniversalIncome(id, share);
    }
    poolData.universalPool -= share * ids.length;
  }

  poolData.lastHourlyPayout = Date.now();
  store.savePool();
  store.saveWallets();

  if (ANNOUNCE_CHANNEL_ID) {
    const channel = await client.channels.fetch(ANNOUNCE_CHANNEL_ID).catch(() => null);
    if (channel) {
      const rows = [];
      for (const row of interestRows) {
        const u = await client.users.fetch(row.id).catch(() => null);
        const name = (u ? u.username : 'Unknown').substring(0, 14).padEnd(14);
        rows.push(`${name} ${store.formatNumber(row.interest).padStart(11)}`);
      }

      let table = '**Hourly Bank Interest**\n```\nPlayer          Interest\n-------------- -----------\n';
      table += rows.join('\n');
      table += '\n```';

      await channel.send(
        `${table}\nUniversal payout: **${store.formatNumber(share)}** coins per player (${ids.length} players).`
      ).catch(() => {});
    }
  }

  console.log(`Hourly distribution complete. Players: ${ids.length}, universal share: ${share}`);
}

// ─── Daily Spin ───
async function runDailySpin() {
  if (!ANNOUNCE_CHANNEL_ID) return;
  const poolData = store.getPoolData();
  if (poolData.lossPool <= 0) return;
  try {
    const channel = await client.channels.fetch(ANNOUNCE_CHANNEL_ID);
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
      `🎉🎉🎉\n<@${winner.id}> (**${winnerName}**) WINS **${store.formatNumber(prize)}** COINS!\n🎉🎉🎉`
    );
    console.log(`Daily spin: ${winnerName} won ${prize}`);
  } catch (err) { console.error("Daily spin error:", err); }
}

// ─── Giveaway Expiration ───
async function checkExpiredGiveaways() {
  try {
    // Check expired giveaways
    const giveaways = store.getAllGiveaways();
    for (const giveaway of giveaways) {
      if (Date.now() > giveaway.expiresAt) {
        const announceChannelId = giveaway.channelId || ANNOUNCE_CHANNEL_ID;
        const channel = announceChannelId
          ? await client.channels.fetch(announceChannelId).catch(() => null)
          : null;

        if (giveaway.participants.length > 0) {
          // Select winner
          const winner = giveaway.participants[Math.floor(Math.random() * giveaway.participants.length)];
          store.getWallet(winner).balance += giveaway.amount;
          store.trackGiveawayWin(winner, giveaway.amount);
          store.trackGiveawayCreated(giveaway.initiatorId, giveaway.amount);
          store.saveWallets();
          
          const initiatorUser = await client.users.fetch(giveaway.initiatorId).catch(() => null);
          const initiatorName = initiatorUser ? initiatorUser.username : 'Unknown';

          if (channel) {
            await channel.send(
              `🎉 **GIVEAWAY ENDED!**\n\n` +
              `<@${winner}> won **${store.formatNumber(giveaway.amount)}** coins from **${initiatorName}**'s giveaway!\n` +
              `Participants: ${giveaway.participants.length}`
            ).catch(() => {});
          }
        } else {
          // Refund if no participants
          store.getWallet(giveaway.initiatorId).balance += giveaway.amount;
          store.saveWallets();

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

// ─── Daily Leaderboard ───
async function postDailyLeaderboard() {
  if (!ANNOUNCE_CHANNEL_ID) return;
  try {
    const channel = await client.channels.fetch(ANNOUNCE_CHANNEL_ID);
    if (!channel) return;
    const wallets = store.getAllWallets();
    const entries = Object.entries(wallets)
      .map(([id, d]) => ({ id, balance: d.balance || 0, bank: d.bank || 0 }))
      .sort((a, b) => (b.balance + b.bank) - (a.balance + a.bank)).slice(0, 10);
    if (entries.length === 0) return;

    let board = "**Daily Leaderboard**\n```\nRank Player          Purse       Bank        Total\n---- -------------- ----------- ----------- -----------\n";
    const medals = ['1st', '2nd', '3rd'];
    for (let i = 0; i < entries.length; i++) {
      const u = await client.users.fetch(entries[i].id).catch(() => null);
      const name = (u ? u.username : "Unknown").substring(0, 14).padEnd(14);
      const rank = (medals[i] || `${i + 1}th`).padEnd(4);
      board += `${rank} ${name} ${store.formatNumber(entries[i].balance).padStart(11)} ${store.formatNumber(entries[i].bank).padStart(11)} ${store.formatNumber(entries[i].balance + entries[i].bank).padStart(11)}\n`;
    }
    board += "```";
    await channel.send(board);
  } catch (err) { console.error("Leaderboard post error:", err); }
}

// ─── Scheduling ───
function scheduleAll() {
  setInterval(() => { distributeUniversalPool().catch(err => console.error('Hourly distribution error:', err)); }, 3600000);
  setInterval(checkExpiredGiveaways, 30000);

  const now = new Date();
  const nextSpin = new Date();
  nextSpin.setHours(23, 15, 0, 0);
  if (now >= nextSpin) nextSpin.setDate(nextSpin.getDate() + 1);
  const spinMs = nextSpin - now;
  setTimeout(() => {
    runDailySpin();
    setInterval(runDailySpin, 86400000);
  }, spinMs);

  const leaderboardNow = new Date();
  const target = new Date(); target.setHours(12, 0, 0, 0);
  if (leaderboardNow >= target) target.setDate(target.getDate() + 1);
  const ms = target - leaderboardNow;
  setTimeout(() => {
    postDailyLeaderboard();
    setInterval(postDailyLeaderboard, 86400000);
  }, ms);
  console.log(`Daily leaderboard in ${Math.round(ms / 60000)} min. Daily spin in ${Math.round(spinMs / 60000)} min. Hourly distribution active.`);
}

// ─── Bot Ready ───
client.once(Events.ClientReady, async () => {
  console.log(`Bot online: ${client.user.tag}`);
  await registerCommands();
  scheduleAll();
});

// ─── Interaction Handler ───
client.on(Events.InteractionCreate, async (interaction) => {

  const isAdminUser = ADMIN_IDS.includes(interaction.user.id);
  if (!isBotActive && !isAdminUser) {
    return interaction.reply({ content: 'Ask admin to start the bot.', ephemeral: true }).catch(() => {});
  }

  // ══════ MODALS ══════
  if (interaction.isModalSubmit()) {
    try {
      if (interaction.customId.startsWith('trade_coinmodal_')) return await economy.handleTradeModal(interaction);
    } catch (e) { console.error(e); }
    return;
  }

  // ══════ SELECT MENUS ══════
  if (interaction.isStringSelectMenu()) {
    try {
      if (interaction.customId.startsWith('trade_selectitem_') || interaction.customId.startsWith('trade_unselectitem_'))
        return await economy.handleTradeSelectMenu(interaction);
    } catch (e) { console.error(e); }
    return;
  }

  // ══════ BUTTONS ══════
  if (interaction.isButton()) {
    const parts = interaction.customId.split('_');
    try {
      if (interaction.customId.startsWith('upgrade_'))  return await economy.handleUpgradeButton(interaction, parts);
      if (interaction.customId.startsWith('trade_'))    return await economy.handleTradeButton(interaction, parts);
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

  // ══════ SLASH COMMANDS ══════
  if (!interaction.isChatInputCommand()) return;
  const cmd = interaction.commandName;
  const userId = interaction.user.id;
  const isAdmin = ADMIN_IDS.includes(userId);

  if (!isBotActive && !(cmd === 'admin' && isAdmin)) {
    return interaction.reply({ content: 'Ask admin to start the bot.', ephemeral: true });
  }

  try {
    // Process bank interest on every command
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
        runDailySpin,
        distributeUniversalPool,
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
