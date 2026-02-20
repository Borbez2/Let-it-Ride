const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { createDeck, getHandValue, formatCard, formatHand, canSplit } = require('./cards');
const { CONFIG } = require('../config');
const store = require('../data/store');

const activeGames = new Map();
const activeSplitGames = new Map();

async function maybeAnnouncePityTrigger(interaction, userId, pityResult) {
  if (!pityResult || !pityResult.triggered) return;
  const channel = interaction.channel;
  if (!channel || typeof channel.send !== 'function') return;

  const cashbackPct = (pityResult.cashbackRate * 100).toFixed(1);

  await channel.send(
    `\u2618 <@${userId}> luck triggered: ${cashbackPct}% cashback | loss streak: ${pityResult.lossStreak}`
  ).catch(() => null);
}

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

function renderSplitStatus(game) {
  let t = `${CONFIG.games.blackjack.labels.splitTitle} - ${store.formatNumber(game.betPerHand)} per hand\n\n`;
  for (let h = 0; h < game.hands.length; h++) {
    const hand = game.hands[h], val = getHandValue(hand.cards);
    const st = hand.done ? (val > 21 ? ' BUST' : ' ✓') : (h === game.activeHand ? ' ◀' : '');
    t += `Hand ${h + 1}: ${formatHand(hand.cards)} (${val})${st}\n`;
  }
  t += `\nDealer: ${formatCard(game.dealerHand[0])} + ?`;
  return t;
}

// Resolve the dealer hand and all split hands.
async function resolveSplitGame(interaction, uid, game) {
  let dv = getHandValue(game.dealerHand);
  while (dv < CONFIG.games.blackjack.dealerStandValue) { game.dealerHand.push(game.deck.pop()); dv = getHandValue(game.dealerHand); }

  const totalStake = game.hands.reduce((sum, hand) => sum + hand.bet, 0);
  let payout = 0, rt = '';
  for (let h = 0; h < game.hands.length; h++) {
    const hh = game.hands[h], v = getHandValue(hh.cards);
    let o = '';
    if (hh.busted) {
      o = `BUST -${store.formatNumber(hh.bet)}`;
    }
    else if (dv > 21) {
      const boostedProfit = store.applyProfitBoost(uid, 'blackjack', hh.bet);
      payout += hh.bet + boostedProfit;
      o = `Dealer busts +${store.formatNumber(boostedProfit)}`;
    }
    else if (v > dv) {
      const boostedProfit = store.applyProfitBoost(uid, 'blackjack', hh.bet);
      payout += hh.bet + boostedProfit;
      o = `Win +${store.formatNumber(boostedProfit)}`;
    }
    else if (v < dv) {
      o = `Lose -${store.formatNumber(hh.bet)}`;
    }
    else { payout += hh.bet; o = `Push`; }
    rt += `Hand ${h + 1}: ${formatHand(hh.cards)} (${v}) ${o}\n`;
  }

  const profit = payout - totalStake;
  const netProfit = Math.max(0, profit);
  const netLoss = Math.max(0, -profit);
  let cashback = 0;

  store.setBalance(uid, store.getBalance(uid) + payout);
  if (netProfit > 0) {
    const pityResult = store.recordWin(uid, 'blackjack', netProfit);
    await maybeAnnouncePityTrigger(interaction, uid, pityResult);
    store.addToUniversalPool(netProfit);
  }
  if (netLoss > 0) {
    const pityResult = store.recordLoss(uid, 'blackjack', netLoss);
    await maybeAnnouncePityTrigger(interaction, uid, pityResult);
    cashback = store.applyCashback(uid, netLoss);
    store.addToLossPool(netLoss);
  }
  activeSplitGames.delete(uid);
  persistBlackjackSessions();

  const cashbackLine = cashback > 0 ? `\nCashback: **+${store.formatNumber(cashback)}**` : '';

  return interaction.update({
    content: `🃏 **Blackjack Split Results**\n\n${rt}\nDealer: ${formatHand(game.dealerHand)} (${dv})\n\nNet: **${profit >= 0 ? '+' : ''}${store.formatNumber(profit)}**${cashbackLine}\nBalance: **${store.formatNumber(store.getBalance(uid))}**`,
    components: [],
  });
}

