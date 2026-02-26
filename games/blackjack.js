const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { createDeck, getHandValue, formatCard, formatHand, canSplit } = require('./cards');
const { CONFIG } = require('../config');
const store = require('../data/store');

const activeGames = new Map();
const activeSplitGames = new Map();

/* ── Pity announcement (luck buff triggered) ────────────── */

async function maybeAnnouncePityTrigger(interaction, userId, pityResult) {
  if (!pityResult || !pityResult.triggered) return;
  const channel = interaction.channel;
  if (!channel || typeof channel.send !== 'function') return;

  const boostPct = (pityResult.winChanceBoost * 100).toFixed(1);
  await channel.send({
    embeds: [{
      description: `☘ <@${userId}> luck triggered: **+${boostPct}%** win chance boost | loss streak: ${pityResult.lossStreak}`,
      color: 0x57f287,
    }],
  }).catch(() => null);
}

/* ── Session persistence ────────────────────────────────── */

function persistBlackjackSessions() {
  store.setRuntimeState('session:blackjack', {
    activeGames: Object.fromEntries(activeGames),
    activeSplitGames: Object.fromEntries(activeSplitGames),
  });
}

function restoreBlackjackSessions() {
  const state = store.getRuntimeState('session:blackjack', null);
  if (!state || typeof state !== 'object') return;
  if (state.activeGames && typeof state.activeGames === 'object') {
    for (const [uid, game] of Object.entries(state.activeGames)) {
      activeGames.set(uid, game);
    }
  }
  if (state.activeSplitGames && typeof state.activeSplitGames === 'object') {
    for (const [uid, game] of Object.entries(state.activeSplitGames)) {
      activeSplitGames.set(uid, game);
    }
  }
}

restoreBlackjackSessions();

/* ── UI helpers ─────────────────────────────────────────── */

function bjButtons(userId, canDbl, canSplt, handIdx) {
  const pfx = handIdx !== undefined ? `bjsplit_${handIdx}` : 'bj';
  const btns = [
    new ButtonBuilder().setCustomId(`${pfx}_hit_${userId}`).setLabel('Hit').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`${pfx}_stand_${userId}`).setLabel('Stand').setStyle(ButtonStyle.Secondary),
  ];
  if (canDbl) btns.push(new ButtonBuilder().setCustomId(`${pfx}_double_${userId}`).setLabel('Double').setStyle(ButtonStyle.Danger));
  if (canSplt) btns.push(new ButtonBuilder().setCustomId(`${pfx}_split_${userId}`).setLabel('Split').setStyle(ButtonStyle.Success));
  return new ActionRowBuilder().addComponents(btns);
}

/** Build an in-progress embed (blue) showing player/dealer hands. */
function buildHandEmbed(title, playerCards, dealerStr, bet, extra) {
  const pv = getHandValue(playerCards);
  const fields = [
    { name: 'Your Hand', value: `${formatHand(playerCards)} (${pv})`, inline: true },
    { name: 'Dealer', value: dealerStr, inline: true },
  ];
  if (extra) fields.push({ name: '\u200b', value: extra, inline: false });
  return {
    title: `🃏 ${title}`,
    color: 0x5865f2,
    fields,
    footer: { text: `Bet: ${store.formatNumber(bet)}` },
  };
}

/** Build a result embed with color-coded outcome. */
function buildResultEmbed({ title, playerCards, pv, dealerCards, dv, outcome, color, details }) {
  const fields = [
    { name: 'Your Hand', value: `${formatHand(playerCards)} (${pv})`, inline: true },
    { name: 'Dealer', value: `${formatHand(dealerCards)} (${dv})`, inline: true },
    { name: '\u200b', value: '\u200b', inline: false },
  ];
  if (details) {
    for (const d of details) {
      fields.push({ name: d.name, value: d.value, inline: d.inline ?? true });
    }
  }
  return {
    title: `🃏 ${title}`,
    description: outcome,
    color,
    fields,
  };
}

function renderSplitStatus(game) {
  const fields = [];
  for (let h = 0; h < game.hands.length; h++) {
    const hand = game.hands[h], val = getHandValue(hand.cards);
    const st = hand.done ? (val > 21 ? ' BUST' : ' ✓') : (h === game.activeHand ? ' ◀' : '');
    fields.push({
      name: `Hand ${h + 1}${st}`,
      value: `${formatHand(hand.cards)} (${val})`,
      inline: true,
    });
  }
  fields.push({ name: '\u200b', value: '\u200b', inline: false });
  fields.push({
    name: 'Dealer',
    value: `${formatCard(game.dealerHand[0])} + ?`,
    inline: false,
  });
  return {
    title: `🃏 ${CONFIG.games.blackjack.labels.splitTitle}`,
    color: 0x5865f2,
    fields,
    footer: { text: `${store.formatNumber(game.betPerHand)} per hand` },
  };
}

