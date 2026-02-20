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
        name: '\u25C8 Money',
        value: '> Your **Purse** holds coins you can freely spend on bets, trades, and mystery boxes. Your **Bank** is a safe place where coins sit and grow over time with hourly interest payouts. You can move coins between the two with `/deposit` and `/withdraw`.',
        inline: false,
      },
      {
        name: '\u25C8 Earning Coins',
        value: `> Use **/daily** every day to collect free coins and build up a streak bonus. When you win a game, **${taxPct}%** of your profit is taxed and goes into the **Universal Pool**, which gets split between all players every hour (paid to your bank). When you lose, **${lossPct}%** of your loss goes into the **Spin Pool**, and one lucky player wins the whole pot each day at 11:15pm.`,
        inline: false,
      },
      { name: '\u200b', value: '\u200b', inline: false },
      {
        name: '\u2B99 Upgrades',
        value: '> Head to **/upgrades** to spend coins on permanent boosts.\n> \u00A4 **Interest** raises your daily bank rate (+1%/level, caps at 10%)\n> \u21A9 **Cashback** refunds a small % of every loss\n> \u229B **Spin Mult** multiplies your daily spin winnings if you get picked\n> \u2295 **Income Mult** gives you a chance to double your hourly universal payout',
        inline: false,
      },
      {
        name: '\u29C9 Collectibles',
        value: '> Buy **/mysterybox** to get randomized collectible items. Some of them come with passive bonuses like \u00A4 interest, \u21A9 cashback, \u2618 luck, \u25C8 mines-save, or \u21AF EV boosts. Manage your stuff with **/inventory**, check the community with **/collection**, or swap items with **/trade**.',
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
        value: '> `/balance` `/daily` `/bank` `/pool`\n> `/deposit` `/invest` `/withdraw`\n> `/upgrades`',
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
        value: '> `/give` `/trade` `/leaderboard`\n> `/stats` `/pity` `/giveaway`',
        inline: true,
      },
      {
        name: '\u25B8 Collectibles',
        value: '> `/mysterybox` `/inventory`\n> `/collection`',
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
    description: '> The game does its base math first, then your effects get layered on top. Nothing here forces you to win, it just shifts the numbers in your favor. See all your active effects under **/stats** \u2192 Effects.',
    fields: [
      {
        name: '\u2726 Active Effects',
        value: '> \u2618 **Luck** \u2027 Stacking cashback on losses during a losing streak\n> \u00A4 **Bank Interest** \u2027 Passive daily interest on your bank balance\n> \u21A9 **Cashback** \u2027 Refunds a % of every loss\n> \u229B **Spin Multiplier** \u2027 Multiplies daily spin winnings\n> \u2295 **Income Multiplier** \u2027 Chance to double hourly universal payout\n> \u25C8 **Mines Save** \u2027 Chance to auto-reveal a safe tile in Mines\n> \u21AF **EV Boost** \u2027 Per-game profit boost from items',
        inline: false,
      },
      { name: '\u200b', value: '\u200b', inline: false },
      {
        name: '\u2618 How Luck Works',
        value: '> When you lose **5 games in a row**, you gain your first luck stack. Every **3 additional consecutive losses** adds another stack, up to a maximum of **10 stacks**.\n> \n> Each stack gives you **+0.5% cashback** on all losses. At max stacks (10), that\'s **+5.0% cashback** on top of your regular cashback. Stacks last **15 minutes** each.',
        inline: false,
      },
      {
        name: '\u2618 Luck Details',
        value: '> Winning a game resets your loss streak counter, but any active stacks keep running until they expire. This means you keep the cashback bonus even after you start winning again.\n> \n> Check your live luck status with **/pity** or see your full breakdown under **/stats** \u2192 Effects.',
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
    const pct = ((pool.weight / totalWeight) * 100).toFixed(1);
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
    description: '> Everything about mystery boxes, drop rates, and what happens when you pull a duplicate.',
    fields: [
      {
        name: '\u25C8 Mystery Boxes',
        value: `> Use **/mysterybox** (optionally with \`quantity:1-50\`) to buy boxes from your **purse**. Each box costs **${store.formatNumber(CONFIG.collectibles.mysteryBox.cost)}** coins. There are 120 collectibles spread across 7 rarities. Your drop luck is based on your item luck bonus plus any pity luck you\'ve built up.`,
        inline: false,
      },
      {
        name: '\u25CE Base Drop Weights',
        value: dropText,
        inline: true,
      },
      {
        name: '\u21BB Duplicate Compensation',
        value: compText,
        inline: true,
      },
      { name: '\u200b', value: '\u200b', inline: false },
      {
        name: '\u25C8 Item Effects',
        value: '> Items can roll with passive bonuses:\n> \u00A4 Interest  \u2027  \u21A9 Cashback  \u2027  \u2618 Luck\n> \u25C8 Mines-save  \u2027  \u21AF EV boost (per game)\n> Most placeholders don\'t have effects assigned yet, but the ones that do are applied automatically.\n> \n> See what\'s active under **/stats** \u2192 Effects. Manage with **/inventory**, **/collection**, **/trade**.',
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
