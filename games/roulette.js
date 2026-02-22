const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { CONFIG } = require('../config');
const store = require('../data/store');
const { maybeAnnouncePityTrigger } = require('./shared');

const activeGames = new Map();
const REDS = CONFIG.games.roulette.redNumbers;

function persistRouletteSessions() {
  store.setRuntimeState('session:roulette', {
    activeGames: Object.fromEntries(activeGames),
  });
}

function restoreRouletteSessions() {
  const state = store.getRuntimeState('session:roulette', null);
  if (!state || typeof state !== 'object') return;
  if (state.activeGames && typeof state.activeGames === 'object') {
    for (const [k, v] of Object.entries(state.activeGames)) activeGames.set(k, v);
  }
  // Migrate from old combined session key
  const oldState = store.getRuntimeState('session:simple', null);
  if (oldState && oldState.activeGames) {
    for (const [k, v] of Object.entries(oldState.activeGames)) {
      if (v.game === 'roulette' && !activeGames.has(k)) activeGames.set(k, v);
    }
  }
}

restoreRouletteSessions();

// Roulette command.
async function handleRoulette(interaction) {
  const userId = interaction.user.id;
  const rawAmount = interaction.options.getString('amount');
  const balance = store.getBalance(userId);
  if (balance <= 0) {
    return interaction.reply({ embeds: [{ color: 0xed4245, description: `Not enough coins. You only have **${store.formatNumber(balance)}**` }] });
  }

  const bet = store.parseAmount(rawAmount, balance);
  if (!bet || bet <= 0) {
    return interaction.reply({ embeds: [{ color: 0xed4245, description: CONFIG.commands.invalidAmountText }] });
  }

  const bal = store.getBalance(userId);
  if (bet > bal) {
    return interaction.reply({ embeds: [{ color: 0xed4245, description: `Not enough coins. You only have **${store.formatNumber(bal)}**` }] });
  }

  activeGames.set(userId, { bet, game: 'roulette', createdAt: Date.now() });
  persistRouletteSessions();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`roulette_red_${userId}`).setLabel(CONFIG.games.roulette.labels.red).setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`roulette_black_${userId}`).setLabel(CONFIG.games.roulette.labels.black).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`roulette_green_${userId}`).setLabel(CONFIG.games.roulette.labels.green).setStyle(ButtonStyle.Success),
  );
  return interaction.reply({
    embeds: [{ color: 0x5865f2, title: '🎡 Roulette', description: `Bet: **${store.formatNumber(bet)}**\nPick your color below.` }],
    components: [row],
  });
}

async function handleRouletteButton(interaction, parts) {
  const uid = interaction.user.id;
  const game = activeGames.get(uid);
  if (!game) return interaction.reply({ content: 'Session expired. Start a new game.', ephemeral: true });

  const choice = parts[1];
  const num = Math.floor(Math.random() * CONFIG.games.roulette.wheelSize);
  const col = num === CONFIG.games.roulette.greenNumber ? 'green' : (REDS.includes(num) ? 'red' : 'black');

  let profit = 0;
  if (choice === 'green' && num === CONFIG.games.roulette.greenNumber) profit = game.bet * CONFIG.games.roulette.payoutProfitMultipliers.green;
  else if (choice === col && choice !== 'green') profit = game.bet * CONFIG.games.roulette.payoutProfitMultipliers.redOrBlack;

  const bal = store.getBalance(uid);
  if (profit > 0) {
    const boostedProfit = store.applyProfitBoost(uid, 'roulette', profit);
    const pityResult = store.recordWin(uid, 'roulette', boostedProfit);
    await maybeAnnouncePityTrigger(interaction, uid, pityResult);
    const tax = store.addToUniversalPool(boostedProfit, uid);
    store.setBalance(uid, bal + boostedProfit - tax);
    const taxLine = tax > 0 ? `\n${store.formatNumber(tax)} tax to pool` : '';
    await interaction.update({ embeds: [{
      color: 0x57f287,
      title: '🎡 Roulette',
      description: `Ball: **${num} (${col.toUpperCase()})**\nWon **${store.formatNumber(boostedProfit - tax)}**${taxLine}\nBalance: **${store.formatNumber(store.getBalance(uid))}**`,
    }], components: [] });
  } else {
    const pityResult = store.recordLoss(uid, 'roulette', game.bet);
    await maybeAnnouncePityTrigger(interaction, uid, pityResult);
    store.setBalance(uid, bal - game.bet);
    const cb = store.applyCashback(uid, game.bet);
    store.addToLossPool(game.bet);
    const cbm = cb > 0 ? ` (+${store.formatNumber(cb)} back)` : '';
    await interaction.update({ embeds: [{
      color: 0xed4245,
      title: '🎡 Roulette',
      description: `Ball: **${num} (${col.toUpperCase()})**\nLost **${store.formatNumber(game.bet)}**${cbm}\nBalance: **${store.formatNumber(store.getBalance(uid))}**`,
    }], components: [] });
  }
  activeGames.delete(uid);
  persistRouletteSessions();
}

