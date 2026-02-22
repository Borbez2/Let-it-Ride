const { CONFIG } = require('../config');
const store = require('../data/store');

async function handlePool(interaction) {
  const poolData = store.getPoolData();
  const wallets = store.getAllWallets();
  const nextHourly = poolData.lastHourlyPayout + 3600000;
  const minsH = Math.max(0, Math.floor((nextHourly - Date.now()) / 60000));
  const players = Object.keys(wallets).length;
  const share = players > 0 ? Math.floor(poolData.universalPool / players) : 0;

  const taxMin = CONFIG.economy.pools.universalTaxMinNetWorth || 1000000;
  const baseRate = CONFIG.economy.pools.universalTaxRate;
  const basePct = (baseRate * 100).toFixed(0);

  // Build contribution slab display
  const contSlabs = CONFIG.economy.pools.contributionSlabs || [];
  const contFinal = CONFIG.economy.pools.contributionFinalScale ?? 0.005;
  let slabLines = '';
  let prevThreshold = 0;
  for (let i = 0; i < contSlabs.length; i++) {
    const s = contSlabs[i];
    const pct = (s.scale * 100).toFixed(0);
    const toLabel = store.formatNumber(s.threshold);
    slabLines += `> Slab ${i + 1}: ${store.formatNumber(prevThreshold)} to ${toLabel} - **${pct}%** of tax\n`;
    prevThreshold = s.threshold;
  }
  const finalPct = (contFinal * 100);
  const finalFmt = finalPct >= 0.1 ? finalPct.toFixed(1) : finalPct.toFixed(2);
  slabLines += `> Slab ${contSlabs.length + 1}: ${store.formatNumber(prevThreshold)} to infinity - **${finalFmt}%** of tax`;

  const embed = {
    title: '🏦 Universal Pool',
    color: 0x2b2d31,
    description: `> ${basePct}% flat win tax (only when net worth > ${store.formatNumber(taxMin)})`,
    fields: [
      {
        name: 'Pool Balance',
        value: `**${store.formatNumber(poolData.universalPool)}** coins`,
        inline: true,
      },
      {
        name: 'Your Share',
        value: `~**${store.formatNumber(share)}** coins`,
        inline: true,
      },
      {
        name: 'Next Payout',
        value: `**${minsH}m**`,
        inline: true,
      },
      {
        name: `Contribution Slabs`,
        value: `> You always pay ${basePct}% tax, but only this portion is added to the pool:\n${slabLines}`,
        inline: false,
      },
      {
        name: '🎰 Daily Spin Pool',
        value: `> Total: **${store.formatNumber(poolData.lossPool)}** coins\n> 5% loss tax - spins daily at 11:15pm\n> Winnings multiplied by your Spin Payout Mult upgrade`,
        inline: false,
      },
    ],
  };

  return interaction.reply({ embeds: [embed] });
}

module.exports = { handlePool };
