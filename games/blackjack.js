const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { createDeck, getHandValue, formatCard, formatHand, canSplit } = require('./cards');
const store = require('../data/store');

const activeGames = new Map();
const activeSplitGames = new Map();

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
  let t = `🃏 **Blackjack (Split)** - ${store.formatNumber(game.betPerHand)} per hand\n\n`;
  for (let h = 0; h < game.hands.length; h++) {
    const hand = game.hands[h], val = getHandValue(hand.cards);
    const st = hand.done ? (val > 21 ? ' BUST' : ' ✓') : (h === game.activeHand ? ' ◀' : '');
    t += `Hand ${h + 1}: ${formatHand(hand.cards)} (${val})${st}\n`;
  }
  t += `\nDealer: ${formatCard(game.dealerHand[0])} + ?`;
  return t;
}

// Resolve dealer + all split hands
function resolveSplitGame(interaction, uid, game) {
  let dv = getHandValue(game.dealerHand);
  while (dv < 17) { game.dealerHand.push(game.deck.pop()); dv = getHandValue(game.dealerHand); }

  let net = 0, rt = '';
  for (let h = 0; h < game.hands.length; h++) {
    const hh = game.hands[h], v = getHandValue(hh.cards);
    let o = '';
    if (hh.busted) { net -= hh.bet; o = `BUST -${store.formatNumber(hh.bet)}`; }
    else if (dv > 21) { net += hh.bet; o = `Dealer busts +${store.formatNumber(hh.bet)}`; }
    else if (v > dv) { net += hh.bet; o = `Win +${store.formatNumber(hh.bet)}`; }
    else if (v < dv) { net -= hh.bet; o = `Lose -${store.formatNumber(hh.bet)}`; }
    else { o = `Push`; }
    rt += `Hand ${h + 1}: ${formatHand(hh.cards)} (${v}) ${o}\n`;
  }

  store.setBalance(uid, store.getBalance(uid) + net);
  if (net > 0) {
    store.recordWin(uid, 'blackjack', net);
    store.addToUniversalPool(net);
  }
  if (net < 0) {
    store.recordLoss(uid, 'blackjack', Math.abs(net));
    store.applyCashback(uid, Math.abs(net));
    store.addToLossPool(Math.abs(net));
  }
  activeSplitGames.delete(uid);

  return interaction.update({
    content: `🃏 **Blackjack Split Results**\n\n${rt}\nDealer: ${formatHand(game.dealerHand)} (${dv})\n\nNet: **${net >= 0 ? '+' : ''}${store.formatNumber(net)}**\nBalance: **${store.formatNumber(store.getBalance(uid))}**`,
    components: [],
  });
}

