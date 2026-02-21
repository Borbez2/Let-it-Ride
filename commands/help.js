const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { CONFIG, MYSTERY_BOX_POOLS, RARITIES } = require('../config');
const store = require('../data/store');

const PAGE_TITLES = [
  '\u25c8 Economy Overview',
  '\u25c8 Games & Commands',
  '\u25c8 Effects & Modifiers',
  '\u25c8 Collectibles & Boxes',
];

const TOTAL_PAGES = PAGE_TITLES.length;

function buildEconomyPage() {
  const taxPct = (CONFIG.economy.pools.universalTaxRate * 100).toFixed(0);
  const lossPct = (CONFIG.economy.pools.lossTaxRate * 100).toFixed(0);

  return {
    title: PAGE_TITLES[0],
    color: 0x2b2d31,
    description: '> A quick rundown of how the economy works, how to earn, and what you can spend on.',
    fields: [
      {
        name: '◈ Money',
        value: '> Your **Purse** holds coins you can freely spend on bets, trades, and mystery boxes. Your **Bank** is a safe place where coins sit and grow over time with hourly interest payouts. You can move coins between the two with `/deposit` and `/withdraw`.',
        inline: false,
      },
      {
        name: '◈ Earning Coins',
        value: `> Use **/daily** every day to collect free coins and build up a streak bonus. When you win a game, **${taxPct}%** of your profit is taxed and goes into the **Universal Pool**, which gets split between all players every hour (paid to your bank). When you lose, **${lossPct}%** of your loss goes into the **Spin Pool**, and one lucky player wins the whole pot each day at 11:15pm.`,
        inline: false,
      },
      { name: '\u200b', value: '\u200b', inline: false },
      {
        name: '◈ Shop — /shop',
        value: '> **/shop** has three sections:\n> \n> **⧉ Upgrades** — Permanently improve your passive stats:\n> ∑ **Bank Interest** · ↩ **Cashback** · ⟳× **Daily Spin Mult** · ∀× **Universal Income Mult**\n> \n> **Potions** — Temporary effects for 1 hour:\n> ☘⚱ **Lucky Pot** (100k) — boosts your win chance by +5% for 1 hour (1 active at a time)\n> ⚱✕ **Unlucky Pot** (200k) — reduces a target player\'s win chance by -25%\n> \n> **🎁 Mystery Boxes** — Buy boxes to get collectible items. Collectibles passively boost your stats: ∑ interest, ↩ cashback, ☘ luck, ⟳× spin weight, ∀× income chance, and ⛁⌖ mines save. Use **/shop** to buy (Mystery Boxes section), **/inventory** to manage.',
        inline: false,
      },
      {
        name: '⧉ Collectibles',
        value: '> Collectibles from mystery boxes come with **passive stat bonuses** applied automatically to your account. Higher-rarity items give larger bonuses. If you collect every item of a rarity tier, you get an additional **set completion bonus** on top.\n> \n> Possible buffs: ∑ interest · ↩ cashback · ☘ luck (pity) · ⛁⌖ mines save · ⟳× spin weight · ∀× universal income chance\n> \n> Manage with **/inventory**, browse the server with **/collection**, or swap with **/trade**.',
        inline: false,
      },
    ],
  };
}