/* ── Resolve split game ─────────────────────────────────── */

async function resolveSplitGame(interaction, uid, game) {
  let dv = getHandValue(game.dealerHand);
  while (dv < CONFIG.games.blackjack.dealerStandValue) {
    game.dealerHand.push(game.deck.pop());
    dv = getHandValue(game.dealerHand);
  }

  const totalStake = game.hands.reduce((sum, hand) => sum + hand.bet, 0);
  let payout = 0;
  const handFields = [];

  for (let h = 0; h < game.hands.length; h++) {
    const hh = game.hands[h], v = getHandValue(hh.cards);
    let o = '';
    if (hh.busted) {
      o = `BUST -${store.formatNumber(hh.bet)}`;
    } else if (dv > 21) {
      const { profit: boostedProfit, effects } = store.applyProfitBoost(uid, 'blackjack', hh.bet);
      payout += hh.bet + boostedProfit;
      o = `Dealer busts +${store.formatNumber(boostedProfit)}`;
      if (effects && effects.length) o += '\n' + effects.join('\n');
    } else if (v > dv) {
      const { profit: boostedProfit, effects } = store.applyProfitBoost(uid, 'blackjack', hh.bet);
      payout += hh.bet + boostedProfit;
      o = `Win +${store.formatNumber(boostedProfit)}`;
      if (effects && effects.length) o += '\n' + effects.join('\n');
    } else if (v < dv) {
      o = `Lose -${store.formatNumber(hh.bet)}`;
    } else {
      payout += hh.bet;
      o = 'Push';
    }
    handFields.push({
      name: `Hand ${h + 1}`,
      value: `${formatHand(hh.cards)} (${v})\n${o}`,
      inline: true,
    });
  }

  const profit = payout - totalStake;
  const netProfit = Math.max(0, profit);
  const netLoss = Math.max(0, -profit);
  let cashback = 0;
  let splitTax = 0;

  store.setBalance(uid, store.getBalance(uid) + payout);
  if (netProfit > 0) {
    const pityResult = store.recordWin(uid, 'blackjack', netProfit);
    await maybeAnnouncePityTrigger(interaction, uid, pityResult);
    splitTax = store.addToUniversalPool(netProfit, uid);
    store.setBalance(uid, store.getBalance(uid) - splitTax);
  }
  if (netLoss > 0) {
    const pityResult = store.recordLoss(uid, 'blackjack', netLoss);
    await maybeAnnouncePityTrigger(interaction, uid, pityResult);
    cashback = store.applyCashback(uid, netLoss);
    store.addToLossPool(netLoss);
  }
  activeSplitGames.delete(uid);
  persistBlackjackSessions();

  const color = profit > 0 ? 0x57f287 : profit < 0 ? 0xed4245 : 0x5865f2;
  const sign = profit >= 0 ? '+' : '';

  const detailParts = [`**Net: ${sign}${store.formatNumber(profit)}**`];
  if (cashback > 0) detailParts.push(`Cashback: +${store.formatNumber(cashback)}`);
  if (splitTax > 0) detailParts.push(`${store.formatNumber(splitTax)} tax → pool`);
  detailParts.push(`Balance: **${store.formatNumber(store.getBalance(uid))}**`);

  handFields.push({ name: '\u200b', value: '\u200b', inline: false });
  handFields.push({
    name: 'Dealer',
    value: `${formatHand(game.dealerHand)} (${dv})`,
    inline: false,
  });

  return interaction.update({
    content: '',
    embeds: [{
      title: '🃏 Blackjack Split Results',
      color,
      fields: handFields,
      description: detailParts.join('\n'),
    }],
    components: [],
  });
}

/* ── Resolve standard hand ──────────────────────────────── */

