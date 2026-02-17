const store = require('../data/store');

async function handleAdmin(interaction, client, ADMIN_IDS, runDailySpin, distributeUniversalPool) {
  const userId = interaction.user.id;
  if (!ADMIN_IDS.includes(userId)) return interaction.reply({ content: "Not authorized", ephemeral: true });

  const sub = interaction.options.getSubcommand();

  if (sub === 'forcespin') { await runDailySpin(); return interaction.reply("[ADMIN] Daily spin forced."); }
  if (sub === 'forcepoolpayout') { distributeUniversalPool(); return interaction.reply("[ADMIN] Pool distributed."); }
  
  if (sub === 'eventoutcome') {
    const eventId = interaction.options.getString('eventid');
    const outcome = interaction.options.getString('outcome');
    
    const event = store.getEvent(eventId);
    if (!event) return interaction.reply({ content: `❌ Event not found: ${eventId}`, ephemeral: true });
    if (event.outcome !== null) return interaction.reply({ content: `⚠️ Outcome already set for this event`, ephemeral: true });
    
    // Set the outcome
    store.setEventOutcome(eventId, outcome);
    
    // Calculate payouts
    const participants = event.participants;
    const winners = [];
    const losers = [];
    let totalPoolForWinners = 0;
    
    for (const [userId, bets] of Object.entries(participants)) {
      let userWon = false;
      let userTotal = 0;
      
      for (const bet of bets) {
        userTotal += bet.amount;
        if (bet.prediction.toLowerCase() === outcome.toLowerCase()) {
          userWon = true;
        }
      }
      
      if (userWon) {
        winners.push({ userId, total: userTotal });
        totalPoolForWinners += userTotal;
      } else {
        losers.push({ userId, total: userTotal });
      }
    }
    
    // Distribute winnings
    if (winners.length > 0 && totalPoolForWinners > 0) {
      const losserPoolTotal = losers.reduce((sum, l) => sum + l.total, 0);
      const totalPayout = losserPoolTotal; // All loser money goes to winners
      
      for (const winner of winners) {
        const winnerShare = Math.floor((winner.total / totalPoolForWinners) * totalPayout);
        store.setBalance(winner.userId, store.getBalance(winner.userId) + winner.total + winnerShare);
      }
    }
    
    // Return original amounts to losers
    for (const loser of losers) {
      store.setBalance(loser.userId, store.getBalance(loser.userId) + loser.total);
    }
    
    store.removeEvent(eventId);
    return interaction.reply({
      content: `✅ Event concluded! Outcome: **${outcome}**\n\nWinners: ${winners.length}\nLosers: ${losers.length}`,
      ephemeral: true,
    });
  }

  const target = interaction.options.getUser('user');
  const amount = interaction.options.getInteger('amount');

  if (sub === 'give') {
    store.setBalance(target.id, store.getBalance(target.id) + amount);
    return interaction.reply(`[ADMIN] +${store.formatNumber(amount)} to ${target.username}`);
  }
  if (sub === 'set') {
    store.setBalance(target.id, amount);
    return interaction.reply(`[ADMIN] ${target.username} set to ${store.formatNumber(amount)}`);
  }
  if (sub === 'reset') {
    store.deleteWallet(target.id);
    return interaction.reply(`[ADMIN] Reset ${target.username}`);
  }
  if (sub === 'resetupgrades') {
    const w = store.getWallet(target.id);
    w.interestLevel = 0; w.cashbackLevel = 0; w.spinMultLevel = 0;
    store.saveWallets();
    return interaction.reply(`[ADMIN] Upgrades reset for ${target.username}`);
  }
}

module.exports = { handleAdmin };
