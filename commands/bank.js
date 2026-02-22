const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { CONFIG } = require('../config');
const store = require('../data/store');

function getBankNavRow(userId, activePage) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`bank_tab_overview_${userId}`)
      .setLabel('Overview')
      .setStyle(activePage === 'overview' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`bank_tab_breakdown_${userId}`)
      .setLabel('Breakdown')
      .setStyle(activePage === 'breakdown' ? ButtonStyle.Primary : ButtonStyle.Secondary),
  );
}

function computeTieredDailyInterest(balance, r) {
  const cfg = CONFIG.economy.bank.tieredInterest;
  if (!cfg || !cfg.slabs) return balance * r;
  const { slabs, finalScale } = cfg;
  let total = 0;
  let remaining = balance;
  let prevThreshold = 0;
  for (const slab of slabs) {
    const slabSize = slab.threshold - prevThreshold;
    const applicable = Math.min(remaining, slabSize);
    if (applicable <= 0) break;
    total += applicable * r * slab.scale;
    remaining -= applicable;
    prevThreshold = slab.threshold;
  }
  if (remaining > 0) {
    total += remaining * r * (finalScale || 0.001);
  }
  return total;
}

function buildBankOverviewEmbed(userId, payout) {
  const w = store.getWallet(userId);
  const r = store.getInterestRate(userId);
  const bank = w.bank || 0;
  const dailyInterest = Math.floor(computeTieredDailyInterest(bank, r));
  const hourlyInterest = Math.floor(dailyInterest / 24);
  const last = w.lastBankPayout || Date.now();
  const next = last + 3600000;
  const rem = Math.max(0, next - Date.now());
  const mins = Math.floor(rem / 60000);
  const pending = (w.stats?.interest?.pendingCoins || 0);
  const totalEarned = w.stats?.interest?.totalEarned || 0;

  const fields = [
    {
      name: 'Balance',
      value: `> 💰 Purse: **${store.formatNumber(w.balance)}**\n> Bank: **${store.formatNumber(bank)}**`,
      inline: true,
    },
    {
      name: 'Interest Rate',
      value: `> **${(r * 100).toFixed(2)}%**/day - Lv ${w.interestLevel || 0}/${CONFIG.economy.upgrades.maxLevel}\n> Paid hourly to your bank`,
      inline: true,
    },
    { name: '\u200b', value: '\u200b', inline: false },
    {
      name: 'Estimates',
      value: `> Hourly: ~**${store.formatNumber(hourlyInterest)}** coins\n> Daily: ~**${store.formatNumber(dailyInterest)}** coins`,
      inline: true,
    },
    {
      name: 'Payout Timer',
      value: `> Next payout: **${mins}m**\n> Pending: **${store.formatNumber(pending)}** coins`,
      inline: true,
    },
    { name: '\u200b', value: '\u200b', inline: false },
    {
      name: 'Lifetime',
      value: `> Total interest earned: **${store.formatNumber(totalEarned)}**`,
      inline: false,
    },
  ];

  const embed = {
    title: '🏦 Bank - Overview',
    color: 0x2b2d31,
    description: bank <= 0
      ? '> Bank is empty. Use `/deposit` to move coins from your purse.'
      : '> Your bank balance earns interest using a tiered rate system. See the **Breakdown** tab for details.',
    fields,
  };

  if (payout > 0) {
    embed.footer = { text: `+${store.formatNumber(payout)} interest collected` };
  }

  return embed;
}

function buildBankBreakdownEmbed(userId) {
  const w = store.getWallet(userId);
  const r = store.getInterestRate(userId);
  const bank = w.bank || 0;
  const cfg = CONFIG.economy.bank.tieredInterest;
  const slabs = cfg?.slabs || [];
  const finalScale = cfg?.finalScale ?? 0.001;

  const slabData = [];
  let remaining = bank;
  let prevThreshold = 0;
  let totalDaily = 0;
  for (const slab of slabs) {
    const slabSize = slab.threshold - prevThreshold;
    const inSlab = Math.min(remaining, slabSize);
    const earn = Math.floor(inSlab * r * slab.scale);
    totalDaily += earn;
    slabData.push({ from: prevThreshold, to: slab.threshold, scale: slab.scale, inSlab, earn });
    remaining -= inSlab;
    prevThreshold = slab.threshold;
    if (remaining <= 0) break;
  }
  let finalEarn = 0;
  if (remaining > 0) {
    finalEarn = Math.floor(remaining * r * finalScale);
    totalDaily += finalEarn;
    slabData.push({ from: prevThreshold, to: null, scale: finalScale, inSlab: remaining, earn: finalEarn });
  }

  const rPct = (r * 100).toFixed(2);

  const fields = [
    {
      name: 'Your Rate (r)',
      value: `> **${rPct}%**/day (base ${(CONFIG.economy.bank.baseInvestRate * 100).toFixed(0)}% + Lv${w.interestLevel || 0} upgrades + items)`,
      inline: false,
    },
  ];

  for (let i = 0; i < slabData.length; i++) {
    const s = slabData[i];
    const effectiveRatePct = (r * s.scale * 100);
    const rateFmt = effectiveRatePct >= 0.01 ? effectiveRatePct.toFixed(3) : effectiveRatePct.toFixed(4);
    const toLabel = s.to !== null ? store.formatNumber(s.to) : 'infinity';
    const scaleLabel = s.scale === 1 ? 'r' : `r x ${s.scale}`;
    fields.push({
      name: `Slab ${i + 1}: ${store.formatNumber(s.from)} to ${toLabel} - rate = ${scaleLabel}`,
      value: `> In slab: **${store.formatNumber(s.inSlab)}** coins\n> Rate: **${rateFmt}%** - ~**${store.formatNumber(s.earn)}**/day`,
      inline: false,
    });
  }

  fields.push({ name: '\u200b', value: '\u200b', inline: false });
  fields.push({
    name: 'Total estimated interest',
    value: `> **${store.formatNumber(totalDaily)}**/day - **${store.formatNumber(Math.floor(totalDaily / 24))}**/hour`,
    inline: false,
  });

  return {
    title: '🏦 Bank - Tiered Interest Breakdown',
    color: 0x2b2d31,
    description: '> Interest is calculated in slabs like tax brackets. Higher balances earn at a lower marginal rate, but every slab still contributes.',
    fields,
  };
}

function buildBankPage(userId, page, payout = 0) {
  const embed = page === 'breakdown'
    ? buildBankBreakdownEmbed(userId)
    : buildBankOverviewEmbed(userId, payout);
  const components = [getBankNavRow(userId, page)];
  return { embed, components };
}

async function handleBank(interaction) {
  const userId = interaction.user.id;
  const payout = store.processBank(userId);
  const { embed, components } = buildBankPage(userId, 'overview', payout);
  return interaction.reply({ content: '', embeds: [embed], components });
}

async function handleBankButton(interaction, parts) {
  const page = parts[2];
  const uid = parts[3];
  if (interaction.user.id !== uid) return interaction.reply({ content: 'Not your bank view!', ephemeral: true });
  const { embed, components } = buildBankPage(uid, page);
  return interaction.update({ content: '', embeds: [embed], components });
}

module.exports = { handleBank, handleBankButton };