async function resolveStandard(interaction, uid, game, doubled) {
  const pv = getHandValue(game.playerHand);
  const bal = store.getBalance(uid);
  let dv = getHandValue(game.dealerHand);
  while (dv < CONFIG.games.blackjack.dealerStandValue) {
    game.dealerHand.push(game.deck.pop());
    dv = getHandValue(game.dealerHand);
  }

  const label = doubled ? CONFIG.games.blackjack.labels.resultDoubled : CONFIG.games.blackjack.labels.resultBase;
  let outcome, color, detailParts = [];

  if (dv > 21) {
    const { profit: boostedProfit, effects } = store.applyProfitBoost(uid, 'blackjack', game.bet);
    const pityResult = store.recordWin(uid, 'blackjack', boostedProfit);
    await maybeAnnouncePityTrigger(interaction, uid, pityResult);
    const tax = store.addToUniversalPool(boostedProfit, uid);
    store.setBalance(uid, bal + game.bet + boostedProfit - tax);
    if (tax > 0) detailParts.push(`${store.formatNumber(tax)} tax → pool`);
    outcome = `Dealer busts! **+${store.formatNumber(boostedProfit - tax)}**`;
    if (effects && effects.length) outcome += '\n' + effects.join('\n');
    color = 0x57f287;
  } else if (pv > dv) {
    const { profit: boostedProfit, effects } = store.applyProfitBoost(uid, 'blackjack', game.bet);
    const pityResult = store.recordWin(uid, 'blackjack', boostedProfit);
    await maybeAnnouncePityTrigger(interaction, uid, pityResult);
    const tax = store.addToUniversalPool(boostedProfit, uid);
    store.setBalance(uid, bal + game.bet + boostedProfit - tax);
    if (tax > 0) detailParts.push(`${store.formatNumber(tax)} tax → pool`);
    outcome = `You win! ${pv} > ${dv} - **+${store.formatNumber(boostedProfit - tax)}**`;
    if (effects && effects.length) outcome += '\n' + effects.join('\n');
    color = 0x57f287;
  } else if (dv > pv) {
    const pityResult = store.recordLoss(uid, 'blackjack', game.bet);
    await maybeAnnouncePityTrigger(interaction, uid, pityResult);
    const cb = store.applyCashback(uid, game.bet);
    store.addToLossPool(game.bet);
    if (cb > 0) detailParts.push(`+${store.formatNumber(cb)} cashback`);
    outcome = `Dealer wins ${dv} > ${pv} - **-${store.formatNumber(game.bet)}**`;
    color = 0xed4245;
  } else {
    store.setBalance(uid, bal + game.bet);
    outcome = `Push at ${pv}. Bet returned.`;
    color = 0x5865f2;
  }

  activeGames.delete(uid);
  persistBlackjackSessions();

  detailParts.push(`Balance: **${store.formatNumber(store.getBalance(uid))}**`);

  return interaction.update({
    content: '',
    embeds: [buildResultEmbed({
      title: label,
      playerCards: game.playerHand,
      pv,
      dealerCards: game.dealerHand,
      dv,
      outcome,
      color,
      details: [{ name: '\u200b', value: detailParts.join('\n'), inline: false }],
    })],
    components: [],
  });
}

/* ── Slash command handler ──────────────────────────────── */

