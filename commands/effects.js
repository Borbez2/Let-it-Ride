const store = require('../data/store');

function renderEffectsPage(username, userId, wallet) {
  const bonuses = store.getUserBonuses(userId);
  const luck = bonuses.luck || {};
  const base = bonuses.base || {};
  const items = bonuses.items || {};

  function statLine(basePct, itemPct, tempPct, suffix = '%', mult = 100) {
    const bv = basePct * mult;
    const iv = itemPct * mult;
    const tv = tempPct * mult;
    const total = bv + iv + tv;
    let parts = [`**${bv.toFixed(2)}${suffix}**`];
    if (iv > 0) parts.push(`🎒 +${iv.toFixed(2)}${suffix}`);
    if (tv > 0) parts.push(`🔥 +${tv.toFixed(2)}${suffix}`);
    const totalStr = (parts.length > 1) ? ` ᐅ **${total.toFixed(2)}${suffix}**` : '';
    return parts.join('  ') + totalStr;
  }

  function statLineRaw(baseVal, itemVal, tempVal, suffix = 'x', decimals = 1) {
    let parts = [`**${baseVal.toFixed(decimals)}${suffix}**`];
    if (itemVal > 0) parts.push(`🎒 +${itemVal.toFixed(decimals)}${suffix}`);
    if (tempVal > 0) parts.push(`🔥 +${tempVal.toFixed(decimals)}${suffix}`);
    const total = baseVal + itemVal + tempVal;
    const totalStr = (parts.length > 1) ? ` ᐅ **${total.toFixed(decimals)}${suffix}**` : '';
    return parts.join('  ') + totalStr;
  }

  const fields = [];

  // Win Chance — combined breakdown of all sources (potions + streak), total first
  const potions = store.getActivePotions(userId);
  const potionConfig = store.getPotionConfig();
  const luckyStacks = potions.lucky ? (potions.lucky.stacks ? potions.lucky.stacks.length : 1) : 0;
  const luckyPotBoost = Math.min(luckyStacks, 1) * potionConfig.luckyPotBoost;
  const unluckyPotPenalty = potions.unlucky ? potionConfig.unluckyPotPenalty : 0;
  const streakBoost = luck.active ? (luck.winChanceBoost || 0) : 0;
  const totalWinChanceBoost = luckyPotBoost - unluckyPotPenalty + streakBoost;
  const totalSign = totalWinChanceBoost >= 0 ? '+' : '';

  let winChanceText = `> **Total: ${totalSign}${(totalWinChanceBoost * 100).toFixed(1)}%** win chance\n`;
  winChanceText += `> Base: **0%**\n`;
  if (luckyPotBoost > 0) {
    const luckyMinsLeft = Math.max(0, Math.ceil((potions.lucky.expiresAt - Date.now()) / 60000));
    winChanceText += `> ☘⚱ Lucky Pot (${luckyStacks} stack${luckyStacks !== 1 ? 's' : ''}, ${luckyMinsLeft}m left): **+${(luckyPotBoost * 100).toFixed(1)}%**\n`;
  }
  if (unluckyPotPenalty > 0) {
    const unluckyMinsLeft = Math.max(0, Math.ceil((potions.unlucky.expiresAt - Date.now()) / 60000));
    winChanceText += `> ⚱✕ Unlucky Pot (${unluckyMinsLeft}m left): **-${(unluckyPotPenalty * 100).toFixed(1)}%**\n`;
  }
  if (streakBoost > 0) {
    const streakMinsLeft = Math.max(0, Math.ceil(luck.expiresInMs / 60000));
    winChanceText += `> 🔥 Losing Streak (${streakMinsLeft}m left): **+${(streakBoost * 100).toFixed(1)}%**\n`;
  }
  if (luckyPotBoost === 0 && unluckyPotPenalty === 0 && streakBoost === 0) {
    winChanceText += `> No active win chance effects\n`;
  }

  fields.push({
    name: '🎯 Win Chance',
    value: winChanceText,
    inline: false,
  });

  // Luck (losing streak) — win chance boost bar + streak info
  const pityStatus = store.getUserPityStatus(userId);
  const maxStacks = pityStatus.tier2Cap - pityStatus.activationThreshold + 1;
  const activeStacks = pityStatus.active ? (pityStatus.buffStreak - pityStatus.activationThreshold + 1) : 0;
  const stackBar = '▰'.repeat(activeStacks) + '▱'.repeat(maxStacks - activeStacks);
  const boostPct = ((pityStatus.winChanceBoost || 0) * 100).toFixed(1);
  const maxPct = (pityStatus.maxWinChanceBoost * 100).toFixed(1);

  let luckText;
  if (pityStatus.active) {
    const minsLeft = Math.max(0, Math.ceil(pityStatus.expiresInMs / 60000));
    luckText = `> ● ${stackBar} **${boostPct}%/${maxPct}%** win chance (🔥 ${minsLeft}m left)\n`;
    luckText += `> From Streak: **${pityStatus.buffStreak}** · Stacks: **${activeStacks}/${maxStacks}**\n`;
    luckText += `> Keep losing to upgrade the buff. A higher streak replaces the current boost.`;
  } else {
    const lossesNeeded = Math.max(1, pityStatus.activationThreshold - pityStatus.lossStreak);
    luckText = `> ○ ${stackBar} **0%/${maxPct}%**\n`;
    luckText += `> No active luck buff. Lose **${lossesNeeded}** more in a row to trigger.`;
  }

  fields.push({
    name: '☘ Luck (Flip, Duel, Let It Ride)',
    value: `${luckText}\n> Loss Streak: **${pityStatus.lossStreak}** (Best: ${pityStatus.bestLossStreak})\n> Triggers: **${pityStatus.triggers}**`,
    inline: false,
  });

  // Bank Interest — base (upgrades) + items
  fields.push({
    name: '∑ Bank Interest',
    value: `> ${statLine(base.interestRate, items.interestRate, 0)}/day`,
    inline: true,
  });

  // Cashback — base + items (streak no longer contributes here)
  fields.push({
    name: '↩ Cashback',
    value: `> ${statLine(base.cashbackRate, items.cashbackRate, 0)}`,
    inline: true,
  });

  fields.push({ name: '\u200b', value: '\u200b', inline: false });

  // Spin Multiplier — base + items
  fields.push({
    name: '⟳× Spin Multiplier',
    value: `> ${statLineRaw(base.spinWeight, items.spinWeight, 0)}`,
    inline: true,
  });

  // Universal Income Multiplier — base + items
  fields.push({
    name: '∀× Income Multiplier',
    value: `> Double: ${statLine(base.universalDoubleChance, items.universalDoubleChance, 0)}`,
    inline: true,
  });

  fields.push({ name: '\u200b', value: '\u200b', inline: false });

  // Mines Save — items only
  fields.push({
    name: '⛁⌖ Mines Save',
    value: `> Reveal: ${statLine(base.minesRevealChance, items.minesRevealChance, 0)}`,
    inline: true,
  });

  fields.push({ name: '\u200b', value: '\u200b', inline: false });

  // Legend
  fields.push({
    name: 'Legend',
    value: '> Base (upgrades) · 🎒 Collection items · 🔥 Temporary · ☘⚱ Lucky pot · ⚱✕ Unlucky pot',
    inline: false,
  });

  return {
    title: `\u2726 ${username}'s Effects`,
    color: 0x2b2d31,
    fields,
  };
}

async function handleEffects(interaction) {
  const targetUser = interaction.options.getUser('user');
  let userId = interaction.user.id;
  let username = interaction.user.username;

  if (targetUser) {
    userId = targetUser.id;
    username = targetUser.username;
  }

  if (!store.hasWallet(userId)) {
    return interaction.reply({ content: `No data found for **${username}**.`, ephemeral: true });
  }

  const wallet = store.getWallet(userId);
  const embed = renderEffectsPage(username, userId, wallet);
  return interaction.reply({ embeds: [embed] });
}

module.exports = { handleEffects };
