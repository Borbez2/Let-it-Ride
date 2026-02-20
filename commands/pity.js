const store = require('../data/store');

function formatDuration(ms) {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${mins}m ${secs}s`;
}

async function handlePity(interaction) {
  const userId = interaction.user.id;
  const status = store.getUserPityStatus(userId);

  let text = `**\u2618 Luck Status: ${interaction.user.username}**\n\n`;
  text += `\u2027 Loss Streak: **${status.lossStreak}** (Best: ${status.bestLossStreak})\n`;
  text += `\u2027 Total Triggers: **${status.triggers}**\n`;
  text += `\u2027 Total Cashback Earned: **${store.formatNumber(status.totalCashback)}**\n`;
  text += `\u2027 Max Cashback: **${(status.maxCashbackRate * 100).toFixed(1)}%** (${status.maxStacks} stacks)\n`;

  if (!status.active || !status.stacks.length) {
    text += `\u2027 Active Stacks: **0/${status.maxStacks}**\n`;
    const lossesNeeded = status.lossStreak < 5
      ? 5 - status.lossStreak
      : 3 - ((status.lossStreak - 5) % 3 || 3);
    text += `\nNo active luck stacks. Lose **${Math.max(1, lossesNeeded)}** more in a row to trigger.`;
    return interaction.reply(text);
  }

  text += `\u2027 Active Stacks: **${status.activeStacks}/${status.maxStacks}** (+${(status.cashbackRate * 100).toFixed(1)}% cashback)\n\n`;
  text += `**Stack Timers**\n`;

  for (const stack of status.stacks) {
    const cbPct = (stack.cashback * 100).toFixed(1);
    text += `\u2027 Stack ${stack.id}: +${cbPct}% cashback (${formatDuration(stack.remainingMs)} left)\n`;
  }

  return interaction.reply(text);
}

module.exports = { handlePity };
