const store = require('../data/store');

async function handleStats(interaction) {
  const userId = interaction.user.id;
  const wallet = store.getWallet(userId);
  const stats = wallet.stats;

  let text = `**📊 Stats for ${interaction.user.username}**\n\n`;

  // Game-by-game breakdown
  text += `**Game Breakdown**\n`;
  const games = ['flip', 'dice', 'roulette', 'blackjack', 'mines', 'letitride', 'duel'];
  for (const game of games) {
    const gameStats = stats[game];
    const total = gameStats.wins + gameStats.losses;
    if (total === 0) {
      text += `• ${capitalize(game)}: No plays\n`;
    } else {
      const winRate = ((gameStats.wins / total) * 100).toFixed(1);
      text += `• ${capitalize(game)}: ${gameStats.wins}W ${gameStats.losses}L (${winRate}% win rate)\n`;
    }
  }

  // Lifetime summary
  text += `\n**💰 Lifetime Summary**\n`;
  text += `• Total Earnings: **${store.formatNumber(stats.lifetimeEarnings)}** coins\n`;
  text += `• Total Losses: **${store.formatNumber(stats.lifetimeLosses)}** coins\n`;

  const netProfit = stats.lifetimeEarnings - stats.lifetimeLosses;
  if (netProfit >= 0) {
    text += `• Net Profit: **+${store.formatNumber(netProfit)}** coins ✅\n`;
  } else {
    text += `• Net Loss: **${store.formatNumber(netProfit)}** coins ❌\n`;
  }

  const totalGames = games.reduce((sum, g) => sum + stats[g].wins + stats[g].losses, 0);
  if (totalGames > 0) {
    const overallWinRate = (
      games.reduce((sum, g) => sum + stats[g].wins, 0) / totalGames
    ) * 100;
    text += `• Overall Win Rate: **${overallWinRate.toFixed(1)}%** (${games.reduce((sum, g) => sum + stats[g].wins, 0)} total wins)\n`;
  }

  return interaction.reply(text);
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

module.exports = { handleStats };
