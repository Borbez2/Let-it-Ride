const store = require('../data/store');
const { CONFIG } = require('../config');

function formatDuration(ms) {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${mins}m ${secs}s`;
}

async function handlePity(interaction) {
  const userId = interaction.user.id;
  const status = store.getUserPityStatus(userId);

  let text = `**Pity Status: ${interaction.user.username}**\n\n`;
  text += `• Last luck state: ${(status.lastDirection || 'neutral').toUpperCase()} (${(status.lastConfidence || 0).toFixed(2)}% probability of being this lucky/unlucky, ${status.lastTotalGames || 0} games)\n`;
  text += `• Total pity triggers: ${status.triggers || 0}\n`;
  text += `• Pity cap: +${(CONFIG.runtime.pity.maxBoostRate * 100).toFixed(2)}%\n`;

  if (!status.active || !status.stacks.length) {
    text += `• Active pity boost: none\n`;
    text += `\nNo active pity stacks right now.`;
    return interaction.reply(text);
  }

  text += `• Active pity boost: +${(status.totalBoostRate * 100).toFixed(2)}%\n`;
  text += `• Active stacks: ${status.stacks.length}\n\n`;
  text += `**Per-Stack Life Counter**\n`;

  for (const stack of status.stacks) {
    const thresholdLabel = Number.isFinite(stack.threshold) ? `${stack.threshold}% threshold` : stack.reason;
    const ratePct = (stack.rate * 100).toFixed(2);
    text += `• ${thresholdLabel}: +${ratePct}% (${formatDuration(stack.remainingMs)} left)\n`;
  }

  return interaction.reply(text);
}

module.exports = { handlePity };
