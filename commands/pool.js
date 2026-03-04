const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { CONFIG } = require('../config');
const store = require('../data/store');

function buildSlabLines() {
  const netWorthTax = CONFIG.economy.pools.netWorthTax || {};
  const contSlabs = netWorthTax.slabs || [];
  const contFinal = netWorthTax.finalScale ?? 0;
  let slabLines = '';
  let prevThreshold = 0;
  for (let i = 0; i < contSlabs.length; i++) {
    const s = contSlabs[i];
    const pct = (s.scale * 100).toFixed(0);
    slabLines += `> Slab ${i + 1}: ${store.formatNumber(prevThreshold)}–${store.formatNumber(s.threshold)} - **${pct}%** of base rate\n`;
    prevThreshold = s.threshold;
  }
  const finalPct = contFinal * 100;
  const finalFmt = finalPct >= 0.1 ? finalPct.toFixed(1) : finalPct.toFixed(2);
  slabLines += `> Slab ${contSlabs.length + 1}: ${store.formatNumber(prevThreshold)}+ - **${finalFmt}%** of tax`;
  return { slabLines, contSlabs, contFinal };
}

function buildMainEmbed(userId) {
  const poolData = store.getPoolData();
  const wallets = store.getAllWallets();
  const nextHourly = poolData.lastHourlyPayout + 3600000;
  const minsH = Math.max(0, Math.floor((nextHourly - Date.now()) / 60000));
  const players = Object.keys(wallets).filter((id) => /^\d{17,20}$/.test(String(id || ''))).length;
  const share = players > 0 ? Math.floor(poolData.universalPool / players) : 0;

  const netWorthTax = CONFIG.economy.pools.netWorthTax || {};
  const taxMin = netWorthTax.minNetWorth || 0;
  const baseRate = netWorthTax.baseRate || 0;
  const basePct = (baseRate * 100).toFixed(3);
  const splitToLossPool = Math.max(0, Math.min(1, netWorthTax.splitToLossPool ?? 0.5));
  const splitToUniversal = 1 - splitToLossPool;
  const { slabLines } = buildSlabLines();

  return {
    title: '🏦 Universal Pool',
    color: 0x2b2d31,
    description: `> Hourly bank-funded net-worth tax: **${basePct}% base** (applies at **${store.formatNumber(taxMin)}+** net worth)`,
    fields: [
      { name: 'Pool Balance', value: `**${store.formatNumber(poolData.universalPool)}** coins`, inline: true },
      { name: 'Your Share', value: `~**${store.formatNumber(share)}** coins`, inline: true },
      { name: 'Next Payout', value: `**${minsH}m**`, inline: true },
      {
        name: 'Net-Worth Tax Slabs',
        value: `> Interest is paid first, then a slabbed % of whole net worth is taxed from bank.\n> Split: **${Math.round(splitToUniversal * 100)}%** to Universal Pool, **${Math.round(splitToLossPool * 100)}%** to Daily Spin Pool.\n${slabLines}`,
        inline: false,
      },
      {
        name: '🎰 Daily Spin Pool',
        value: `> Total: **${store.formatNumber(poolData.lossPool)}** coins\n> Funded by the same hourly bank-funded net-worth tax\n> Spins daily at 11:15pm • Winnings multiplied by your Spin Payout Mult upgrade`,
        inline: false,
      },
    ],
    footer: { text: 'Use 📊 Breakdown to see live per-slab contribution totals' },
  };
}

function buildBreakdownEmbed() {
  const poolData = store.getPoolData();
  const slabStats = store.getPoolSlabStats();
  const { contSlabs, contFinal } = buildSlabLines();

  const totalContributed = slabStats._totalContributed || 0;
  let slabLines = '';
  let prevThreshold = 0;
  for (let i = 0; i < contSlabs.length; i++) {
    const s = contSlabs[i];
    const pct = (s.scale * 100).toFixed(0);
    const contributed = slabStats[`slab_${i}`] || 0;
    slabLines += `> Slab ${i + 1}: ${store.formatNumber(prevThreshold)}–${store.formatNumber(s.threshold)} (**${pct}%** of base rate)\n`;
    slabLines += `> ↳ Total sent to pool: **${store.formatNumber(Math.round(contributed))}**\n`;
    prevThreshold = s.threshold;
  }
  const finalIdx = contSlabs.length;
  const finalPct = contFinal * 100;
  const finalFmt = finalPct >= 0.1 ? finalPct.toFixed(1) : finalPct.toFixed(2);
  const finalContributed = slabStats[`slab_${finalIdx}`] || 0;
  slabLines += `> Slab ${finalIdx + 1}: ${store.formatNumber(prevThreshold)}+ (**${finalFmt}%** of base rate)\n`;
  slabLines += `> ↳ Total sent to pool: **${store.formatNumber(Math.round(finalContributed))}**`;

  return {
    title: '📊 Pool Contribution Breakdown',
    color: 0x2b2d31,
    description: `Live stats since last restart — how much each net-worth slab has contributed via hourly bank tax.`,
    fields: [
      {
        name: 'Per-Slab Contributions',
        value: slabLines || '> No data yet',
        inline: false,
      },
      {
        name: 'Totals',
        value: `> Total ever contributed: **${store.formatNumber(Math.round(totalContributed))}**\n> Current pool balance: **${store.formatNumber(poolData.universalPool)}**`,
        inline: false,
      },
    ],
    footer: { text: 'Stats reset on bot restart • Use 🏦 Main to go back' },
  };
}

async function handlePool(interaction) {
  const userId = interaction.user.id;
  const embed = buildMainEmbed(userId);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`pool_breakdown_${userId}`)
      .setLabel('📊 Breakdown')
      .setStyle(ButtonStyle.Secondary)
  );
  return interaction.reply({ embeds: [embed], components: [row] });
}

async function handlePoolButton(interaction) {
  const parts = interaction.customId.split('_');
  // pool_breakdown_userId  or  pool_main_userId
  const action = parts[1];
  const userId = interaction.user.id;

  if (action === 'breakdown') {
    const embed = buildBreakdownEmbed();
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`pool_main_${userId}`)
        .setLabel('🏦 Main')
        .setStyle(ButtonStyle.Secondary)
    );
    return interaction.update({ embeds: [embed], components: [row] });
  }

  if (action === 'main') {
    const embed = buildMainEmbed(userId);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`pool_breakdown_${userId}`)
        .setLabel('📊 Breakdown')
        .setStyle(ButtonStyle.Secondary)
    );
    return interaction.update({ embeds: [embed], components: [row] });
  }
}

module.exports = { handlePool, handlePoolButton };
