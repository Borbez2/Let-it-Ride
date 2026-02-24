const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { CONFIG, MYSTERY_BOX_POOLS, RARITIES } = require('../config');
const store = require('../data/store');

const PAGE_TITLES = [
  'Economy Overview',
  'Games & Commands',
  'Effects & Modifiers',
  'Collectibles & Boxes',
  'XP, Ranks & Boosts',
  'Number Shorthands',
];

const TOTAL_PAGES = PAGE_TITLES.length;

function buildEconomyPage() {
  const taxPct = (CONFIG.economy.pools.universalTaxRate * 100).toFixed(1);
  const lossPct = (CONFIG.economy.pools.lossTaxRate * 100).toFixed(1);

  return {
    title: PAGE_TITLES[0],
    color: 0x2b2d31,
    description: '> Here\'s how the economy works and the different ways you can earn coins.',
    fields: [
      {
        name: '💰 Your Money',
        value: '> Your **Purse** is spending money for bets, trades, and boxes. Your **Bank** earns interest over time. Move coins between them with `/deposit` and `/withdraw`.',
        inline: false,
      },
      {
        name: '📈 How to Earn',
        value: `> Use **/daily** to claim free coins and build a streak bonus. When you win a game, **${taxPct}%** of your profit goes to the **Universal Pool**, which gets split equally to everyone each hour (straight to your bank). When you lose, **${lossPct}%** goes to the **Spin Pool** and one lucky player wins the whole thing each day at 11:15 AM.`,
        inline: false,
      },
      {
        name: '🏦 Pool Contribution Slabs',
        value: (() => {
          const contSlabs = CONFIG.economy.pools.contributionSlabs || [];
          const contFinal = CONFIG.economy.pools.contributionFinalScale ?? 0.005;
          let lines = `> Your **${taxPct}%** win tax always applies, but **how much of it** reaches the pool depends on the size of your win:\n`;
          let prev = 0;
          for (let i = 0; i < contSlabs.length; i++) {
            const s = contSlabs[i];
            const pct = (s.scale * 100).toFixed(0);
            lines += `> • ${store.formatNumber(prev)} – ${store.formatNumber(s.threshold)}: **${pct}%** of tax added to pool\n`;
            prev = s.threshold;
          }
          const finalPct = contFinal * 100;
          const finalFmt = finalPct >= 0.1 ? finalPct.toFixed(1) : finalPct.toFixed(2);
          lines += `> • ${store.formatNumber(prev)}+: **${finalFmt}%** of tax added to pool\n`;
          lines += `> Use **/pool** and click 📊 Breakdown to see live contribution totals per slab.`;
          return lines;
        })(),
        inline: false,
      },
      { name: '\u200b', value: '\u200b', inline: false },
      {
        name: '🛒 Shop - /shop',
        value: '> **/shop** has three sections:\n> \n> **Upgrades** - Permanently boost your passive stats:\n> ∑ Bank Interest, ↩ Cashback, ⟳× Spin Mult, ∀× Universal Income Mult\n> \n> **Potions** - Temporary effects lasting 30 min:\n> ☘⚱ Lucky Pot (100k) - boosts your win chance by +0.5% (1 at a time)\n> ✕⚱ Unlucky Pot (200k) - reduces another player\'s win chance by -25%\n> \n> **🎁 Mystery Boxes** - Buy boxes to get collectible items that passively boost your stats. Use **/shop** to buy, **/inventory** to view your collection.',
        inline: false,
      },
      {
        name: '📦 Collectibles',
        value: '> Collectibles from mystery boxes give **passive stat bonuses** automatically. Higher-rarity items give bigger bonuses. Completing a full rarity set gives an extra **set bonus** on top.\n> \n> Possible buffs: ∑ interest, ↩ cashback, ☘ luck, ⛁⌖ mines save, ⟳× spin weight, ∀× income chance\n> \n> Browse yours with **/inventory**, check the server with **/collection**, or swap with **/trade**.',
        inline: false,
      },
    ],
  };
}