async function handleCommand(interaction) {
  const userId = interaction.user.id;
  const rawAmount = interaction.options.getString('amount');
  const balance = store.getBalance(userId);
  if (balance <= 0) {
    return interaction.reply({
      embeds: [{ description: `You don't have enough coins. Balance: **${store.formatNumber(balance)}**`, color: 0xed4245 }],
      ephemeral: true,
    });
  }

  const bet = store.parseAmount(rawAmount, balance);
  if (!bet || bet <= 0) {
    return interaction.reply({ content: CONFIG.commands.invalidAmountText, ephemeral: true });
  }

  const bal = store.getBalance(userId);
  if (bet > bal) {
    return interaction.reply({
      embeds: [{ description: `You only have **${store.formatNumber(bal)}**`, color: 0xed4245 }],
      ephemeral: true,
    });
  }

  // Deduct the bet up front so funds are reserved.
  store.setBalance(userId, bal - bet);

  const deck = createDeck();
  const ph = [deck.pop(), deck.pop()], dh = [deck.pop(), deck.pop()];
  const pv = getHandValue(ph);

  activeGames.set(userId, { bet, game: 'blackjack', deck, playerHand: ph, dealerHand: dh, createdAt: Date.now() });
  persistBlackjackSessions();

  // Handle a natural blackjack.
  if (pv === 21) {
    const dvv = getHandValue(dh);
    activeGames.delete(userId);
    persistBlackjackSessions();
    if (dvv === 21) {
      // Push, return the original bet.
      store.setBalance(userId, bal);
      return interaction.reply({
        embeds: [buildResultEmbed({
          title: 'Blackjack - Push',
          playerCards: ph, pv: 21,
          dealerCards: dh, dv: 21,
          outcome: 'Both natural 21. Bet returned.',
          color: 0x5865f2,
          details: [{ name: '\u200b', value: `Balance: **${store.formatNumber(bal)}**`, inline: false }],
        })],
      });
    }
    // Blackjack pays 2.5x total (bet back + 1.5x profit).
    const baseProfit = Math.floor(bet * CONFIG.games.blackjack.naturalBlackjackProfitMultiplier);
    const { profit: boostedProfit, effects } = store.applyProfitBoost(userId, 'blackjack', baseProfit);
    const pityResult = store.recordWin(userId, 'blackjack', boostedProfit);
    await maybeAnnouncePityTrigger(interaction, userId, pityResult);
    const tax = store.addToUniversalPool(boostedProfit, userId);
    store.setBalance(userId, bal + boostedProfit - tax);
    const taxLine = tax > 0 ? `\n${store.formatNumber(tax)} tax → pool` : '';
    const effectLine = effects && effects.length ? `\n${effects.join('\n')}` : '';
    return interaction.reply({
      embeds: [buildResultEmbed({
        title: 'Blackjack!',
        playerCards: ph, pv: 21,
        dealerCards: dh, dv: dvv,
        outcome: `🎉 Natural Blackjack! **+${store.formatNumber(boostedProfit - tax)}**${effectLine}`,
        color: 0x57f287,
        details: [{ name: '\u200b', value: `${taxLine ? store.formatNumber(tax) + ' tax → pool\n' : ''}Balance: **${store.formatNumber(store.getBalance(userId))}**`, inline: false }],
      })],
    });
  }

  // Check if the player can afford a double/split using remaining balance.
  const currentBal = store.getBalance(userId);
  const cd = currentBal >= bet, cs = canSplit(ph) && currentBal >= bet;
  return interaction.reply({
    embeds: [buildHandEmbed('Blackjack', ph, `${formatCard(dh[0])} + ?`, bet)],
    components: [bjButtons(userId, cd, cs)],
  });
}

/* ── Button handler ─────────────────────────────────────── */

