const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { CONFIG } = require('../config');
const store = require('../data/store');
const { maybeAnnouncePityTrigger } = require('./shared');

const activeDuels = new Map();

function persistDuelSessions() {
  store.setRuntimeState('session:duel', {
    activeDuels: Object.fromEntries(activeDuels),
  });
}

function restoreDuelSessions() {
  const state = store.getRuntimeState('session:duel', null);
  if (state && state.activeDuels) {
    for (const [k, v] of Object.entries(state.activeDuels)) activeDuels.set(k, v);
  }
  // Migrate from old combined session key
  const oldState = store.getRuntimeState('session:simple', null);
  if (oldState && oldState.activeDuels) {
    for (const [k, v] of Object.entries(oldState.activeDuels)) {
      if (!activeDuels.has(k)) activeDuels.set(k, v);
    }
  }
}

restoreDuelSessions();

async function handleDuel(interaction) {
  const userId = interaction.user.id, username = interaction.user.username;
  const opp = interaction.options.getUser('opponent');
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
  if (opp.id === userId) return interaction.reply({ embeds: [{ color: 0xed4245, description: "Can't duel yourself." }] });
  if (opp.bot) return interaction.reply({ embeds: [{ color: 0xed4245, description: "Can't duel a bot." }] });
  if (bet > bal) return interaction.reply({ embeds: [{ color: 0xed4245, description: `You only have **${store.formatNumber(bal)}**` }] });

  // Hold challenger's money
  store.setBalance(userId, bal - bet);

  activeDuels.set(`${userId}_${opp.id}`, {
    bet, challengerName: username, opponentName: opp.username,
    challengerBalance: bal - bet, createdAt: Date.now(),
  });
  persistDuelSessions();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`duel_accept_${userId}_${opp.id}`).setLabel('Accept').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`duel_decline_${userId}_${opp.id}`).setLabel('Decline').setStyle(ButtonStyle.Danger),
  );
  return interaction.reply({
    embeds: [{
      color: 0x5865f2,
      title: '⚔️ Duel Challenge',
      description: `**${username}** challenges **${opp.username}** for **${store.formatNumber(bet)}**!\n${opp}, accept?`,
    }],
    components: [row],
  });
}

async function handleDuelButton(interaction, parts) {
  const action = parts[1], cid = parts[2], oid = parts[3];
  const dk = `${cid}_${oid}`, duel = activeDuels.get(dk);
  if (!duel) return interaction.reply({ content: 'Session expired.', ephemeral: true });
  if (interaction.user.id !== oid) return interaction.reply({ content: 'Not your duel!', ephemeral: true });

  if (action === 'decline') {
    store.setBalance(cid, store.getBalance(cid) + duel.bet);
    activeDuels.delete(dk);
    persistDuelSessions();
    return interaction.update({
      embeds: [{ color: 0xed4245, title: '⚔️ Duel Declined', description: `**${duel.opponentName}** declined the challenge.` }],
      components: [],
    });
  }

  if (action === 'accept') {
    const oppBal = store.getBalance(oid);
    if (oppBal < duel.bet) {
      store.setBalance(cid, store.getBalance(cid) + duel.bet);
      activeDuels.delete(dk);
      persistDuelSessions();
      return interaction.update({
        embeds: [{ color: 0xed4245, description: "Opponent can't afford the duel!" }],
        components: [],
      });
    }

    // Hold opponent's money
    store.setBalance(oid, oppBal - duel.bet);

    const duelModifier = store.getWinChanceModifier(cid);
    const w = Math.random() < CONFIG.games.duel.winChance * duelModifier ? cid : oid;
    const wn = w === cid ? duel.challengerName : duel.opponentName;
    const ln = w === cid ? duel.opponentName : duel.challengerName;
    const li = w === cid ? oid : cid;

    const boostedProfit = store.applyProfitBoost(w, 'duel', duel.bet);
    const pityWinResult = store.recordWin(w, 'duel', boostedProfit);
    await maybeAnnouncePityTrigger(interaction, w, pityWinResult);
    const pityLossResult = store.recordLoss(li, 'duel', duel.bet);
    await maybeAnnouncePityTrigger(interaction, li, pityLossResult);
    const tax = store.addToUniversalPool(boostedProfit, w);
    store.setBalance(w, store.getBalance(w) + duel.bet + boostedProfit - tax);

    activeDuels.delete(dk);
    persistDuelSessions();

    const taxLine = tax > 0 ? `\n${store.formatNumber(tax)} tax to pool` : '';
    return interaction.update({
      embeds: [{
        color: 0x57f287,
        title: '⚔️ Duel Result',
        description: `**${wn}** beats **${ln}** and wins **${store.formatNumber(boostedProfit - tax)}**!${taxLine}`,
      }],
      components: [],
    });
  }
}

function expireSessions(ttlMs) {
  const now = Date.now();
  let expired = 0;
  for (const [dk, duel] of activeDuels) {
    if (duel.createdAt && now - duel.createdAt > ttlMs) {
      const challengerId = dk.split('_')[0];
      store.setBalance(challengerId, store.getBalance(challengerId) + duel.bet);
      activeDuels.delete(dk);
      expired++;
    }
  }
  if (expired > 0) persistDuelSessions();
  return expired;
}

module.exports = {
  activeDuels,
  handleDuel, handleDuelButton,
  expireSessions,
};
