const { CONFIG } = require('../config');
const store = require('../data/store');

async function handleBalance(interaction) {
  const userId = interaction.user.id, username = interaction.user.username;
  const payout = store.processBank(userId);
  const w = store.getWallet(userId);
  const total = w.balance + (w.bank || 0);
  const streakText = w.streak > 0 ? `> 🔥 Streak: **${w.streak}** day${w.streak === 1 ? '' : 's'}` : '> 🔥 Streak: **0** days';

  const embed = {
    title: 'Balance',
    color: 0x2b2d31,
    description: `> **${username}**\n> \n> 💰 Purse: **${store.formatNumber(w.balance)}**\n> 🏦 Bank: **${store.formatNumber(w.bank || 0)}**\n> Net Worth: **${store.formatNumber(total)}**\n> \n${streakText}`,
  };

  if (payout > 0) {
    embed.footer = { text: `+${store.formatNumber(payout)} interest collected` };
  }

  return interaction.reply({ embeds: [embed] });
}

async function handleDaily(interaction) {
  const userId = interaction.user.id;
  const c = store.checkDaily(userId);
  if (!c.canClaim) {
    return interaction.reply({ embeds: [{
      color: 0xed4245,
      description: `Already claimed. **${c.hours}h ${c.mins}m** left\n🔥 Streak: ${c.streak}`,
    }] });
  }
  const r = store.claimDaily(userId);
  const sm = r.streak > 1
    ? `\n🔥 ${r.streak} day streak! (+${store.formatNumber(CONFIG.economy.daily.streakBonusPerDay * (r.streak - 1))} bonus)`
    : '';
  return interaction.reply({ embeds: [{
    color: 0x57f287,
    title: '📅 Daily Reward',
    description: `Claimed **${store.formatNumber(r.reward)}** coins!${sm}\nBalance: **${store.formatNumber(r.newBalance)}**`,
  }] });
}

async function handleDeposit(interaction) {
  const userId = interaction.user.id;
  const rawAmount = interaction.options.getString('amount');
  const bal = store.getBalance(userId);

  const amount = rawAmount && typeof rawAmount === 'string'
    ? store.parseAmount(rawAmount, bal)
    : interaction.options.getInteger('amount');

  if (!amount || amount <= 0) {
    return interaction.reply({ embeds: [{ color: 0xed4245, description: CONFIG.commands.invalidAmountText }] });
  }

  if (amount > bal) return interaction.reply({ embeds: [{ color: 0xed4245, description: `You only have **${store.formatNumber(bal)}**` }] });
  store.processBank(userId);
  const w = store.getWallet(userId);
  w.balance -= amount; w.bank += amount;
  if (!w.lastBankPayout) w.lastBankPayout = Date.now();
  store.saveWallets();
  const rate = store.getInterestRate(userId);
  return interaction.reply({ embeds: [{
    color: 0x57f287,
    title: '🏦 Deposit',
    description: `Deposited **${store.formatNumber(amount)}** to bank\nBank: **${store.formatNumber(w.bank)}** (${(rate * 100).toFixed(0)}% daily, paid hourly)\nPurse: **${store.formatNumber(w.balance)}**`,
  }] });
}

async function handleWithdraw(interaction) {
  const userId = interaction.user.id;
  const rawAmount = interaction.options.getString('amount');
  let w = store.getWallet(userId);

  const amount = rawAmount && typeof rawAmount === 'string'
    ? store.parseAmount(rawAmount, w.bank)
    : interaction.options.getInteger('amount');

  if (!amount || amount <= 0) {
    return interaction.reply({ embeds: [{ color: 0xed4245, description: CONFIG.commands.invalidAmountText }] });
  }

  if (amount > w.bank) return interaction.reply({ embeds: [{ color: 0xed4245, description: `Insufficient bank funds. You have **${store.formatNumber(w.bank)}** in your bank.` }] });
  store.processBank(userId);
  w = store.getWallet(userId);
  if (amount > w.bank) return interaction.reply({ embeds: [{ color: 0xed4245, description: `Insufficient bank funds. You have **${store.formatNumber(w.bank)}** in your bank.` }] });
  w.bank -= amount; w.balance += amount; store.saveWallets();
  return interaction.reply({ embeds: [{
    color: 0x57f287,
    title: '🏦 Withdrawal',
    description: `Withdrew **${store.formatNumber(amount)}**\nBank: **${store.formatNumber(w.bank)}** | Purse: **${store.formatNumber(w.balance)}**`,
  }] });
}

module.exports = { handleBalance, handleDaily, handleDeposit, handleWithdraw };
