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
    if (iv > 0) parts.push(`🩷 +${iv.toFixed(2)}${suffix}`);
    if (tv > 0) parts.push(`🔥 +${tv.toFixed(2)}${suffix}`);
    const totalStr = (parts.length > 1) ? ` ᐅ **${total.toFixed(2)}${suffix}**` : '';
    return parts.join('  ') + totalStr;
  }

  function statLineRaw(baseVal, itemVal, tempVal, suffix = 'x', decimals = 1) {
    let parts = [`**${baseVal.toFixed(decimals)}${suffix}**`];
    if (itemVal > 0) parts.push(`🩷 +${itemVal.toFixed(decimals)}${suffix}`);
    if (tempVal > 0) parts.push(`🔥 +${tempVal.toFixed(decimals)}${suffix}`);
    const total = baseVal + itemVal + tempVal;
    const totalStr = (parts.length > 1) ? ` ᐅ **${total.toFixed(decimals)}${suffix}**` : '';
    return parts.join('  ') + totalStr;
  }

  const fields = [];

  // Active Potions
  const potions = store.getActivePotions(userId);
  let potionText = '';
  if (potions.lucky) {
    const minsLeft = Math.max(0, Math.ceil((potions.lucky.expiresAt - Date.now()) / 60000));
    potionText += `> 🧪 **Lucky Pot** — +10% win chance (${minsLeft}m left)\n`;
  }
  if (potions.unlucky) {
    const minsLeft = Math.max(0, Math.ceil((potions.unlucky.expiresAt - Date.now()) / 60000));
    potionText += `> 💀 **Unlucky Pot** — -10% win chance (${minsLeft}m left)\n`;
  }
  if (!potionText) potionText = '> No active potions\n';

  const modifier = store.getWinChanceModifier(userId);
  if (modifier !== 1.0) {
    const sign = modifier > 1 ? '+' : '';
    potionText += `> ⚡ Win Chance Modifier: **${sign}${((modifier - 1) * 100).toFixed(0)}%**\n`;
  }

  fields.push({
    name: '🧪 Potions',
    value: potionText,
    inline: false,
  });

  // Luck (temporary buff)
  let luckText;
  if (luck.active) {
    const minsLeft = Math.max(0, Math.ceil((luck.expiresInMs || 0) / 60000));
    luckText = `\u25CF **${luck.activeStacks}/${luck.maxStacks}** stacks (🔥 +${(luck.cashbackRate * 100).toFixed(1)}% cashback, ${minsLeft}m left)`;
  } else {
    luckText = '\u25CB Inactive';
  }
  fields.push({
    name: '\u2618 Luck',
    value: `> ${luckText}\n> Loss Streak: **${luck.lossStreak || 0}** (Best: ${luck.bestLossStreak || 0})\n> Triggers: **${luck.triggers || 0}**\n> Total Cashback: **${store.formatNumber(luck.totalCashback || 0)}**`,
    inline: false,
  });

  // Bank Interest — base (upgrades) + items
  fields.push({
    name: '\u00A4 Bank Interest',
    value: `> ${statLine(base.interestRate, items.interestRate, 0)}/day`,
    inline: true,
  });

  // Cashback — base + items + luck temp
  const luckCashbackTemp = luck.active ? luck.cashbackRate : 0;
  fields.push({
    name: '\u21A9 Cashback',
    value: `> ${statLine(base.cashbackRate, items.cashbackRate, luckCashbackTemp)}`,
    inline: true,
  });

  fields.push({ name: '\u200b', value: '\u200b', inline: false });

  // Spin Multiplier — base + items
  fields.push({
    name: '\u229B Spin Multiplier',
    value: `> ${statLineRaw(base.spinWeight, items.spinWeight, 0)}`,
    inline: true,
  });

  // Universal Income Multiplier — base + items
  fields.push({
    name: '\u2295 Income Multiplier',
    value: `> Double: ${statLine(base.universalDoubleChance, items.universalDoubleChance, 0)}`,
    inline: true,
  });

  fields.push({ name: '\u200b', value: '\u200b', inline: false });

  // Mines Save — items only (no base upgrade for this)
  fields.push({
    name: '\u25C8 Mines Save',
    value: `> Reveal: ${statLine(base.minesRevealChance, items.minesRevealChance, 0)}`,
    inline: true,
  });

  fields.push({ name: '\u200b', value: '\u200b', inline: false });

  // Legend
  fields.push({
    name: 'Legend',
    value: '> Base (upgrades) · 🩷 Collection items · 🔥 Temporary · 🧪 Potions',
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
