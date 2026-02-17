const store = require('../data/store');

async function handleStats(interaction) {
  const targetUser = interaction.options.getUser('user');
  const userId = targetUser ? targetUser.id : interaction.user.id;
  const username = targetUser ? targetUser.username : interaction.user.username;

  if (targetUser && !store.hasWallet(userId)) {
    return interaction.reply(`No stats found for **${username}**.`);
  }

  const wallet = store.getWallet(userId);
  const stats = wallet.stats;

  let text = `**📊 Stats for ${username}**\n\n`;

  // Game-by-game breakdown
  text += `**🎮 Game Breakdown**\n`;
  const games = ['flip', 'dice', 'roulette', 'blackjack', 'mines', 'letitride', 'duel'];
  for (const game of games) {
    const gameStats = stats[game] || { wins: 0, losses: 0 };
    const total = gameStats.wins + gameStats.losses;
    if (total === 0) {
      text += `• ${capitalize(game)}: No plays\n`;
    } else {
      const winRate = ((gameStats.wins / total) * 100).toFixed(1);
      text += `• ${capitalize(game)}: ${gameStats.wins}W ${gameStats.losses}L (${winRate}% win rate)\n`;
    }
  }

  // Giveaways
  const gw = stats.giveaway || { created: 0, amountGiven: 0, won: 0, amountWon: 0 };
  text += `\n**🎉 Giveaways**\n`;
  text += `• Created: ${gw.created} (${store.formatNumber(gw.amountGiven)} given away)\n`;
  text += `• Won: ${gw.won} (${store.formatNumber(gw.amountWon)} earned)\n`;

  // Event Betting
  const eb = stats.eventBetting || { wins: 0, losses: 0, amountWon: 0, amountLost: 0 };
  text += `\n**📊 Event Betting**\n`;
  text += `• Wins: ${eb.wins} (${store.formatNumber(eb.amountWon)} earned)\n`;
  text += `• Losses: ${eb.losses} (${store.formatNumber(eb.amountLost)} lost)\n`;

  // Passive Income
  const ds = stats.dailySpin || { won: 0, amountWon: 0 };
  const int = stats.interest || { totalEarned: 0 };
  const ui = stats.universalIncome || { totalEarned: 0 };
  text += `\n**💵 Passive Income**\n`;
  text += `• Daily Spin: ${ds.won} wins (${store.formatNumber(ds.amountWon)} earned)\n`;
  text += `• Bank Interest: ${store.formatNumber(int.totalEarned)} earned\n`;
  text += `• Universal Income: ${store.formatNumber(ui.totalEarned)} earned\n`;

  // Lifetime summary
  text += `\n**💰 Lifetime Summary**\n`;
  text += `• Total Earnings: **${store.formatNumber(stats.lifetimeEarnings || 0)}** coins\n`;
  text += `• Total Losses: **${store.formatNumber(stats.lifetimeLosses || 0)}** coins\n`;

  const netProfit = (stats.lifetimeEarnings || 0) - (stats.lifetimeLosses || 0);
  if (netProfit >= 0) {
    text += `• Net Profit: **+${store.formatNumber(netProfit)}** coins ✅\n`;
  } else {
    text += `• Net Loss: **${store.formatNumber(netProfit)}** coins ❌\n`;
  }

  const totalGames = games.reduce((sum, g) => sum + ((stats[g] || {}).wins || 0) + ((stats[g] || {}).losses || 0), 0);
  if (totalGames > 0) {
    const totalWins = games.reduce((sum, g) => sum + ((stats[g] || {}).wins || 0), 0);
    const overallWinRate = (totalWins / totalGames) * 100;
    text += `• Overall Win Rate: **${overallWinRate.toFixed(1)}%** (${totalWins} total wins)\n`;
  }

  return interaction.reply(text);
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

module.exports = { handleStats };
