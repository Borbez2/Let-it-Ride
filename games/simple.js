const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { CONFIG } = require('../config');
const store = require('../data/store');

const activeGames = new Map();   // shared for dice + roulette
const activeRides = new Map();
const activeDuels = new Map();

async function maybeAnnouncePityTrigger(interaction, userId, pityResult) {
  if (!pityResult || !pityResult.triggered) return;
  const channel = interaction.channel;
  if (!channel || typeof channel.send !== 'function') return;

  const boostPct = (pityResult.winChanceBoost * 100).toFixed(1);

  await channel.send(
    `\u2618 <@${userId}> luck triggered: +${boostPct}% win chance boost | loss streak: ${pityResult.lossStreak}`
  ).catch(() => null);
}

function persistSimpleSessions() {
  store.setRuntimeState('session:simple', {
    activeGames: Object.fromEntries(activeGames),
    activeRides: Object.fromEntries(activeRides),
    activeDuels: Object.fromEntries(activeDuels),
  });
}

function restoreSimpleSessions() {
  const state = store.getRuntimeState('session:simple', null);
  if (!state || typeof state !== 'object') return;
  if (state.activeGames && typeof state.activeGames === 'object') {
    for (const [k, v] of Object.entries(state.activeGames)) activeGames.set(k, v);
  }
  if (state.activeRides && typeof state.activeRides === 'object') {
    for (const [k, v] of Object.entries(state.activeRides)) activeRides.set(k, v);
  }
  if (state.activeDuels && typeof state.activeDuels === 'object') {
    for (const [k, v] of Object.entries(state.activeDuels)) activeDuels.set(k, v);
  }
}

restoreSimpleSessions();

// Coin flip command.
async function handleFlip(interaction) {
  const userId = interaction.user.id;
  const rawAmount = interaction.options.getString('amount');
  const balance = store.getBalance(userId);
  if (balance <= 0) return interaction.reply(`Not enough coins. You only have **${store.formatNumber(balance)}**`);
  
  const bet = store.parseAmount(rawAmount, balance);
  if (!bet || bet <= 0) {
    return interaction.reply(CONFIG.commands.invalidAmountText);
  }
  
  const qty = interaction.options.getInteger('quantity') || 1;
  const bal = store.getBalance(userId);
  if (bet * qty > bal) return interaction.reply(`You only have **${store.formatNumber(bal)}**`);

  if (qty === 1) {
    const flipModifier = store.getWinChanceModifier(userId);
    const won = Math.random() < CONFIG.games.flip.winChance * flipModifier;
    if (won) {
      const profit = store.applyProfitBoost(userId, 'flip', bet);
      const pityResult = store.recordWin(userId, 'flip', profit);
      await maybeAnnouncePityTrigger(interaction, userId, pityResult);
      store.setBalance(userId, bal + profit);
      store.addToUniversalPool(profit);
      return interaction.reply(`✅ **Flip: WIN** +**${store.formatNumber(profit)}**\nBalance: **${store.formatNumber(store.getBalance(userId))}**`);
    }
    store.setBalance(userId, bal - bet);
    const pityResult = store.recordLoss(userId, 'flip', bet);
    await maybeAnnouncePityTrigger(interaction, userId, pityResult);
    const cb = store.applyCashback(userId, bet);
    store.addToLossPool(bet);
    const cbm = cb > 0 ? ` (+${store.formatNumber(cb)} back)` : '';
    return interaction.reply(`❌ **Flip: LOSE** -**${store.formatNumber(bet)}**${cbm}\nBalance: **${store.formatNumber(store.getBalance(userId))}**`);
  }

  // Multi-flip: process each flip individually so that luck buffs triggered by
  // losing streaks within the batch apply to subsequent flips, stat tracking
  // updates per flip, and cashback is calculated on the full loss amount.
  let wins = 0, results = [];
  let totalBoostedWinnings = 0;
  let totalLossAmount = 0;
  let lastTriggeredPity = null;

  for (let i = 0; i < qty; i++) {
    // Re-evaluate modifier each flip so luck boosts earned mid-batch take effect
    const flipModifier = store.getWinChanceModifier(userId);
    const won = Math.random() < CONFIG.games.flip.winChance * flipModifier;
    results.push(won ? CONFIG.games.flip.winMarker : CONFIG.games.flip.lossMarker);
    if (won) {
      wins++;
      const profit = store.applyProfitBoost(userId, 'flip', bet);
      totalBoostedWinnings += profit;
      store.recordWin(userId, 'flip', profit);
    } else {
      totalLossAmount += bet;
      const pityResult = store.recordLoss(userId, 'flip', bet);
      if (pityResult && pityResult.triggered) lastTriggeredPity = pityResult;
    }
  }

  const boostedNet = totalBoostedWinnings - totalLossAmount;
  store.setBalance(userId, bal + boostedNet);

  let cbm = '';
  if (totalLossAmount > 0) {
    // Cashback applies to the full losing amount (all losing flips × bet)
    const cb = store.applyCashback(userId, totalLossAmount);
    store.addToLossPool(totalLossAmount);
    if (cb > 0) cbm = ` (+${store.formatNumber(cb)} back)`;
  }
  if (totalBoostedWinnings > 0) {
    store.addToUniversalPool(totalBoostedWinnings);
  }

  if (lastTriggeredPity) {
    await maybeAnnouncePityTrigger(interaction, userId, lastTriggeredPity);
  }

  return interaction.reply(`**Flip x${qty}**\n${results.join(' ')}\n${wins}W ${qty - wins}L | Net: **${boostedNet >= 0 ? '+' : ''}${store.formatNumber(boostedNet)}**${cbm}\nBalance: **${store.formatNumber(store.getBalance(userId))}**`);
}

