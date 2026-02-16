const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const store = require('../data/store');

const activeGames = new Map();   // shared for dice + roulette
const activeRides = new Map();
const activeDuels = new Map();

// ═══════ FLIP ═══════
async function handleFlip(interaction) {
  const userId = interaction.user.id;
  const bet = interaction.options.getInteger('amount');
  const qty = interaction.options.getInteger('quantity') || 1;
  const bal = store.getBalance(userId);
  if (bet * qty > bal) return interaction.reply(`You only have **${store.formatNumber(bal)}**`);

  let wins = 0, results = [];
  for (let i = 0; i < qty; i++) {
    const r = Math.random() < 0.5;
    results.push(r ? 'W' : 'L');
    if (r) wins++;
  }
  const net = (wins - (qty - wins)) * bet;
  store.setBalance(userId, bal + net);

  let cbm = '';
  if (net < 0) {
    const cb = store.applyCashback(userId, Math.abs(net));
    store.addToLossPool(Math.abs(net));
    if (cb > 0) cbm = ` (+${store.formatNumber(cb)} back)`;
  } else if (net > 0) {
    store.addToUniversalPool(net);
  }

  if (qty === 1) {
    if (wins) return interaction.reply(`**Flip: WIN** +**${store.formatNumber(bet)}**\nBalance: **${store.formatNumber(bal + net)}**`);
    return interaction.reply(`**Flip: LOSE** -**${store.formatNumber(bet)}**${cbm}\nBalance: **${store.formatNumber(store.getBalance(userId))}**`);
  }
  return interaction.reply(`**Flip x${qty}**\n${results.join(' ')}\n${wins}W ${qty - wins}L | Net: **${net >= 0 ? '+' : ''}${store.formatNumber(net)}**${cbm}\nBalance: **${store.formatNumber(store.getBalance(userId))}**`);
}

// ═══════ DICE ═══════
async function handleDice(interaction) {
  const userId = interaction.user.id;
  const bet = interaction.options.getInteger('amount');
  const bal = store.getBalance(userId);
  if (bet > bal) return interaction.reply(`You only have **${store.formatNumber(bal)}**`);

  activeGames.set(userId, { bet, game: 'dice' });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`dice_high_${userId}`).setLabel('High (4-6)').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`dice_low_${userId}`).setLabel('Low (1-3)').setStyle(ButtonStyle.Danger),
  );
  return interaction.reply({ content: `**Dice** - Bet: ${store.formatNumber(bet)}`, components: [row] });
}

async function handleDiceButton(interaction, parts) {
  const uid = interaction.user.id;
  const game = activeGames.get(uid);
  if (!game) return interaction.reply({ content: "Expired!", ephemeral: true });

  const choice = parts[1], roll = Math.floor(Math.random() * 6) + 1, hi = roll >= 4;
  const bal = store.getBalance(uid), won = (choice === 'high' && hi) || (choice === 'low' && !hi);

  if (won) {
    store.setBalance(uid, bal + game.bet); store.addToUniversalPool(game.bet);
    await interaction.update({ content: `**Dice** Rolled **${roll}** (${hi ? 'HIGH' : 'LOW'})\nPicked ${choice} - Won **${store.formatNumber(game.bet)}**\nBalance: **${store.formatNumber(bal + game.bet)}**`, components: [] });
  } else {
    store.setBalance(uid, bal - game.bet);
    const cb = store.applyCashback(uid, game.bet); store.addToLossPool(game.bet);
    const cbm = cb > 0 ? `\n+${store.formatNumber(cb)} cashback` : '';
    await interaction.update({ content: `**Dice** Rolled **${roll}** (${hi ? 'HIGH' : 'LOW'})\nPicked ${choice} - Lost **${store.formatNumber(game.bet)}**${cbm}\nBalance: **${store.formatNumber(store.getBalance(uid))}**`, components: [] });
  }
  activeGames.delete(uid);
}

