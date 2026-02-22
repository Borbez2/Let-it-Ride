const { CONFIG } = require('../config');
const store = require('../data/store');

async function handleGive(interaction) {
  const userId = interaction.user.id, username = interaction.user.username;
  const target = interaction.options.getUser('user');
  const rawAmount = interaction.options.getString('amount');
  const bal = store.getBalance(userId);

  const amount = store.parseAmount(rawAmount, bal);
  if (!amount || amount <= 0) {
    return interaction.reply({ embeds: [{ color: 0xed4245, description: CONFIG.commands.invalidAmountText }] });
  }

  if (target.id === userId) return interaction.reply({ embeds: [{ color: 0xed4245, description: "Can't give to yourself." }] });
  if (target.bot) return interaction.reply({ embeds: [{ color: 0xed4245, description: "Can't give to a bot." }] });
  if (amount > bal) return interaction.reply({ embeds: [{ color: 0xed4245, description: `You only have **${store.formatNumber(bal)}**` }] });

  store.setBalance(userId, bal - amount);
  store.setBalance(target.id, store.getBalance(target.id) + amount);
  return interaction.reply({ embeds: [{
    color: 0x57f287,
    title: '💸 Gift',
    description: `**${username}** gave **${store.formatNumber(amount)}** to **${target.username}**`,
  }] });
}

module.exports = { handleGive };