// Resolve a regular blackjack round after stand/double.
// The bet is already deducted at game start:
//   win  => return bet + winnings
//   lose => no further deduction needed
//   push => return bet
async function resolveStandard(interaction, uid, game, doubled) {
  const pv = getHandValue(game.playerHand);
  const bal = store.getBalance(uid);
  let dv = getHandValue(game.dealerHand);
  while (dv < CONFIG.games.blackjack.dealerStandValue) { game.dealerHand.push(game.deck.pop()); dv = getHandValue(game.dealerHand); }

  let res;
  if (dv > 21) {
    const boostedProfit = store.applyProfitBoost(uid, 'blackjack', game.bet);
    const pityResult = store.recordWin(uid, 'blackjack', boostedProfit);
    await maybeAnnouncePityTrigger(interaction, uid, pityResult);
    store.setBalance(uid, bal + game.bet + boostedProfit); store.addToUniversalPool(boostedProfit);
    res = `Dealer busts! +**${store.formatNumber(boostedProfit)}**\nBalance: **${store.formatNumber(store.getBalance(uid))}**`;
  } else if (pv > dv) {
    const boostedProfit = store.applyProfitBoost(uid, 'blackjack', game.bet);
    const pityResult = store.recordWin(uid, 'blackjack', boostedProfit);
    await maybeAnnouncePityTrigger(interaction, uid, pityResult);
    store.setBalance(uid, bal + game.bet + boostedProfit); store.addToUniversalPool(boostedProfit);
    res = `Win! ${pv}>${dv} +**${store.formatNumber(boostedProfit)}**\nBalance: **${store.formatNumber(store.getBalance(uid))}**`;
  } else if (dv > pv) {
    const pityResult = store.recordLoss(uid, 'blackjack', game.bet);
    await maybeAnnouncePityTrigger(interaction, uid, pityResult);
    // bet already deducted, no further deduction needed
    const cb = store.applyCashback(uid, game.bet); store.addToLossPool(game.bet);
    const cbm = cb > 0 ? ` (+${store.formatNumber(cb)} back)` : '';
    res = `Dealer wins ${dv}>${pv}\n-**${store.formatNumber(game.bet)}**${cbm}\nBalance: **${store.formatNumber(store.getBalance(uid))}**`;
  } else {
    // push, return the bet
    store.setBalance(uid, bal + game.bet);
    res = `Push at ${pv}. Bet returned.\nBalance: **${store.formatNumber(bal + game.bet)}**`;
  }

  activeGames.delete(uid);
  persistBlackjackSessions();
  const label = doubled ? CONFIG.games.blackjack.labels.resultDoubled : CONFIG.games.blackjack.labels.resultBase;
  return interaction.update({
    content: `🃏 **${label}**\nYou: ${formatHand(game.playerHand)} (${pv})\nDealer: ${formatHand(game.dealerHand)} (${dv})\n${res}`,
    components: [],
  });
}

// Slash command handler.
async function handleCommand(interaction) {
  const userId = interaction.user.id;
  const rawAmount = interaction.options.getString('amount');
  const balance = store.getBalance(userId);
  if (balance <= 0) return interaction.reply(`Not enough coins. You only have **${store.formatNumber(balance)}**`);
  
  const bet = store.parseAmount(rawAmount, balance);
  if (!bet || bet <= 0) {
    return interaction.reply(CONFIG.commands.invalidAmountText);
  }
  
  const bal = store.getBalance(userId);
  if (bet > bal) return interaction.reply(`You only have **${store.formatNumber(bal)}**`);

  // Deduct the bet up front so funds are reserved.
  store.setBalance(userId, bal - bet);

  const deck = createDeck();
  const ph = [deck.pop(), deck.pop()], dh = [deck.pop(), deck.pop()];
  const pv = getHandValue(ph);

  activeGames.set(userId, { bet, game: 'blackjack', deck, playerHand: ph, dealerHand: dh });
  persistBlackjackSessions();

  // Handle a natural blackjack.
  if (pv === 21) {
    const dvv = getHandValue(dh);
    activeGames.delete(userId);
    persistBlackjackSessions();
    if (dvv === 21) {
      // Push, return the original bet.
      store.setBalance(userId, bal);
      return interaction.reply(`✅ 🃏 **Blackjack**\nYou: ${formatHand(ph)} (21)\nDealer: ${formatHand(dh)} (21)\nPush! Balance: **${store.formatNumber(bal)}**`);
    }
    // Blackjack pays 2.5x total (bet back + 1.5x profit).
    const baseProfit = Math.floor(bet * CONFIG.games.blackjack.naturalBlackjackProfitMultiplier);
    const boostedProfit = store.applyProfitBoost(userId, 'blackjack', baseProfit);
    const pityResult = store.recordWin(userId, 'blackjack', boostedProfit);
    await maybeAnnouncePityTrigger(interaction, userId, pityResult);
    store.setBalance(userId, bal + boostedProfit);
    store.addToUniversalPool(boostedProfit);
    return interaction.reply(`✅ 🃏 **Blackjack**\nYou: ${formatHand(ph)} (21 BLACKJACK!)\nDealer: ${formatHand(dh)} (${dvv})\nWon **${store.formatNumber(boostedProfit)}**! Balance: **${store.formatNumber(store.getBalance(userId))}**`);
  }

  // Check if the player can afford a double/split using remaining balance.
  const currentBal = store.getBalance(userId);
  const cd = currentBal >= bet, cs = canSplit(ph) && currentBal >= bet;
  return interaction.reply({
    content: `🃏 **Blackjack** - Bet: ${store.formatNumber(bet)}\nYou: ${formatHand(ph)} (${pv})\nDealer: ${formatCard(dh[0])} + ?`,
    components: [bjButtons(userId, cd, cs)],
  });
}

