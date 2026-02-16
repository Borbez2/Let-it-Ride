const store = require('../data/store');

async function handleAdmin(interaction, client, ADMIN_IDS, runDailySpin, distributeUniversalPool) {
  const userId = interaction.user.id;
  if (!ADMIN_IDS.includes(userId)) return interaction.reply({ content: "Not authorized", ephemeral: true });

  const sub = interaction.options.getSubcommand();

  if (sub === 'forcespin') { await runDailySpin(); return interaction.reply("[ADMIN] Daily spin forced."); }
  if (sub === 'forcepoolpayout') { distributeUniversalPool(); return interaction.reply("[ADMIN] Pool distributed."); }

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