async function handleButton(interaction, parts) {
  const uid = interaction.user.id;

  // Split-hand buttons.
  if (interaction.customId.startsWith('bjsplit_')) {
    const hi = parseInt(parts[1]), act = parts[2], ownerId = parts[3];
    if (uid !== ownerId) return interaction.reply({ content: "Not your game!", ephemeral: true });
    const game = activeSplitGames.get(uid);
    if (!game) return interaction.reply({ content: "Expired!", ephemeral: true });
    const hand = game.hands[hi];
    if (!hand || hand.done) return interaction.reply({ content: "Hand done!", ephemeral: true });

    if (act === 'hit') {
      hand.cards.push(game.deck.pop());
      if (getHandValue(hand.cards) > 21) { hand.done = true; hand.busted = true; }
      persistBlackjackSessions();
    } else if (act === 'stand') {
      hand.done = true;
      persistBlackjackSessions();
    } else if (act === 'double') {
      const bal = store.getBalance(uid);
      if (bal < game.betPerHand) return interaction.reply({ content: "Can't double!", ephemeral: true });
      store.setBalance(uid, bal - game.betPerHand);
      hand.bet *= 2;
      hand.cards.push(game.deck.pop());
      hand.done = true;
      if (getHandValue(hand.cards) > 21) hand.busted = true;
      persistBlackjackSessions();
    }

    if (hand.done) {
      game.activeHand = -1;
      for (let h = 0; h < game.hands.length; h++) {
        if (!game.hands[h].done) { game.activeHand = h; break; }
      }
    }

    if (game.activeHand === -1) return resolveSplitGame(interaction, uid, game);

    const ah = game.hands[game.activeHand];
    const cd = store.getBalance(uid) >= game.betPerHand && ah.cards.length === 2;
    return interaction.update({ content: '', embeds: [renderSplitStatus(game)], components: [bjButtons(uid, cd, false, game.activeHand)] });
  }

  // Standard blackjack buttons.
  const act = parts[1];
  const game = activeGames.get(uid);
  if (!game) return interaction.reply({ content: "Expired!", ephemeral: true });

  if (act === 'split') {
    // Pay for the second hand; the first bet was already deducted.
    const bal = store.getBalance(uid);
    if (bal < game.bet) return interaction.reply({ content: "Can't afford split!", ephemeral: true });
    store.setBalance(uid, bal - game.bet);
    const h1 = { cards: [game.playerHand[0], game.deck.pop()], bet: game.bet, done: false, busted: false };
    const h2 = { cards: [game.playerHand[1], game.deck.pop()], bet: game.bet, done: false, busted: false };
    const sg = { hands: [h1, h2], dealerHand: game.dealerHand, deck: game.deck, betPerHand: game.bet, activeHand: 0, createdAt: Date.now() };
    activeSplitGames.set(uid, sg);
    activeGames.delete(uid);
    persistBlackjackSessions();
    const cd = store.getBalance(uid) >= game.bet && h1.cards.length === 2;
    return interaction.update({ content: '', embeds: [renderSplitStatus(sg)], components: [bjButtons(uid, cd, false, 0)] });
  }

  if (act === 'double') {
    const bal = store.getBalance(uid);
    if (bal < game.bet) return interaction.reply({ content: "Can't double!", ephemeral: true });
    store.setBalance(uid, bal - game.bet);
    game.bet *= 2;
    game.playerHand.push(game.deck.pop());
    persistBlackjackSessions();
    const pv = getHandValue(game.playerHand);
    if (pv > 21) {
      const pityResult = store.recordLoss(uid, 'blackjack', game.bet);
      await maybeAnnouncePityTrigger(interaction, uid, pityResult);
      const cb = store.applyCashback(uid, game.bet);
      store.addToLossPool(game.bet);
      activeGames.delete(uid);
      persistBlackjackSessions();
      const detailParts = [];
      if (cb > 0) detailParts.push(`+${store.formatNumber(cb)} cashback`);
      detailParts.push(`Balance: **${store.formatNumber(store.getBalance(uid))}**`);
      return interaction.update({
        content: '',
        embeds: [buildResultEmbed({
          title: 'Blackjack - Doubled',
          playerCards: game.playerHand, pv,
          dealerCards: game.dealerHand, dv: getHandValue(game.dealerHand),
          outcome: `BUST! **-${store.formatNumber(game.bet)}**`,
          color: 0xed4245,
          details: [{ name: '\u200b', value: detailParts.join('\n'), inline: false }],
        })],
        components: [],
      });
    }
    return resolveStandard(interaction, uid, game, true);
  }

  if (act === 'hit') {
    game.playerHand.push(game.deck.pop());
    persistBlackjackSessions();
    const pv = getHandValue(game.playerHand);
    if (pv > 21) {
      const pityResult = store.recordLoss(uid, 'blackjack', game.bet);
      await maybeAnnouncePityTrigger(interaction, uid, pityResult);
      const cb = store.applyCashback(uid, game.bet);
      store.addToLossPool(game.bet);
      activeGames.delete(uid);
      persistBlackjackSessions();
      const detailParts = [];
      if (cb > 0) detailParts.push(`+${store.formatNumber(cb)} cashback`);
      detailParts.push(`Balance: **${store.formatNumber(store.getBalance(uid))}**`);
      return interaction.update({
        content: '',
        embeds: [buildResultEmbed({
          title: 'Blackjack',
          playerCards: game.playerHand, pv,
          dealerCards: game.dealerHand, dv: getHandValue(game.dealerHand),
          outcome: `BUST! **-${store.formatNumber(game.bet)}**`,
          color: 0xed4245,
          details: [{ name: '\u200b', value: detailParts.join('\n'), inline: false }],
        })],
        components: [],
      });
    }
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`bj_hit_${uid}`).setLabel('Hit').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`bj_stand_${uid}`).setLabel('Stand').setStyle(ButtonStyle.Secondary),
    );
    return interaction.update({
      content: '',
      embeds: [buildHandEmbed('Blackjack', game.playerHand, `${formatCard(game.dealerHand[0])} + ?`, game.bet)],
      components: [row],
    });
  }

  if (act === 'stand') {
    return resolveStandard(interaction, uid, game, false);
  }
}

/* ── Session expiry ─────────────────────────────────────── */

function expireSessions(ttlMs) {
  const now = Date.now();
  let expired = 0;
  for (const [uid, game] of activeGames) {
    if (game.createdAt && now - game.createdAt > ttlMs) {
      store.setBalance(uid, store.getBalance(uid) + game.bet);
      activeGames.delete(uid);
      expired++;
    }
  }
  for (const [uid, game] of activeSplitGames) {
    if (game.createdAt && now - game.createdAt > ttlMs) {
      const refund = game.hands.reduce((sum, h) => sum + h.bet, 0);
      store.setBalance(uid, store.getBalance(uid) + refund);
      activeSplitGames.delete(uid);
      expired++;
    }
  }
  if (expired > 0) persistBlackjackSessions();
  return expired;
}

module.exports = { handleCommand, handleButton, activeGames, activeSplitGames, expireSessions };