// ═══════ ROULETTE ═══════
const REDS = [1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];

async function handleRoulette(interaction) {
  const userId = interaction.user.id;
  const bet = interaction.options.getInteger('amount');
  const bal = store.getBalance(userId);
  if (bet > bal) return interaction.reply(`You only have **${store.formatNumber(bal)}**`);

  activeGames.set(userId, { bet, game: 'roulette' });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`roulette_red_${userId}`).setLabel('Red (2x)').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`roulette_black_${userId}`).setLabel('Black (2x)').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`roulette_green_${userId}`).setLabel('Green 0 (14x)').setStyle(ButtonStyle.Success),
  );
  return interaction.reply({ content: `**Roulette** - Bet: ${store.formatNumber(bet)}`, components: [row] });
}

async function handleRouletteButton(interaction, parts) {
  const uid = interaction.user.id;
  const game = activeGames.get(uid);
  if (!game) return interaction.reply({ content: "Expired!", ephemeral: true });

  const choice = parts[1];
  const num = Math.floor(Math.random() * 37);
  const col = num === 0 ? 'green' : (REDS.includes(num) ? 'red' : 'black');

  // profit is what the player gains ON TOP of their bet back
  let profit = 0;
  if (choice === 'green' && num === 0) profit = game.bet * 13;   // 14x total means 13x profit
  else if (choice === col && choice !== 'green') profit = game.bet; // 2x total means 1x profit

  const bal = store.getBalance(uid);
  if (profit > 0) {
    store.setBalance(uid, bal + profit); store.addToUniversalPool(profit);
    await interaction.update({ content: `**Roulette**\nBall: **${num} (${col.toUpperCase()})**\nWon **${store.formatNumber(profit)}**\nBalance: **${store.formatNumber(bal + profit)}**`, components: [] });
  } else {
    store.setBalance(uid, bal - game.bet);
    const cb = store.applyCashback(uid, game.bet); store.addToLossPool(game.bet);
    const cbm = cb > 0 ? ` (+${store.formatNumber(cb)} back)` : '';
    await interaction.update({ content: `**Roulette**\nBall: **${num} (${col.toUpperCase()})**\nLost **${store.formatNumber(game.bet)}**${cbm}\nBalance: **${store.formatNumber(store.getBalance(uid))}**`, components: [] });
  }
  activeGames.delete(uid);
}

// ═══════ ALL IN 17 BLACK ═══════
async function handleAllIn17(interaction) {
  const userId = interaction.user.id;
  const bal = store.getBalance(userId);
  if (bal <= 0) return interaction.reply("You're broke!");

  const num = Math.floor(Math.random() * 37);
  const col = num === 0 ? 'green' : (REDS.includes(num) ? 'red' : 'black');

  if (num === 17) {
    const win = bal * 36;
    store.setBalance(userId, win); store.addToUniversalPool(win - bal);
    return interaction.reply(`🎰 **ALL IN 17 BLACK** 🎰\nBall: **17 (BLACK)**\n\n🎉🎉🎉 **HIT!!!** 🎉🎉🎉\n${store.formatNumber(bal)} → **${store.formatNumber(win)}**`);
  }
  store.setBalance(userId, 0); store.applyCashback(userId, bal); store.addToLossPool(bal);
  return interaction.reply(`🎰 **ALL IN 17 BLACK** 🎰\nBall: **${num} (${col.toUpperCase()})**\n\n💀 Lost **${store.formatNumber(bal)}**. Balance: **0**`);
}