function buildGamesCommandsPage() {
  return {
    title: PAGE_TITLES[1],
    color: 0x2b2d31,
    description: '> All the games available and what to expect from each one.',
    fields: [
      {
        name: '🎮 Games',
        value: '> **Flip** - Classic coin flip. Pure 50/50, roughly break-even before cashback.\n'
          + '> **Roulette** - Red or black: **-2.70%** EV (house edge from the 0). Green straight up is a big gamble at **-62.16%** EV.\n'
          + '> **All-In 17 Black** - Straight-up single number bet, similar to roulette odds.\n'
          + '> **Blackjack** - Your skill determines the edge. No fixed EV.\n'
          + '> **Mines** - Reveal tiles on a grid, cash out anytime. Multiplier grows with each safe pick, but one mine ends it.\n'
          + '> **Let It Ride** - Double or bust, keep going or walk away. Each step is 50/50.\n'
          + '> **Duel** - Challenge someone. Equal stakes in, one random winner takes all.',
        inline: false,
      },
      { name: '\u200b', value: '\u200b', inline: false },
      {
        name: '💵 Money Commands',
        value: '> `/balance` `/daily` `/bank` `/pool`\n> `/deposit` `/invest` `/withdraw`\n> `/shop`',
        inline: true,
      },
      {
        name: '🎲 Game Commands',
        value: '> `/flip` `/roulette` `/allin17black`\n> `/blackjack` `/mines` `/letitride`\n> `/duel`',
        inline: true,
      },
      { name: '\u200b', value: '\u200b', inline: false },
      {
        name: '🤝 Social & Economy',
        value: '> `/give` `/trade` `/leaderboard`\n> `/stats` `/effects` `/giveaway`',
        inline: true,
      },
      {
        name: '📦 Collectibles',
        value: '> `/inventory` `/collection`',
        inline: true,
      },
    ],
    footer: { text: 'Amount formats: 100 \u2027 4.7k \u2027 1.2m \u2027 2b \u2027 all' },
  };
}

function buildModifiersPage() {
  return {
    title: PAGE_TITLES[2],
    color: 0x2b2d31,
    description: '> Games do their base math first, then your effects get layered on top. Nothing guarantees a win, it just shifts the odds. See your current values with **/effects**.',
    fields: [
      {
        name: 'All Effects',
        value: '> ☘ **Luck** - Win-chance buff that builds from a losing streak (Flip, Duel, Let It Ride). Stacks with Lucky Pot.\n> ∑ **Bank Interest** - Passive hourly payout on your bank balance (tiered rate, see /bank)\n> ↩ **Cashback** - Get back a % of every loss\n> ⟳× **Daily Spin Mult** - Multiplies your spin winnings if you get picked\n> ∀× **Universal Income Mult** - Chance to double your hourly pool payout\n> ⛁⌖ **Mines Save** - Chance to survive hitting a mine\n> \n> **Upgradeable in /shop:** ∑ Interest, ↩ Cashback, ⟳× Spin Mult, ∀× Income Mult\n> **From collectibles:** all of the above plus ☘ Luck and ⛁⌖ Mines Save',
        inline: false,
      },
      { name: '\u200b', value: '\u200b', inline: false },
      {
        name: '☘ How Luck Works',
        value: '> Lose **3 games in a row** (Flip or Duel) to trigger a luck buff. More losses make it stronger:\n> \n> **Streak 3-7:** +0.25% win chance per loss (3 losses = 0.25%, 7 losses = 1.25%)\n> **Streak 8-12:** +0.5% win chance per loss (8 losses = 1.75%, 12 losses = 4.25%)\n> \n> The buff **boosts your win chance** and stacks with Lucky Pot. Lasts **5 minutes**. A higher streak replaces a lower one. Winning resets your streak, but any active buff keeps running until it expires.\n> \n> **Note:** Let It Ride doesn\'t count toward the streak to prevent abuse.',
        inline: false,
      },
      {
        name: '∑ How Bank Interest Works',
        value: '> Interest is calculated in **tiered slabs** (like tax brackets). Your full rate **r** applies to the first 1M; higher balances earn at reduced rates:\n> \n> **Slab 1** (0 to 1M): rate = r\n> **Slab 2** (1M to 10M): rate = r x 0.50\n> **Slab 3** (10M to 100M): rate = r x 0.05\n> **Slab 4** (100M to 1B): rate = r x 0.01\n> **Slab 5** (1B to 1T): rate = r x 0.005\n> **Slab 6** (above 1T): rate = r x 0.001\n> \n> Your rate **r** comes from your base + upgrade levels + collectible bonuses. See the full daily breakdown in `/bank` Breakdown tab.',
        inline: false,
      },
    ],
  };
}

