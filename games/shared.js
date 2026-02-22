/**
 * Shared helpers used across all game modules.
 */

/**
 * Announce a luck/pity trigger in the channel.
 */
async function maybeAnnouncePityTrigger(interaction, userId, pityResult) {
  if (!pityResult || !pityResult.triggered) return;
  const channel = interaction.channel;
  if (!channel || typeof channel.send !== 'function') return;

  const boostPct = (pityResult.winChanceBoost * 100).toFixed(1);

  await channel.send({
    embeds: [{
      color: 0x57f287,
      description: `☘ <@${userId}> luck triggered: **+${boostPct}%** win chance boost (loss streak: ${pityResult.lossStreak})`,
    }],
  }).catch(() => null);
}

module.exports = { maybeAnnouncePityTrigger };
