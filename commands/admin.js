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
    
    const result = store.resolveEventBetting(eventId, outcome);
    if (!result) return interaction.reply({ content: `❌ Could not resolve event.`, ephemeral: true });
    
    return interaction.reply({
      content: `✅ Event concluded! Outcome: **${outcome}**\n\nWinners: ${result.winners}\nLosers: ${result.losers}`,
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
  if (sub === 'resetstats') {
    store.resetStats(target.id);
    const w = store.getWallet(target.id);
    const total = (w.balance || 0) + (w.bank || 0);
    return interaction.reply(`[ADMIN] Stats reset for ${target.username}. Lifetime earnings set to current balance: ${store.formatNumber(total)}`);
  }
}

module.exports = { handleAdmin };