// All-in roulette shortcut on 17 black.
async function handleAllIn17(interaction) {
  const userId = interaction.user.id;
  const purse = store.getBalance(userId);
  if (purse <= 0) {
    return interaction.reply({ embeds: [{ color: 0xed4245, description: 'Your purse is empty. This command uses purse coins only.' }] });
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`allin17_yes_${userId}`)
      .setLabel('Yes, send it')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`allin17_no_${userId}`)
      .setLabel("No, I'm scared")
      .setStyle(ButtonStyle.Danger),
  );

  return interaction.reply({
    embeds: [{
      color: 0xfee75c,
      title: '🎰 ALL IN 17 BLACK',
      description: `Are you sure you want to risk everything?\nThis bet uses **purse only** (bank is safe).\n\nCurrent purse: **${store.formatNumber(purse)}**`,
    }],
    components: [row],
  });
}

async function handleAllIn17Button(interaction, parts) {
  const action = parts[1];
  const uid = parts[2];

  if (interaction.user.id !== uid) {
    return interaction.reply({ content: 'This confirmation is not yours.', ephemeral: true });
  }

  if (action === 'no') {
    return interaction.update({
      embeds: [{ color: 0x5865f2, description: 'Cancelled. Your purse and bank are unchanged.' }],
      components: [],
    });
  }

  if (action !== 'yes') {
    return interaction.reply({ content: 'Invalid choice.', ephemeral: true });
  }

  const purse = store.getBalance(uid);
  if (purse <= 0) {
    return interaction.update({
      embeds: [{ color: 0xed4245, description: 'Your purse is empty now. This command uses purse coins only.' }],
      components: [],
    });
  }

  const num = Math.floor(Math.random() * CONFIG.games.roulette.wheelSize);
  const col = num === CONFIG.games.roulette.greenNumber ? 'green' : (REDS.includes(num) ? 'red' : 'black');

  if (num === CONFIG.games.roulette.allIn.luckyNumber) {
    const baseProfit = purse * CONFIG.games.roulette.payoutProfitMultipliers.allIn17;
    const boostedProfit = store.applyProfitBoost(uid, 'roulette', baseProfit);
    const pityResult = store.recordWin(uid, 'roulette', boostedProfit);
    await maybeAnnouncePityTrigger(interaction, uid, pityResult);
    const tax = store.addToUniversalPool(boostedProfit, uid);
    const payout = purse + boostedProfit - tax;
    store.setBalance(uid, payout);
    const taxLine = tax > 0 ? `\n${store.formatNumber(tax)} tax to pool` : '';
    return interaction.update({
      embeds: [{
        color: 0x57f287,
        title: '🎰 ALL IN 17 BLACK',
        description: `Ball: **17 (BLACK)**\n\n🎉🎉🎉 **HIT!!!** 🎉🎉🎉\nPurse: ${store.formatNumber(purse)} -> **${store.formatNumber(payout)}**${taxLine}\nBank was not touched.`,
      }],
      components: [],
    });
  }

  const pityResult = store.recordLoss(uid, 'roulette', purse);
  await maybeAnnouncePityTrigger(interaction, uid, pityResult);
  store.setBalance(uid, 0);
  const cb = store.applyCashback(uid, purse);
  store.addToLossPool(purse);
  const cbm = cb > 0 ? `\nCashback: +${store.formatNumber(cb)} to purse` : '';
  return interaction.update({
    embeds: [{
      color: 0xed4245,
      title: '🎰 ALL IN 17 BLACK',
      description: `Ball: **${num} (${col.toUpperCase()})**\n\n💀 Lost **${store.formatNumber(purse)}** from purse.${cbm}\nBank was not touched.`,
    }],
    components: [],
  });
}

function expireSessions(ttlMs) {
  const now = Date.now();
  let expired = 0;
  for (const [uid, game] of activeGames) {
    if (game.createdAt && now - game.createdAt > ttlMs) {
      activeGames.delete(uid);
      expired++;
    }
  }
  if (expired > 0) persistRouletteSessions();
  return expired;
}

module.exports = {
  activeGames,
  handleRoulette, handleRouletteButton,
  handleAllIn17, handleAllIn17Button,
  expireSessions,
};