// Standard blackjack resolve (stand / double after cards drawn)
// bet was already deducted at game start, so:
//   win  => return bet + profit (give back bet + winnings)
//   lose => already lost (bet was deducted)
//   push => return bet
function resolveStandard(interaction, uid, game, doubled) {
  const pv = getHandValue(game.playerHand);
  const bal = store.getBalance(uid);
  let dv = getHandValue(game.dealerHand);
  while (dv < 17) { game.dealerHand.push(game.deck.pop()); dv = getHandValue(game.dealerHand); }

  let res;
  if (dv > 21) {
    store.recordWin(uid, 'blackjack', game.bet);
    store.setBalance(uid, bal + game.bet * 2); store.addToUniversalPool(game.bet);
    res = `Dealer busts! +**${store.formatNumber(game.bet)}**\nBalance: **${store.formatNumber(bal + game.bet * 2)}**`;
  } else if (pv > dv) {
    store.recordWin(uid, 'blackjack', game.bet);
    store.setBalance(uid, bal + game.bet * 2); store.addToUniversalPool(game.bet);
    res = `Win! ${pv}>${dv} +**${store.formatNumber(game.bet)}**\nBalance: **${store.formatNumber(bal + game.bet * 2)}**`;
  } else if (dv > pv) {
    store.recordLoss(uid, 'blackjack', game.bet);
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
  const label = doubled ? 'Blackjack - Doubled' : 'Blackjack';
  return interaction.update({
    content: `🃏 **${label}**\nYou: ${formatHand(game.playerHand)} (${pv})\nDealer: ${formatHand(game.dealerHand)} (${dv})\n${res}`,
    components: [],
  });
}

// ─── Slash command handler ───
async function handleCommand(interaction) {
  const userId = interaction.user.id;
  const rawAmount = interaction.options.getString('amount');
  const balance = store.getBalance(userId);
  
  const bet = store.parseAmount(rawAmount, balance);
  if (!bet || bet <= 0) {
    return interaction.reply('Invalid amount. Use a number, "1k", "1m", or "all"');
  }
  
  const bal = store.getBalance(userId);
  if (bet > bal) return interaction.reply(`You only have **${store.formatNumber(bal)}**`);

  // Deduct bet upfront to hold the money
  store.setBalance(userId, bal - bet);

  const deck = createDeck();
  const ph = [deck.pop(), deck.pop()], dh = [deck.pop(), deck.pop()];
  const pv = getHandValue(ph);

  activeGames.set(userId, { bet, game: 'blackjack', deck, playerHand: ph, dealerHand: dh });

  // Natural 21
  if (pv === 21) {
    const dvv = getHandValue(dh);
    activeGames.delete(userId);
    if (dvv === 21) {
      // Push, return bet
      store.setBalance(userId, bal);
      return interaction.reply(`✅ 🃏 **Blackjack**\nYou: ${formatHand(ph)} (21)\nDealer: ${formatHand(dh)} (21)\nPush! Balance: **${store.formatNumber(bal)}**`);
    }
    // Blackjack pays 2.5x total (bet back + 1.5x profit)
    const profit = Math.floor(bet * 1.5);    store.recordWin(userId, 'blackjack', profit);    store.setBalance(userId, bal + profit); store.addToUniversalPool(profit);
    return interaction.reply(`✅ 🃏 **Blackjack**\nYou: ${formatHand(ph)} (21 BLACKJACK!)\nDealer: ${formatHand(dh)} (${dvv})\nWon **${store.formatNumber(profit)}**! Balance: **${store.formatNumber(bal + profit)}**`);
  }

  // Check if player can afford to double (they already paid bet, so they need another bet in balance)
  const currentBal = store.getBalance(userId);
  const cd = currentBal >= bet, cs = canSplit(ph) && currentBal >= bet;
  return interaction.reply({
    content: `🃏 **Blackjack** - Bet: ${store.formatNumber(bet)}\nYou: ${formatHand(ph)} (${pv})\nDealer: ${formatCard(dh[0])} + ?`,
    components: [bjButtons(userId, cd, cs)],
  });
}

// ─── Button handler ───
async function handleButton(interaction, parts) {
  const uid = interaction.user.id;

  // ── Split hand buttons ──
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
    } else if (act === 'stand') {
      hand.done = true;
    } else if (act === 'double') {
      const bal = store.getBalance(uid);
      if (bal < game.betPerHand) return interaction.reply({ content: "Can't double!", ephemeral: true });
      store.setBalance(uid, bal - game.betPerHand);
      hand.bet *= 2;
      hand.cards.push(game.deck.pop());
      hand.done = true;
      if (getHandValue(hand.cards) > 21) hand.busted = true;
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

  // ── Standard blackjack buttons ──
  const act = parts[1];
  const game = activeGames.get(uid);
  if (!game) return interaction.reply({ content: "Expired!", ephemeral: true });

  if (act === 'split') {
    // Need to pay for the second hand (first hand's bet already deducted at game start)
    const bal = store.getBalance(uid);
    if (bal < game.bet) return interaction.reply({ content: "Can't afford split!", ephemeral: true });
    store.setBalance(uid, bal - game.bet);
    const h1 = { cards: [game.playerHand[0], game.deck.pop()], bet: game.bet, done: false, busted: false };
    const h2 = { cards: [game.playerHand[1], game.deck.pop()], bet: game.bet, done: false, busted: false };
    const sg = { hands: [h1, h2], dealerHand: game.dealerHand, deck: game.deck, betPerHand: game.bet, activeHand: 0 };
    activeSplitGames.set(uid, sg);
    activeGames.delete(uid);
    const cd = store.getBalance(uid) >= game.bet && h1.cards.length === 2;
    return interaction.update({ content: renderSplitStatus(sg), components: [bjButtons(uid, cd, false, 0)] });
  }

  if (act === 'double') {
    // Deduct the extra bet for doubling
    const bal = store.getBalance(uid);
    if (bal < game.bet) return interaction.reply({ content: "Can't double!", ephemeral: true });
    store.setBalance(uid, bal - game.bet);
    game.bet *= 2;
    game.playerHand.push(game.deck.pop());
    const pv = getHandValue(game.playerHand);
    if (pv > 21) {
      // Bust after double, bet was already fully deducted      store.recordLoss(uid, 'blackjack', game.bet);      const cb = store.applyCashback(uid, game.bet); store.addToLossPool(game.bet);
      const cbm = cb > 0 ? `\n+${store.formatNumber(cb)} cashback` : '';
      activeGames.delete(uid);
      return interaction.update({
        content: `🃏 **Blackjack - Doubled**\nYou: ${formatHand(game.playerHand)} (${pv}) BUST\nDealer: ${formatHand(game.dealerHand)} (${getHandValue(game.dealerHand)})\nLost **${store.formatNumber(game.bet)}**${cbm}\nBalance: **${store.formatNumber(store.getBalance(uid))}**`,
        components: [],
      });
    }
    return resolveStandard(interaction, uid, game, true);
  }

  if (act === 'hit') {
    game.playerHand.push(game.deck.pop());
    const pv = getHandValue(game.playerHand);
    if (pv > 21) {
      // Bust, bet was already deducted at game start      store.recordLoss(uid, 'blackjack', game.bet);      const cb = store.applyCashback(uid, game.bet); store.addToLossPool(game.bet);
      const cbm = cb > 0 ? `\n+${store.formatNumber(cb)} cashback` : '';
      activeGames.delete(uid);
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
