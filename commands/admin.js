const store = require('../data/store');

async function handleAdmin(interaction, client, ADMIN_IDS, STATS_RESET_ADMIN_IDS, runDailySpin, distributeUniversalPool, getBotActive, setBotActive) {
  const userId = interaction.user.id;
  if (!ADMIN_IDS.includes(userId)) return interaction.reply({ content: "Not authorized", ephemeral: true });

  const sub = interaction.options.getSubcommand();

  if (sub === 'start') {
    if (getBotActive()) return interaction.reply('[ADMIN] Bot is already started.');
    setBotActive(true);
    return interaction.reply('[ADMIN] Bot started. Everyone can use commands again.');
  }

  if (sub === 'stop') {
    if (!getBotActive()) return interaction.reply('[ADMIN] Bot is already stopped.');
    setBotActive(false);
    return interaction.reply('[ADMIN] Bot stopped. Non-admin users are blocked until /admin start.');
  }

  if (sub === 'forcespin') {
    await interaction.deferReply({ ephemeral: true });
    await runDailySpin();
    return interaction.editReply("[ADMIN] Daily spin forced.");
  }
  if (sub === 'forcepoolpayout') {
    await interaction.deferReply({ ephemeral: true });
    await distributeUniversalPool();
    return interaction.editReply("[ADMIN] Pool distributed.");
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
    if (!STATS_RESET_ADMIN_IDS.includes(userId)) {
      return interaction.reply({ content: 'Only configured stats-reset admins can use this subcommand.', ephemeral: true });
    }
    store.resetStats(target.id);
    const w = store.getWallet(target.id);
    const total = (w.balance || 0) + (w.bank || 0);
    return interaction.reply(`[ADMIN] Stats reset for ${target.username}. Lifetime earnings set to current balance: ${store.formatNumber(total)}`);
  }
}

module.exports = { handleAdmin };