function buildCollectiblesPage() {
  const rarityOrder = CONFIG.ui.rarityOrder;
  const poolEntries = rarityOrder
    .map((rarity) => [rarity, MYSTERY_BOX_POOLS[rarity]])
    .filter(([, pool]) => !!pool);
  const totalWeight = poolEntries.reduce((s, [, p]) => s + p.weight, 0);
  const compensationTable = store.getDuplicateCompensationTable();

  let dropText = '';
  for (const [rarity, pool] of poolEntries) {
    const rawPct = (pool.weight / totalWeight) * 100;
    const dec = rawPct >= 1 ? 1 : rawPct >= 0.1 ? 2 : rawPct >= 0.01 ? 3 : 4;
    const pct = rawPct.toFixed(dec);
    const icon = RARITIES[rarity]?.emoji || '>';
    const label = rarity.charAt(0).toUpperCase() + rarity.slice(1);
    dropText += `> ${icon} ${label}: **${pct}%** (${pool.items.length} items)\n`;
  }

  let compText = '';
  for (const rarity of rarityOrder) {
    const amount = compensationTable[rarity];
    if (!amount) continue;
    const icon = RARITIES[rarity]?.emoji || '>';
    const label = rarity.charAt(0).toUpperCase() + rarity.slice(1);
    compText += `> ${icon} ${label}: **${store.formatNumber(amount)}**\n`;
  }
  if (!compText) compText = '> None configured';

  return {
    title: PAGE_TITLES[3],
    color: 0x2b2d31,
    description: '> Everything about mystery boxes, collectibles, drop rates, and how they boost your stats.',
    fields: [
      {
        name: '🎁 Mystery Boxes',
        value: `> Buy mystery boxes through **/shop** (Mystery Boxes section). Each box costs **${store.formatNumber(CONFIG.collectibles.mysteryBox.cost)}** coins. There are ${CONFIG.collectibles.totalPlaceholders} collectibles across 7 rarity tiers (${CONFIG.collectibles.perRarity} per rarity).`,
        inline: false,
      },
      {
        name: 'Base Drop Weights',
        value: dropText,
        inline: true,
      },
      {
        name: 'Dupe Compensation',
        value: compText,
        inline: true,
      },
      { name: '\u200b', value: '\u200b', inline: false },
      {
        name: '📦 Collectible Buffs',
        value: '> Every collectible you own passively boosts your account. Higher rarity means bigger effect per item:\n> \n> ∑ **Bank Interest**, ↩ **Cashback**, ☘ **Luck**, ⟳× **Spin Weight**, ∀× **Universal Income Chance**, ⛁⌖ **Mines Save**\n> \n> Collecting **every item of a rarity tier** awards a **set completion bonus** on top. Duplicates are auto-converted to coins based on rarity (see Dupe Compensation above).\n> \n> Browse with **/inventory**, check the server with **/collection**, swap with **/trade**.',
        inline: false,
      },
    ],
  };
}

function buildXpRanksPage() {
  const xpCfg = CONFIG.xp;
  const titles = xpCfg.titles;
  const bonusPer10 = xpCfg.bonusPerTenLevels;

  let ranksText = '';
  for (const entry of titles) {
    ranksText += `> **Lv ${entry.minLevel}** — ${entry.title}\n`;
  }

  return {
    title: PAGE_TITLES[4],
    color: 0x2b2d31,
    description: '> Level up by playing games. Every game gives XP, and higher levels unlock titles and permanent stat boosts.',
    fields: [
      {
        name: '⭐ How XP Works',
        value: `> You earn **${xpCfg.perGame} XP** for every game you complete (win or lose).\n> XP requirements grow exponentially — early levels are fast, later levels take more games.\n> Max level: **${xpCfg.maxLevel}**. Use **/stats** → XP tab to see your progress and chart.`,
        inline: false,
      },
      {
        name: '🏅 Ranks & Titles',
        value: ranksText,
        inline: true,
      },
      {
        name: '📈 Level Bonuses',
        value: `> Every **10 levels**, you earn permanent stat boosts:\n> \n> ∑ **Bank Interest**: **+${(bonusPer10.interestRate * 100).toFixed(2)}%** per 10 levels\n> ↩ **Loss Cashback**: **+${(bonusPer10.cashbackRate * 100).toFixed(3)}%** per 10 levels\n> ∀× **Income Double Chance**: **+${(bonusPer10.universalDoubleChance * 100).toFixed(1)}%** per 10 levels\n> \n> These bonuses stack with upgrades and collectible bonuses.`,
        inline: true,
      },
      { name: '\u200b', value: '\u200b', inline: false },
      {
        name: '🔄 How Stats & Boosts Stack',
        value: '> Your **effective rate** for each stat = base + upgrade levels + XP bonuses + collectible bonuses + set completion bonuses.\n> \n> **Example — Bank Interest:**\n> Base rate + (upgrade level × per-level rate) + (XP milestone bonuses) + (collectible per-item bonuses) + (set completion bonus)\n> \n> All sources add together. Nothing multiplies — it\'s purely additive stacking.\n> \n> View your full breakdown: **/effects** for active buffs, **/bank** for interest breakdown, **/stats** → XP for level bonuses.',
        inline: false,
      },
    ],
  };
}