// Button interaction handler.
async function handleButton(interaction, parts) {
  const uid = interaction.user.id;

  // Split-hand buttons.
  if (interaction.customId.startsWith('bjsplit_')) {
    const hi = parseInt(parts[1]), act = parts[2], ownerId = parts[3];
    if (uid !== ownerId) return interaction.reply({ content: "Not yours!", ephemeral: true });
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
    return interaction.update({ content: renderSplitStatus(game), components: [bjButtons(uid, cd, false, game.activeHand)] });
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
    const sg = { hands: [h1, h2], dealerHand: game.dealerHand, deck: game.deck, betPerHand: game.bet, activeHand: 0 };
    activeSplitGames.set(uid, sg);
    activeGames.delete(uid);
    persistBlackjackSessions();
    const cd = store.getBalance(uid) >= game.bet && h1.cards.length === 2;
    return interaction.update({ content: renderSplitStatus(sg), components: [bjButtons(uid, cd, false, 0)] });
  }

  if (act === 'double') {
    // Deduct the extra bet when doubling.
    const bal = store.getBalance(uid);
    if (bal < game.bet) return interaction.reply({ content: "Can't double!", ephemeral: true });
    store.setBalance(uid, bal - game.bet);
    game.bet *= 2;
    game.playerHand.push(game.deck.pop());
    persistBlackjackSessions();
    const pv = getHandValue(game.playerHand);
    if (pv > 21) {
      // Bust after doubling; the full bet is already deducted.
      const pityResult = store.recordLoss(uid, 'blackjack', game.bet);
      await maybeAnnouncePityTrigger(interaction, uid, pityResult);
      const cb = store.applyCashback(uid, game.bet);
      store.addToLossPool(game.bet);
      const cbm = cb > 0 ? `\n+${store.formatNumber(cb)} cashback` : '';
      activeGames.delete(uid);
      persistBlackjackSessions();
      return interaction.update({
        content: `🃏 **Blackjack - Doubled**\nYou: ${formatHand(game.playerHand)} (${pv}) BUST\nDealer: ${formatHand(game.dealerHand)} (${getHandValue(game.dealerHand)})\nLost **${store.formatNumber(game.bet)}**${cbm}\nBalance: **${store.formatNumber(store.getBalance(uid))}**`,
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
      // Bust on hit; the bet was already deducted at game start.
      const pityResult = store.recordLoss(uid, 'blackjack', game.bet);
      await maybeAnnouncePityTrigger(interaction, uid, pityResult);
      const cb = store.applyCashback(uid, game.bet);
      store.addToLossPool(game.bet);
      const cbm = cb > 0 ? `\n+${store.formatNumber(cb)} cashback` : '';
      activeGames.delete(uid);
      persistBlackjackSessions();
      return interaction.update({
        content: `🃏 **Blackjack**\nYou: ${formatHand(game.playerHand)} (${pv}) BUST\nDealer: ${formatHand(game.dealerHand)} (${getHandValue(game.dealerHand)})\nLost **${store.formatNumber(game.bet)}**${cbm}\nBalance: **${store.formatNumber(store.getBalance(uid))}**`,
        components: [],
      });
    }
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`bj_hit_${uid}`).setLabel('Hit').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`bj_stand_${uid}`).setLabel('Stand').setStyle(ButtonStyle.Secondary),
    );
    return interaction.update({
      content: `🃏 **Blackjack**\nYou: ${formatHand(game.playerHand)} (${pv})\nDealer: ${formatCard(game.dealerHand[0])} + ?`,
      components: [row],
    });
  }

  if (act === 'stand') {
    return resolveStandard(interaction, uid, game, false);
  }
}

module.exports = { handleCommand, handleButton, activeGames, activeSplitGames };