function buildGamesCommandsPage() {
  return {
    title: PAGE_TITLES[1],
    color: 0x2b2d31,
    description: '> Every game, how it works, and what your expected edge looks like.',
    fields: [
      {
        name: '\u2726 Games',
        value: '> **Flip** \u2023 Classic coin flip. Pure 50/50, EV is roughly zero before cashback kicks in.\n'
          + '> **Roulette** \u2023 Red or black gives you an EV of **-2.70%** (house edge from the 0). Betting green 0 straight up is a big gamble at **-62.16%** EV.\n'
          + '> **All-In 17 Black** \u2023 Straight-up bet on a single number, similar house edge to roulette.\n'
          + '> **Blackjack** \u2023 Your edge depends entirely on how you play. No fixed EV here.\n'
          + '> **Mines** \u2023 Reveal tiles on a grid and cash out whenever. Your multiplier grows with each safe reveal, but one mine ends it all.\n'
          + '> **Let It Ride** \u2023 Double or bust, over and over. Each step is 50/50, so it\'s all about when you walk away.\n'
          + '> **Duel** \u2023 Challenge another player. Equal stakes go in, one random winner takes it all.',
        inline: false,
      },
      { name: '\u200b', value: '\u200b', inline: false },
      {
        name: '\u25B8 Money Commands',
        value: '> `/balance` `/daily` `/bank` `/pool`\n> `/deposit` `/invest` `/withdraw`\n> `/shop`',
        inline: true,
      },
      {
        name: '\u25B8 Game Commands',
        value: '> `/flip` `/roulette` `/allin17black`\n> `/blackjack` `/mines` `/letitride`\n> `/duel`',
        inline: true,
      },
      { name: '\u200b', value: '\u200b', inline: false },
      {
        name: '\u25B8 Social & Economy',
        value: '> `/give` `/trade` `/leaderboard`\n> `/stats` `/effects` `/giveaway`',
        inline: true,
      },
      {
        name: '\u25B8 Collectibles',
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
    description: '> The game does its base math first, then your effects get layered on top. Nothing here forces you to win \u2014 it just shifts the numbers in your favor. Check all your active values under **/effects**.',
    fields: [
      {
        name: '◈ All Effects',
        value: '> ☘ **Luck** ‧ Scaling win-chance buff built from a losing streak (Flip, Duel, Let It Ride) — stacks with Lucky Pot\n> ∑ **Bank Interest** ‧ Passive hourly interest on bank balance (tiered rate, see /bank)\n> ↩ **Cashback** ‧ Refunds a % of every loss\n> ⟳× **Daily Spin Mult** ‧ Multiplies your daily spin winnings if you\'re picked\n> ∀× **Universal Income Mult** ‧ Chance to double your hourly universal pool payout\n> ⛁⌖ **Mines Save** ‧ Chance to auto-reveal a safe tile in Mines\n> \n> **Upgradeable in /shop:** ∑ Interest · ↩ Cashback · ⟳× Spin Mult · ∀× Income Mult\n> **From collectibles:** all of the above, plus ☘ Luck and ⛁⌖ Mines Save',
        inline: false,
      },
      { name: '\u200b', value: '\u200b', inline: false },
      {
        name: '☘ How Luck Works',
        value: '> Lose **3 games in a row** (Flip, Duel, or Let It Ride only) to activate a luck buff. Each additional loss raises the buff:\n> \n> **Streak 3\u20137:** +0.5% win chance per loss (3 losses = 0.5%, 7 losses = 2.5%)\n> **Streak 8\u201312:** +1% win chance per loss (8 losses = 3.5%, 12 losses = 7.5%)\n> \n> The buff **boosts your win chance** (stacks with Lucky Pot). It lasts **5 minutes**. Only the highest boost applies \u2014 a new trigger at a lower streak won\'t overwrite a higher one still active.\n> Winning resets your loss streak, but any active buff keeps running until it expires.',
        inline: false,
      },
      {
        name: '∑ How Bank Interest Works',
        value: '> Interest is calculated in **tiered slabs** (like tax brackets). Your full rate **r** applies to the first 1M in your bank; higher balances earn at a reduced rate:\n> \n> **Slab 1** (0 \u2192 1M): rate = r\n> **Slab 2** (1M \u2192 10M): rate = r \u00d7 0.1\n> **Slab 3** (above 10M): rate = r \u00d7 0.01\n> \n> Your rate **r** is determined by your base rate + upgrade levels + collectible bonuses. See the full daily breakdown in `/bank` \u2192 \u2211 Breakdown.',
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
    // Use enough decimal places so tiny rarities never round to 0.0%
    const dec = rawPct >= 1 ? 1 : rawPct >= 0.1 ? 2 : rawPct >= 0.01 ? 3 : 4;
    const pct = rawPct.toFixed(dec);
    const icon = RARITIES[rarity]?.emoji || '\u25B8';
    const label = rarity.charAt(0).toUpperCase() + rarity.slice(1);
    dropText += `> ${icon} ${label} \u2236 **${pct}%** (${pool.items.length} items)\n`;
  }

  let compText = '';
  for (const rarity of rarityOrder) {
    const amount = compensationTable[rarity];
    if (!amount) continue;
    const icon = RARITIES[rarity]?.emoji || '\u25B8';
    const label = rarity.charAt(0).toUpperCase() + rarity.slice(1);
    compText += `> ${icon} ${label} \u2236 **${store.formatNumber(amount)}**\n`;
  }
  if (!compText) compText = '> None configured';

  return {
    title: PAGE_TITLES[3],
    color: 0x2b2d31,
    description: '> Everything about mystery boxes, collectibles, drop rates, and passive bonuses.',
    fields: [
      {
        name: '\u25C8 Mystery Boxes',
        value: `> Buy mystery boxes through **/shop** (Mystery Boxes section). Each box costs **${store.formatNumber(CONFIG.collectibles.mysteryBox.cost)}** coins. There are 120 collectibles spread across 7 rarities. Your drop luck is based on your item luck bonus plus any pity luck you\'ve built up.`,
        inline: false,
      },
      {
        name: '\u25CE Base Drop Weights',
        value: dropText,
        inline: true,
      },
      {
        name: '\u21BB Cashback per Dupe',
        value: compText,
        inline: true,
      },
      { name: '\u200b', value: '\u200b', inline: false },
      {
        name: '\u29C9 Collectible Buffs',
        value: '> Every collectible item you own passively applies bonuses to your account. The higher the rarity, the larger the effect per item:\n> \n> \u2211 **Bank Interest** \u00b7 \u21a9 **Cashback** \u00b7 \u2618 **Luck** \u00b7 \u27f3\u00d7 **Spin Weight** \u00b7 \u2200\u00d7 **Universal Income Chance** \u00b7 \u26c1\u2316 **Mines Save**\n> \n> Collecting **every item of a rarity tier** also awards a **set completion bonus** on top. Duplicate items are automatically converted to coins — the amount depends on the item\'s rarity (see **Cashback per Dupe** above).\n> \n> Manage with **/inventory**, browse with **/collection**, swap with **/trade**.',
        inline: false,
      },
    ],
  };
}

const PAGE_BUILDERS = [buildEconomyPage, buildGamesCommandsPage, buildModifiersPage, buildCollectiblesPage];

function getNavRow(pageIndex) {
  const row = new ActionRowBuilder();
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(`help_prev_${pageIndex}`)
      .setLabel('\u25C2 Prev')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(pageIndex === 0),
    new ButtonBuilder()
      .setCustomId(`help_indicator_${pageIndex}`)
      .setLabel(`${pageIndex + 1} of ${TOTAL_PAGES}`)
      .setStyle(ButtonStyle.Primary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(`help_next_${pageIndex}`)
      .setLabel('Next \u25B8')
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