// Roulette command.
const REDS = CONFIG.games.roulette.redNumbers;

async function handleRoulette(interaction) {
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

  activeGames.set(userId, { bet, game: 'roulette', createdAt: Date.now() });
  persistSimpleSessions();
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`roulette_red_${userId}`).setLabel(CONFIG.games.roulette.labels.red).setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`roulette_black_${userId}`).setLabel(CONFIG.games.roulette.labels.black).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`roulette_green_${userId}`).setLabel(CONFIG.games.roulette.labels.green).setStyle(ButtonStyle.Success),
  );
  return interaction.reply({ content: `**Roulette** - Bet: ${store.formatNumber(bet)}`, components: [row] });
}

async function handleRouletteButton(interaction, parts) {
  const uid = interaction.user.id;
  const game = activeGames.get(uid);
  if (!game) return interaction.reply({ content: "Expired!", ephemeral: true });

  const choice = parts[1];
  const num = Math.floor(Math.random() * CONFIG.games.roulette.wheelSize);
  const col = num === CONFIG.games.roulette.greenNumber ? 'green' : (REDS.includes(num) ? 'red' : 'black');

  // profit is what the player gains ON TOP of their bet back
  let profit = 0;
  if (choice === 'green' && num === CONFIG.games.roulette.greenNumber) profit = game.bet * CONFIG.games.roulette.payoutProfitMultipliers.green;
  else if (choice === col && choice !== 'green') profit = game.bet * CONFIG.games.roulette.payoutProfitMultipliers.redOrBlack;

  const bal = store.getBalance(uid);
  if (profit > 0) {
    const boostedProfit = store.applyProfitBoost(uid, 'roulette', profit);
    const pityResult = store.recordWin(uid, 'roulette', boostedProfit);
    await maybeAnnouncePityTrigger(interaction, uid, pityResult);
    store.setBalance(uid, bal + boostedProfit); store.addToUniversalPool(boostedProfit);
    await interaction.update({ content: `**Roulette**\nBall: **${num} (${col.toUpperCase()})**\nWon **${store.formatNumber(boostedProfit)}**\nBalance: **${store.formatNumber(store.getBalance(uid))}**`, components: [] });
  } else {
    const pityResult = store.recordLoss(uid, 'roulette', game.bet);
    await maybeAnnouncePityTrigger(interaction, uid, pityResult);
    store.setBalance(uid, bal - game.bet);
    const cb = store.applyCashback(uid, game.bet); store.addToLossPool(game.bet);
    const cbm = cb > 0 ? ` (+${store.formatNumber(cb)} back)` : '';
    await interaction.update({ content: `**Roulette**\nBall: **${num} (${col.toUpperCase()})**\nLost **${store.formatNumber(game.bet)}**${cbm}\nBalance: **${store.formatNumber(store.getBalance(uid))}**`, components: [] });
  }
  activeGames.delete(uid);
  persistSimpleSessions();
}

