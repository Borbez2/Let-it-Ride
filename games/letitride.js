const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { CONFIG } = require('../config');
const store = require('../data/store');
const { maybeAnnouncePityTrigger } = require('./shared');

const activeRides = new Map();

function persistLetItRideSessions() {
  store.setRuntimeState('session:letitride', {
    activeRides: Object.fromEntries(activeRides),
  });
}

function restoreLetItRideSessions() {
  const state = store.getRuntimeState('session:letitride', null);
  if (!state || typeof state !== 'object') return;
  if (state.activeRides && typeof state.activeRides === 'object') {
    for (const [k, v] of Object.entries(state.activeRides)) activeRides.set(k, v);
  }
  // Migrate from old combined session key
  const oldState = store.getRuntimeState('session:simple', null);
  if (oldState && oldState.activeRides) {
    for (const [k, v] of Object.entries(oldState.activeRides)) {
      if (!activeRides.has(k)) activeRides.set(k, v);
    }
  }
}

restoreLetItRideSessions();

// Let It Ride - double or bust, keep going or cash out.
async function handleLetItRide(interaction) {
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

  store.setBalance(userId, bal - bet);
  const rideModifier = store.getWinChanceModifier(userId);
  if (Math.random() >= CONFIG.games.letItRide.winChancePerRide * rideModifier) {
    const pityResult = store.recordLoss(userId, 'letitride', bet);
    await maybeAnnouncePityTrigger(interaction, userId, pityResult);
    const cb = store.applyCashback(userId, bet);
    store.addToLossPool(bet);
    const cbm = cb > 0 ? `\n+${store.formatNumber(cb)} cashback` : '';
    return interaction.reply({ embeds: [{
      color: 0xed4245,
      title: '🏇 Let It Ride',
      description: `Bust on first flip! -**${store.formatNumber(bet)}**${cbm}\nBalance: **${store.formatNumber(store.getBalance(userId))}**`,
    }] });
  }

  const pot = bet * 2;
  activeRides.set(userId, { current: pot, original: bet, wins: 1, createdAt: Date.now() });
  persistLetItRideSessions();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ride_ride_${userId}`).setLabel(`Ride (${store.formatNumberShort(pot * 2)})`).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`ride_cashout_${userId}`).setLabel(`Cash Out (${store.formatNumberShort(pot)})`).setStyle(ButtonStyle.Primary),
  );
  return interaction.reply({
    embeds: [{
      color: 0x57f287,
      title: '🏇 Let It Ride',
      description: `**WIN!** Pot: **${store.formatNumber(pot)}**\n🔥 1 win`,
    }],
    components: [row],
  });
}

async function handleRideButton(interaction, parts) {
  const uid = parts[2];
  if (interaction.user.id !== uid) return interaction.reply({ content: 'Not your game!', ephemeral: true });
  const ride = activeRides.get(uid);
  if (!ride) return interaction.reply({ content: 'Session expired. Start a new game.', ephemeral: true });
  const action = parts[1];

  if (action === 'cashout') {
    let payout = ride.current;
    let rideTax = 0;
    if (ride.current > ride.original) {
      const baseProfit = ride.current - ride.original;
      const { profit: boostedProfit, effects } = store.applyProfitBoost(uid, 'letitride', baseProfit);
      const pityResult = store.recordWin(uid, 'letitride', boostedProfit);
      await maybeAnnouncePityTrigger(interaction, uid, pityResult);
      rideTax = store.addToUniversalPool(boostedProfit, uid);
      payout = ride.original + boostedProfit - rideTax;
      if (effects && effects.length) {
        // show effects after payout
      }
    }
    store.setBalance(uid, store.getBalance(uid) + payout);
    activeRides.delete(uid);
    persistLetItRideSessions();
    const taxLine = rideTax > 0 ? `\n${store.formatNumber(rideTax)} tax to pool` : '';
    return interaction.update({ embeds: [{
      color: 0x57f287,
      title: '🏇 Let It Ride - Cashed Out',
      description: `**${store.formatNumber(payout)}** coins after ${ride.wins} wins!${taxLine}\nBalance: **${store.formatNumber(store.getBalance(uid))}**`,
    }], components: [] });
  }

  if (action === 'ride') {
    const rideModifier = store.getWinChanceModifier(uid);
    if (Math.random() < CONFIG.games.letItRide.winChancePerRide * rideModifier) {
      ride.current *= 2;
      ride.wins++;
      persistLetItRideSessions();
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`ride_ride_${uid}`).setLabel(`Ride (${store.formatNumberShort(ride.current * 2)})`).setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`ride_cashout_${uid}`).setLabel(`Cash Out (${store.formatNumberShort(ride.current)})`).setStyle(ButtonStyle.Primary),
      );
      return interaction.update({ embeds: [{
        color: 0x57f287,
        title: '🏇 Let It Ride',
        description: `**WIN!** Pot: **${store.formatNumber(ride.current)}**\n🔥 ${ride.wins} wins`,
      }], components: [row] });
    } else {
      const pityResult = store.recordLoss(uid, 'letitride', ride.original);
      await maybeAnnouncePityTrigger(interaction, uid, pityResult);
      const cb = store.applyCashback(uid, ride.original);
      store.addToLossPool(ride.original);
      activeRides.delete(uid);
      persistLetItRideSessions();
      const cbm = cb > 0 ? `\n+${store.formatNumber(cb)} cashback` : '';
      return interaction.update({ embeds: [{
        color: 0xed4245,
        title: '🏇 Let It Ride - Bust',
        description: `Lost **${store.formatNumber(ride.original)}** after ${ride.wins} wins${cbm}\nBalance: **${store.formatNumber(store.getBalance(uid))}**`,
      }], components: [] });
    }
  }
}

function expireSessions(ttlMs) {
  const now = Date.now();
  let expired = 0;
  for (const [uid, ride] of activeRides) {
    if (ride.createdAt && now - ride.createdAt > ttlMs) {
      store.setBalance(uid, store.getBalance(uid) + ride.original);
      activeRides.delete(uid);
      expired++;
    }
  }
  if (expired > 0) persistLetItRideSessions();
  return expired;
}

module.exports = {
  activeRides,
  handleLetItRide, handleRideButton,
  expireSessions,
};