// ═══════ LET IT RIDE ═══════
async function handleLetItRide(interaction) {
  const userId = interaction.user.id;
  const bet = interaction.options.getInteger('amount');
  const bal = store.getBalance(userId);
  if (bet > bal) return interaction.reply(`You only have **${store.formatNumber(bal)}**`);

  store.setBalance(userId, bal - bet);
  if (Math.random() >= 0.5) {
    const cb = store.applyCashback(userId, bet); store.addToLossPool(bet);
    const cbm = cb > 0 ? `\n+${store.formatNumber(cb)} cashback` : '';
    return interaction.reply(`**Let It Ride**\nBust on first flip! -**${store.formatNumber(bet)}**${cbm}\nBalance: **${store.formatNumber(store.getBalance(userId))}**`);
  }
  const pot = bet * 2;
  activeRides.set(userId, { current: pot, original: bet, wins: 1 });
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
    store.setBalance(uid, store.getBalance(uid) + ride.current);
    if (ride.current > ride.original) store.addToUniversalPool(ride.current - ride.original);
    activeRides.delete(uid);
    return interaction.update({ content: `**Let It Ride - Cashed Out**\n${store.formatNumber(ride.current)} coins after ${ride.wins} wins!`, components: [] });
  }

  if (action === 'ride') {
    if (Math.random() < 0.5) {
      ride.current *= 2; ride.wins++;
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`ride_ride_${uid}`).setLabel(`Ride (${store.formatNumberShort(ride.current * 2)})`).setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`ride_cashout_${uid}`).setLabel(`Cash Out (${store.formatNumberShort(ride.current)})`).setStyle(ButtonStyle.Primary),
      );
      return interaction.update({ content: `**Let It Ride**\nWIN! Pot: **${store.formatNumber(ride.current)}**\n🔥 ${ride.wins}`, components: [row] });
    } else {
      const cb = store.applyCashback(uid, ride.current); store.addToLossPool(ride.current);
      activeRides.delete(uid);
      const cbm = cb > 0 ? `\n+${store.formatNumber(cb)} cashback` : '';
      return interaction.update({ content: `**Let It Ride - Bust**\nLost **${store.formatNumber(ride.current)}** after ${ride.wins} wins${cbm}`, components: [] });
    }
  }
}

// ═══════ DUEL ═══════
async function handleDuel(interaction) {
  const userId = interaction.user.id, username = interaction.user.username;
  const opp = interaction.options.getUser('opponent');
  const bet = interaction.options.getInteger('amount');
  const bal = store.getBalance(userId);
  if (opp.id === userId) return interaction.reply("Can't duel yourself");
  if (opp.bot) return interaction.reply("Can't duel a bot");
  if (bet > bal) return interaction.reply(`You only have **${store.formatNumber(bal)}**`);

  activeDuels.set(`${userId}_${opp.id}`, { bet, challengerName: username, opponentName: opp.username });
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
    activeDuels.delete(dk);
    return interaction.update({ content: `**${duel.opponentName}** declined.`, components: [] });
  }

  if (action === 'accept') {
    if (store.getBalance(cid) < duel.bet) { activeDuels.delete(dk); return interaction.update({ content: "Challenger broke.", components: [] }); }
    if (store.getBalance(oid) < duel.bet) { activeDuels.delete(dk); return interaction.update({ content: "You can't afford it!", components: [] }); }
    const w = Math.random() < 0.5 ? cid : oid;
    const wn = w === cid ? duel.challengerName : duel.opponentName;
    const ln = w === cid ? duel.opponentName : duel.challengerName;
    const li = w === cid ? oid : cid;
    store.setBalance(w, store.getBalance(w) + duel.bet);
    store.setBalance(li, store.getBalance(li) - duel.bet);
    store.addToUniversalPool(duel.bet); store.addToLossPool(duel.bet);
    activeDuels.delete(dk);
    return interaction.update({ content: `**DUEL** — **${wn}** wins ${store.formatNumber(duel.bet)} from **${ln}**!`, components: [] });
  }
}

module.exports = {
  activeGames, activeRides, activeDuels,
  handleFlip, handleDice, handleDiceButton,
  handleRoulette, handleRouletteButton,
  handleAllIn17, handleLetItRide, handleRideButton,
  handleDuel, handleDuelButton,
};