function buildNumberShorthandsPage() {
  return {
    title: PAGE_TITLES[5],
    color: 0x2b2d31,
    description: '> Large numbers get shortened automatically. The full value is always shown in parentheses when space allows.',
    fields: [
      {
        name: 'Display Format',
        value: '> Large numbers show as e.g. **1.34m (1,340,000)**.\n> 2 decimal places in the short form with the full number in parentheses.',
        inline: false,
      },
      {
        name: 'Suffixes',
        value: [
          '> **k**: Thousand (1,000)',
          '> **m**: Million (1,000,000)',
          '> **b**: Billion (1,000,000,000)',
          '> **t**: Trillion (1,000,000,000,000)',
          '> **qa**: Quadrillion (1,000,000,000,000,000)',
          '> **qi**: Quintillion (1,000,000,000,000,000,000)',
          '> **sx**: Sextillion (1,000,000,000,000,000,000,000)',
        ].join('\n'),
        inline: false,
      },
      { name: '\u200b', value: '\u200b', inline: false },
      {
        name: 'Input Examples',
        value: '> You can type these when entering amounts:\n> `100` `4.7k` `1.2m` `2b` `500t` `1qa` `all`\n> \n> Everything rounds down to the nearest whole coin.',
        inline: false,
      },
    ],
    footer: { text: 'Amount formats: 100 \u2027 4.7k \u2027 1.2m \u2027 2b \u2027 500t \u2027 1qa \u2027 all' },
  };
}

const PAGE_BUILDERS = [buildEconomyPage, buildGamesCommandsPage, buildModifiersPage, buildCollectiblesPage, buildXpRanksPage, buildNumberShorthandsPage];

function getNavRow(pageIndex) {
  const row = new ActionRowBuilder();
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(`help_prev_${pageIndex}`)
      .setLabel('Prev')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(pageIndex === 0),
    new ButtonBuilder()
      .setCustomId(`help_indicator_${pageIndex}`)
      .setLabel(`${pageIndex + 1} / ${TOTAL_PAGES}`)
      .setStyle(ButtonStyle.Primary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(`help_next_${pageIndex}`)
      .setLabel('Next')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(pageIndex === TOTAL_PAGES - 1),
  );
  return row;
}

function renderHelpPage(pageIndex) {
  const embed = PAGE_BUILDERS[pageIndex]();
  const components = [getNavRow(pageIndex)];
  return { embed, components };
}

async function handleHelp(interaction) {
  const { embed, components } = renderHelpPage(0);
  return interaction.reply({ content: '', embeds: [embed], components });
}

async function handleHelpButton(interaction) {
  const parts = interaction.customId.split('_');
  const direction = parts[1];
  const currentPage = parseInt(parts[2], 10);

  let targetPage = currentPage;
  if (direction === 'prev') targetPage = Math.max(0, currentPage - 1);
  if (direction === 'next') targetPage = Math.min(TOTAL_PAGES - 1, currentPage + 1);

  const { embed, components } = renderHelpPage(targetPage);
  return interaction.update({ content: '', embeds: [embed], components });
}

module.exports = { handleHelp, handleHelpButton };