// All-in roulette shortcut on 17 black.
async function handleAllIn17(interaction) {
  const userId = interaction.user.id;
  const purse = store.getBalance(userId);
  if (purse <= 0) return interaction.reply("Your purse is empty. This command uses purse coins only.");

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`allin17_yes_${userId}`)
      .setLabel('Yes, send it')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`allin17_no_${userId}`)
      .setLabel("No i'm scared")
      .setStyle(ButtonStyle.Danger),
  );

  return interaction.reply({
    content: `🪟 **ALL IN 17 BLACK CONFIRMATION**\n\nAre you sure you want to lose all your money?\nThis bet uses **purse only** (bank is not used).\n\nCurrent purse: **${store.formatNumber(purse)}**`,
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
      content: '✅ Cancelled. Your purse and bank are unchanged.',
      components: [],
    });
  }

  if (action !== 'yes') {
    return interaction.reply({ content: 'Invalid choice.', ephemeral: true });
  }

  const purse = store.getBalance(uid);
  if (purse <= 0) {
    return interaction.update({
      content: 'Your purse is empty now. This command uses purse coins only.',
      components: [],
    });
  }

  const num = Math.floor(Math.random() * CONFIG.games.roulette.wheelSize);
  const col = num === CONFIG.games.roulette.greenNumber ? 'green' : (REDS.includes(num) ? 'red' : 'black');

  if (num === CONFIG.games.roulette.allIn.luckyNumber) {
    const baseProfit = purse * CONFIG.games.roulette.payoutProfitMultipliers.allIn17;
    const boostedProfit = store.applyProfitBoost(uid, 'roulette', baseProfit);
    const payout = purse + boostedProfit;
    const pityResult = store.recordWin(uid, 'roulette', boostedProfit);
    await maybeAnnouncePityTrigger(interaction, uid, pityResult);
    store.setBalance(uid, payout);
    store.addToUniversalPool(boostedProfit);
    return interaction.update({
      content: `🎰 **ALL IN 17 BLACK** 🎰\nBall: **17 (BLACK)**\n\n🎉🎉🎉 **HIT!!!** 🎉🎉🎉\nPurse only bet: ${store.formatNumber(purse)} → **${store.formatNumber(payout)}**\nBank was not used.`,
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
    content: `🎰 **ALL IN 17 BLACK** 🎰\nBall: **${num} (${col.toUpperCase()})**\n\n💀 Lost **${store.formatNumber(purse)}** from purse.${cbm}\nBank was not used.`,
    components: [],
  });
}

// Let It Ride command.
async function handleLetItRide(interaction) {
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

  store.setBalance(userId, bal - bet);
  const rideModifier = store.getWinChanceModifier(userId);
  if (Math.random() >= CONFIG.games.letItRide.winChancePerRide * rideModifier) {
    const pityResult = store.recordLoss(userId, 'letitride', bet);
    await maybeAnnouncePityTrigger(interaction, userId, pityResult);
    const cb = store.applyCashback(userId, bet); store.addToLossPool(bet);
    const cbm = cb > 0 ? `\n+${store.formatNumber(cb)} cashback` : '';
    return interaction.reply(`**Let It Ride**\nBust on first flip! -**${store.formatNumber(bet)}**${cbm}\nBalance: **${store.formatNumber(store.getBalance(userId))}**`);
  }
  const pot = bet * 2;
  activeRides.set(userId, { current: pot, original: bet, wins: 1, createdAt: Date.now() });
  persistSimpleSessions();
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ride_ride_${userId}`).setLabel(`Ride (${store.formatNumberShort(pot * 2)})`).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`ride_cashout_${userId}`).setLabel(`Cash Out (${store.formatNumberShort(pot)})`).setStyle(ButtonStyle.Primary),
  );
  return interaction.reply({ content: `**Let It Ride**\nWIN! Pot: **${store.formatNumber(pot)}**\n🔥 1`, components: [row] });
}

async function handleRideButton(interaction, parts) {
  const uid = parts[2];
  if (interaction.user.id !== uid) return interaction.reply({ content: "Not yours!", ephemeral: true });
  const ride = activeRides.get(uid);
  if (!ride) return interaction.reply({ content: "Expired!", ephemeral: true });
  const action = parts[1];

  if (action === 'cashout') {
    let payout = ride.current;
    if (ride.current > ride.original) {
      const baseProfit = ride.current - ride.original;
      const boostedProfit = store.applyProfitBoost(uid, 'letitride', baseProfit);
      payout = ride.original + boostedProfit;
      const pityResult = store.recordWin(uid, 'letitride', boostedProfit);
      await maybeAnnouncePityTrigger(interaction, uid, pityResult);
      store.addToUniversalPool(boostedProfit);
    }
    store.setBalance(uid, store.getBalance(uid) + payout);
    activeRides.delete(uid);
    persistSimpleSessions();
    return interaction.update({ content: `**Let It Ride - Cashed Out**\n${store.formatNumber(payout)} coins after ${ride.wins} wins!`, components: [] });
  }

  if (action === 'ride') {
    const rideModifier = store.getWinChanceModifier(uid);
    if (Math.random() < CONFIG.games.letItRide.winChancePerRide * rideModifier) {
      ride.current *= 2; ride.wins++;
      persistSimpleSessions();
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`ride_ride_${uid}`).setLabel(`Ride (${store.formatNumberShort(ride.current * 2)})`).setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`ride_cashout_${uid}`).setLabel(`Cash Out (${store.formatNumberShort(ride.current)})`).setStyle(ButtonStyle.Primary),
      );
      return interaction.update({ content: `**Let It Ride**\nWIN! Pot: **${store.formatNumber(ride.current)}**\n🔥 ${ride.wins}`, components: [row] });
    } else {
      const pityResult = store.recordLoss(uid, 'letitride', ride.original);
      await maybeAnnouncePityTrigger(interaction, uid, pityResult);
      const cb = store.applyCashback(uid, ride.original); store.addToLossPool(ride.original);
      activeRides.delete(uid);
      persistSimpleSessions();
      const cbm = cb > 0 ? `\n+${store.formatNumber(cb)} cashback` : '';
      return interaction.update({ content: `**Let It Ride - Bust**\nLost **${store.formatNumber(ride.original)}** after ${ride.wins} wins${cbm}`, components: [] });
    }
  }
}

// Duel command.
async function handleDuel(interaction) {
  const userId = interaction.user.id, username = interaction.user.username;
  const opp = interaction.options.getUser('opponent');
  const rawAmount = interaction.options.getString('amount');
  const balance = store.getBalance(userId);
  if (balance <= 0) return interaction.reply(`Not enough coins. You only have **${store.formatNumber(balance)}**`);
  
  const bet = store.parseAmount(rawAmount, balance);
  if (!bet || bet <= 0) {
    return interaction.reply(CONFIG.commands.invalidAmountText);
  }
  
  const bal = store.getBalance(userId);
  if (opp.id === userId) return interaction.reply("Can't duel yourself");
  if (opp.bot) return interaction.reply("Can't duel a bot");
  if (bet > bal) return interaction.reply(`You only have **${store.formatNumber(bal)}**`);

  // Hold the money to prevent the user from spending it elsewhere
  store.setBalance(userId, bal - bet);
  
  activeDuels.set(`${userId}_${opp.id}`, { bet, challengerName: username, opponentName: opp.username, challengerBalance: bal - bet, createdAt: Date.now() });
  persistSimpleSessions();
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`duel_accept_${userId}_${opp.id}`).setLabel('Accept').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`duel_decline_${userId}_${opp.id}`).setLabel('Decline').setStyle(ButtonStyle.Danger),
  );
  return interaction.reply({ content: `**${username}** challenges **${opp.username}** for **${store.formatNumber(bet)}**!\n${opp}, accept?`, components: [row] });
}

async function handleDuelButton(interaction, parts) {
  const action = parts[1], cid = parts[2], oid = parts[3];
  const dk = `${cid}_${oid}`, duel = activeDuels.get(dk);
  if (!duel) return interaction.reply({ content: "Expired!", ephemeral: true });
  if (interaction.user.id !== oid) return interaction.reply({ content: "Not your duel!", ephemeral: true });

  if (action === 'decline') {
    // Refund the challenger's money
    store.setBalance(cid, store.getBalance(cid) + duel.bet);
    activeDuels.delete(dk);
    persistSimpleSessions();
    return interaction.update({ content: `**${duel.opponentName}** declined.`, components: [] });
  }

  if (action === 'accept') {
    const oppBal = store.getBalance(oid);
    
    // Check if opponent still has enough (the challenger's money was already held)
    if (oppBal < duel.bet) { 
      // Refund challenger
      store.setBalance(cid, store.getBalance(cid) + duel.bet);
      activeDuels.delete(dk); 
      persistSimpleSessions();
      return interaction.update({ content: "You can't afford it!", components: [] }); 
    }
    
    // Hold opponent's money
    store.setBalance(oid, oppBal - duel.bet);
    
    const duelModifier = store.getWinChanceModifier(cid);
    const w = Math.random() < CONFIG.games.duel.winChance * duelModifier ? cid : oid;
    const wn = w === cid ? duel.challengerName : duel.opponentName;
    const ln = w === cid ? duel.opponentName : duel.challengerName;
    const li = w === cid ? oid : cid;
    
    // Winner gets both bets — no pool tax on duels (zero-sum player transfer)
    const boostedProfit = store.applyProfitBoost(w, 'duel', duel.bet);
    const pityWinResult = store.recordWin(w, 'duel', boostedProfit);
    await maybeAnnouncePityTrigger(interaction, w, pityWinResult);
    const pityLossResult = store.recordLoss(li, 'duel', duel.bet);
    await maybeAnnouncePityTrigger(interaction, li, pityLossResult);
    store.setBalance(w, store.getBalance(w) + duel.bet + boostedProfit);
    
    activeDuels.delete(dk);
    persistSimpleSessions();
    
    const emoji = w === cid ? '✅' : '❌';
    return interaction.update({ content: `${emoji} **DUEL** — **${wn}** beats **${ln}** and wins **${store.formatNumber(boostedProfit)}**!`, components: [] });
  }
}

function expireSessions(ttlMs) {
  const now = Date.now();
  let expired = 0;
  // Roulette: bet is NOT deducted until button click, so no refund needed
  for (const [uid, game] of activeGames) {
    if (game.createdAt && now - game.createdAt > ttlMs) {
      activeGames.delete(uid);
      expired++;
    }
  }
  // Let It Ride: original bet was deducted, refund it
  for (const [uid, ride] of activeRides) {
    if (ride.createdAt && now - ride.createdAt > ttlMs) {
      store.setBalance(uid, store.getBalance(uid) + ride.original);
      activeRides.delete(uid);
      expired++;
    }
  }
  // Duels: challenger bet was pre-deducted, refund it
  for (const [dk, duel] of activeDuels) {
    if (duel.createdAt && now - duel.createdAt > ttlMs) {
      const challengerId = dk.split('_')[0];
      store.setBalance(challengerId, store.getBalance(challengerId) + duel.bet);
      activeDuels.delete(dk);
      expired++;
    }
  }
  if (expired > 0) persistSimpleSessions();
  return expired;
}

module.exports = {
  activeGames, activeRides, activeDuels,
  handleFlip,
  handleRoulette, handleRouletteButton,
  handleAllIn17, handleAllIn17Button, handleLetItRide, handleRideButton,
  handleDuel, handleDuelButton,
  expireSessions,
};
