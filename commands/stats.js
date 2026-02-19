const { ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
const { CONFIG } = require('../config');
const store = require('../data/store');
const binomial = require('../utils/binomial');
const { renderChartToBuffer } = require('../utils/renderChart');

const STATS_DEFAULT_TIMEFRAME_KEY = CONFIG.stats.defaultTimeframeKey;
const STATS_TIMEFRAMES = CONFIG.stats.timeframes;

const GAMES = CONFIG.stats.games;
const THEORETICAL_WIN_CHANCE = CONFIG.stats.theoreticalWinChance;

function downsampleSeries(points, maxPoints = 180) {
  if (points.length <= maxPoints) return points;
  const step = Math.ceil(points.length / maxPoints);
  const sampled = [];
  for (let i = 0; i < points.length; i += step) sampled.push(points[i]);
  const last = points[points.length - 1];
  if (sampled[sampled.length - 1] !== last) sampled.push(last);
  return sampled;
}

function formatClock(ts) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}


function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function parseStatsCustomId(customId) {
  const parts = customId.split('_');
  if (parts.length < 4) return null;
  const page = parts[1] === 'tf' ? 'networth' : parts[1];
  const viewerId = parts[2];
  const targetId = parts[3];
  const timeframeKey = parts[4] || STATS_DEFAULT_TIMEFRAME_KEY;
  if (!page || !viewerId || !targetId) return null;
  return { page, viewerId, targetId, timeframeKey };
}

function getStatsTimeframeByKey(timeframeKey) {
  return STATS_TIMEFRAMES.find((entry) => entry.key === timeframeKey) || STATS_TIMEFRAMES.find((entry) => entry.key === STATS_DEFAULT_TIMEFRAME_KEY);
}

function getNavRow(viewerId, targetId, activePage, timeframeKey) {
  const pages = [
    { key: 'networth', label: 'Networth' },
    { key: 'winloss', label: 'Win Loss' },
    { key: 'binomial', label: 'Pity' },
    { key: 'bonuses', label: 'Bonuses' },
  ];

  const row = new ActionRowBuilder();
  for (const page of pages) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`stats_${page.key}_${viewerId}_${targetId}_${timeframeKey}`)
        .setLabel(page.label)
        .setStyle(page.key === activePage ? ButtonStyle.Primary : ButtonStyle.Secondary)
    );
  }
  return row;
}

function getTimeframeRows(viewerId, targetId, activeTimeframeKey) {
  const rows = [];
  for (let i = 0; i < STATS_TIMEFRAMES.length; i += 5) {
    const row = new ActionRowBuilder();
    for (const timeframe of STATS_TIMEFRAMES.slice(i, i + 5)) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`stats_tf_${viewerId}_${targetId}_${timeframe.key}`)
          .setLabel(timeframe.label)
          .setStyle(timeframe.key === activeTimeframeKey ? ButtonStyle.Success : ButtonStyle.Secondary)
      );
    }
    rows.push(row);
  }
  return rows;
}

function getStatsComponents(viewerId, targetId, activePage, timeframeKey) {
  const rows = [getNavRow(viewerId, targetId, activePage, timeframeKey)];
  if (activePage === 'networth') {
    rows.push(...getTimeframeRows(viewerId, targetId, timeframeKey));
  }
  return rows;
}

async function resolveTargetFromOptions(interaction) {
  const targetUser = interaction.options.getUser('user');

  let userId = interaction.user.id;
  let username = interaction.user.username;

  if (targetUser) {
    userId = targetUser.id;
    username = targetUser.username;
  }

  if (!store.hasWallet(userId)) {
    return null;
  }

  return { userId, username };
}

function renderOverview(username, wallet) {
  const stats = wallet.stats;
  const currentTotalBalance = (wallet.balance || 0) + (wallet.bank || 0);
  const totalGames = GAMES.reduce((sum, g) => sum + ((stats[g] || {}).wins || 0) + ((stats[g] || {}).losses || 0), 0);
  const totalWins = GAMES.reduce((sum, g) => sum + ((stats[g] || {}).wins || 0), 0);
  const overallWinRate = totalGames > 0 ? ((totalWins / totalGames) * 100).toFixed(1) : '0.0';
  const netProfit = (stats.lifetimeEarnings || 0) - (stats.lifetimeLosses || 0);

  const topGames = GAMES
    .map((game) => {
      const gs = stats[game] || { wins: 0, losses: 0 };
      const plays = gs.wins + gs.losses;
      return { game, plays, wins: gs.wins, losses: gs.losses };
    })
    .sort((a, b) => b.plays - a.plays)
    .slice(0, 3);

  let topGamesText = '';
  for (const item of topGames) {
    if (item.plays === 0) continue;
    const wr = ((item.wins / item.plays) * 100).toFixed(1);
    topGamesText += `> **${capitalize(item.game)}**: ${item.wins}W / ${item.losses}L (${wr}%)\n`;
  }
  if (!topGamesText) topGamesText = '> No game history yet\n';

  return {
    title: `📊 ${username}'s Stats`,
    color: 0x2b2d31,
    fields: [
      {
        name: '💰 Economy Snapshot',
        value: `> Purse: **${store.formatNumber(wallet.balance || 0)}**\n> Bank: **${store.formatNumber(wallet.bank || 0)}**\n> Net Worth: **${store.formatNumber(currentTotalBalance)}**`,
        inline: true,
      },
      {
        name: '📈 Lifetime Summary',
        value: `> Earnings: **${store.formatNumber(stats.lifetimeEarnings || 0)}**\n> Losses: **${store.formatNumber(stats.lifetimeLosses || 0)}**\n> Net: **${netProfit >= 0 ? '+' : ''}${store.formatNumber(netProfit)}**\n> Win Rate: **${overallWinRate}%** (${totalWins}/${totalGames})`,
        inline: true,
      },
      {
        name: '🎮 Most Played',
        value: topGamesText,
        inline: false,
      },
    ],
  };
}

function renderWinLossPage(username, wallet) {
  const stats = wallet.stats;
  const fields = [];

  for (const game of GAMES) {
    const gs = stats[game] || { wins: 0, losses: 0 };
    const plays = gs.wins + gs.losses;
    if (plays === 0) {
      fields.push({ name: capitalize(game), value: '> No plays yet', inline: true });
      continue;
    }

    const actual = (gs.wins / plays) * 100;
    const expected = THEORETICAL_WIN_CHANCE[game] == null ? null : (THEORETICAL_WIN_CHANCE[game] * 100);
    const deltaVal = expected == null ? null : actual - expected;
    const deltaIcon = deltaVal == null ? '' : (deltaVal >= 0 ? '🟢' : '🔴');
    const deltaText = deltaVal == null ? 'n/a' : `${deltaVal >= 0 ? '+' : ''}${deltaVal.toFixed(1)}%`;
    const expectedText = expected == null ? 'n/a' : `${expected.toFixed(1)}%`;

    fields.push({
      name: `${deltaIcon} ${capitalize(game)}`,
      value: `> **${gs.wins}**W / **${gs.losses}**L\n> Actual: **${actual.toFixed(1)}%**\n> Baseline: ${expectedText}\n> Delta: **${deltaText}**`,
      inline: true,
    });
  }

  return {
    title: `⚔️ ${username}'s Win/Loss`,
    color: 0x2b2d31,
    fields,
  };
}

function renderBinomialPage(username, userId, wallet) {
  const stats = wallet.stats;
  const totalGames = GAMES.reduce((sum, g) => sum + ((stats[g] || {}).wins || 0) + ((stats[g] || {}).losses || 0), 0);
  const totalWins = GAMES.reduce((sum, g) => sum + ((stats[g] || {}).wins || 0), 0);
  const bonuses = store.getUserBonuses(userId);
  const mb = wallet.stats.mysteryBox || {};
  const bonusStats = wallet.stats.bonuses || {};
  const binomialPity = bonuses.binomialPity || {};

  const fields = [];

  // Binomial luck analysis
  if (totalGames === 0) {
    fields.push({ name: '🎲 Binomial Luck Analysis', value: '> No game rounds recorded yet.', inline: false });
  } else {
    const luck = binomial.getLuckAssessment(totalWins, totalGames, 0.5);
    const resultText = luck.direction === 'neutral'
      ? 'Neutral'
      : `${capitalize(luck.direction)} (${luck.confidence.toFixed(2)}%)`;
    fields.push({
      name: '🎲 Binomial Luck Analysis',
      value: `> *50/50 baseline assumed*\n> Wins: **${totalWins}** / ${totalGames}\n> Expected: **${(luck.expectedWins || 0).toFixed(1)}**\n> Delta: **${luck.winRateDelta >= 0 ? '+' : ''}${luck.winRateDelta.toFixed(2)}%**\n> Result: **${resultText}**`,
      inline: false,
    });
  }

  // Luck and pity
  let pityBoostText;
  if (binomialPity.active) {
    const minsLeft = Math.max(0, Math.ceil((binomialPity.expiresInMs || 0) / 60000));
    pityBoostText = `🟢 **ACTIVE** (+${(binomialPity.boostRate * 100).toFixed(2)}%, ${minsLeft}m left, ${binomialPity.activeStacks || 0} stacks)`;
  } else {
    pityBoostText = '⚫ Inactive';
  }
  fields.push({
    name: '🍀 Luck & Pity',
    value: `> Box Luck: **${(bonuses.mysteryBoxLuck * 100).toFixed(2)}%**\n> Pity Streak: **${bonuses.pityStreak || 0}** (Best: ${mb.bestPityStreak || 0})\n> Pity Luck Bonus: **${(bonuses.pityLuckBonus * 100).toFixed(2)}%**\n> Boxes Opened: **${mb.opened || 0}**\n> Legendary+ Hits: **${mb.luckyHighRarity || 0}**`,
    inline: true,
  });

  fields.push({
    name: '📋 Pity Status',
    value: `> Boost: ${pityBoostText}\n> Last State: **${capitalize(binomialPity.lastDirection || 'neutral')}** (${(binomialPity.lastConfidence || 0).toFixed(2)}%)\n> Games Checked: ${binomialPity.lastTotalGames || 0}\n> Triggers: **${binomialPity.triggers || 0}**`,
    inline: true,
  });

  // Spacer
  fields.push({ name: '\u200b', value: '\u200b', inline: false });

  // EV and special effects
  const evPairs = Object.entries(bonuses.evBoostByGame || {}).filter(([, value]) => value > 0);
  const evGameText = evPairs.length > 0
    ? evPairs.map(([k, v]) => `${capitalize(k)} **+${(v * 100).toFixed(2)}%**`).join(', ')
    : 'None active';
  fields.push({
    name: '⚡ EV & Special Effects',
    value: `> EV Boost Profit: **${store.formatNumber(bonusStats.evBoostProfit || 0)}**\n> Per Trigger Stack: **+${(Number((bonuses.runtimeTuning || {}).binomialPityBoostRate || 0) * 100).toFixed(2)}%**\n> EV Boost by Game: ${evGameText}`,
    inline: false,
  });

  const footer = totalGames === 0 ? { text: 'Play more rounds to improve confidence calculations.' } : undefined;

  return {
    title: `🔮 ${username}'s Pity, Luck & EV`,
    color: 0x2b2d31,
    fields,
    ...(footer ? { footer } : {}),
  };
}

async function renderNetWorthPage(username, wallet, timeframeKey = STATS_DEFAULT_TIMEFRAME_KEY) {
  const history = Array.isArray(wallet.stats.netWorthHistory) ? wallet.stats.netWorthHistory : [];
  const timeframe = getStatsTimeframeByKey(timeframeKey);

  if (history.length < 2) {
    return {
      content: '',
      embeds: [{
        title: `📈 ${username}'s Networth`,
        color: 0x2b2d31,
        description: 'Not enough history yet. Keep playing and this chart will fill in automatically.',
      }],
    };
  }

  const now = Date.now();
  const filteredHistory = timeframe.seconds === null
    ? history
    : history.filter((point) => (point?.t || 0) >= (now - timeframe.seconds * 1000));

  if (filteredHistory.length < 2) {
    return {
      content: '',
      embeds: [{
        title: `📈 ${username}'s Networth`,
        color: 0x2b2d31,
        description: `Not enough history in the last ${timeframe.label} yet. Keep playing and this chart will fill in automatically.`,
      }],
    };
  }

  const trimmed = downsampleSeries(filteredHistory, 240);
  const values = trimmed.map((x) => x.v || 0);
  const first = values[0];
  const last = values[values.length - 1];
  const low = Math.min(...values);
  const high = Math.max(...values);
  const delta = last - first;

  const tickEvery = Math.max(1, Math.floor(trimmed.length / 8));
  const labels = trimmed.map((point, i) => (i % tickEvery === 0 || i === trimmed.length - 1) ? formatClock(point.t || now) : '');

  const chartConfig = {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: `${username} Net Worth`,
        data: values,
        borderColor: '#36a2eb',
        backgroundColor: '#36a2eb',
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.22,
        fill: false,
      }],
    },
    options: {
      plugins: {
        legend: { display: false },
        title: { display: true, text: `Player Networth (${timeframe.label})`, color: '#ffffff' },
      },
      scales: {
        x: { ticks: { color: '#d9d9d9', maxTicksLimit: 8 }, grid: { color: 'rgba(255,255,255,0.08)' } },
        y: { ticks: { color: '#d9d9d9' }, grid: { color: 'rgba(255,255,255,0.08)' } },
      },
      layout: { padding: 8 },
    },
  };
  const chartBuffer = await renderChartToBuffer(chartConfig, 980, 420).catch(() => null);

  const changeIcon = delta >= 0 ? '📈' : '📉';
  const networthEmbed = {
    title: `${changeIcon} ${username}'s Networth`,
    color: 0x2b2d31,
    fields: [
      {
        name: '💰 Current Balance',
        value: `> Purse: **${store.formatNumber(wallet.balance || 0)}**\n> Bank: **${store.formatNumber(wallet.bank || 0)}**\n> Net Worth: **${store.formatNumber((wallet.balance || 0) + (wallet.bank || 0))}**`,
        inline: true,
      },
      {
        name: `📊 ${timeframe.label} Overview`,
        value: `> Start: **${store.formatNumber(first)}**\n> Current: **${store.formatNumber(last)}**\n> Change: **${delta >= 0 ? '+' : ''}${store.formatNumber(delta)}**\n> Range: ${store.formatNumber(low)} - ${store.formatNumber(high)}\n> Samples: ${values.length}`,
        inline: true,
      },
    ],
  };

  const result = { content: '', embeds: [networthEmbed] };
  if (chartBuffer) {
    networthEmbed.image = { url: 'attachment://networth.png' };
    result.files = [new AttachmentBuilder(chartBuffer, { name: 'networth.png' })];
  }
  return result;
}

function renderBonusesPage(username, userId, wallet) {
  const bonuses = store.getUserBonuses(userId);

  let inventoryText = '';
  if (!bonuses.inventoryEffects.length) {
    inventoryText = '> No item effects active yet';
  } else {
    inventoryText = bonuses.inventoryEffects.map((line) => `> ${line}`).join('\n');
  }

  return {
    title: `🎁 ${username}'s Bonuses`,
    color: 0x2b2d31,
    fields: [
      {
        name: '⬆️ Upgrade Totals',
        value: `> Bank Interest: **${(bonuses.interestRate * 100).toFixed(2)}%**/day\n> Cashback: **${(bonuses.cashbackRate * 100).toFixed(2)}%**\n> Spin Payout Mult: **${bonuses.spinWeight.toFixed(1)}x**\n> Double Chance: **${(bonuses.universalIncomeDoubleChance * 100).toFixed(2)}%**`,
        inline: true,
      },
      {
        name: '🛡️ Other Modifiers',
        value: `> Mines Save: **${(bonuses.minesRevealChance * 100).toFixed(2)}%**\n> Box Luck (items): **${(bonuses.inventoryLuckBonus * 100).toFixed(2)}%**`,
        inline: true,
      },
      {
        name: '🎒 Inventory Effects',
        value: inventoryText,
        inline: false,
      },
    ],
  };
}

async function renderPage(page, username, userId, wallet, timeframeKey = STATS_DEFAULT_TIMEFRAME_KEY) {
  switch (page) {
    case 'winloss':
      return { content: '', embeds: [renderWinLossPage(username, wallet)] };
    case 'binomial':
      return { content: '', embeds: [renderBinomialPage(username, userId, wallet)] };
    case 'networth':
      return renderNetWorthPage(username, wallet, timeframeKey);
    case 'bonuses':
      return { content: '', embeds: [renderBonusesPage(username, userId, wallet)] };
    case 'overview':
    default:
      return renderNetWorthPage(username, wallet, timeframeKey);
  }
}

async function handleStats(interaction) {
  const target = await resolveTargetFromOptions(interaction);

  if (!target) {
    const usernameQuery = interaction.options.getString('username');
    const fallbackName = usernameQuery ? usernameQuery : 'that user';
    return interaction.reply(`No stats found for **${fallbackName}**.`);
  }

  const wallet = store.getWallet(target.userId);
  const rendered = await renderPage('networth', target.username, target.userId, wallet, STATS_DEFAULT_TIMEFRAME_KEY);
  const components = getStatsComponents(interaction.user.id, target.userId, 'networth', STATS_DEFAULT_TIMEFRAME_KEY);
  return interaction.reply({ content: rendered.content, embeds: rendered.embeds, files: rendered.files || [], components });
}

async function handleStatsButton(interaction) {
  const parsed = parseStatsCustomId(interaction.customId);
  if (!parsed) return;

  if (interaction.user.id !== parsed.viewerId) {
    return interaction.reply({ content: 'Open your own /stats panel to interact with buttons.', ephemeral: true });
  }

  if (!store.hasWallet(parsed.targetId)) {
    return interaction.update({ content: 'Stats no longer available for this user.', components: [] });
  }

  const user = await interaction.client.users.fetch(parsed.targetId).catch(() => null);
  const username = user ? user.username : 'Unknown';
  const wallet = store.getWallet(parsed.targetId);
  const page = parsed.page;
  const timeframeKey = getStatsTimeframeByKey(parsed.timeframeKey).key;
  const rendered = await renderPage(page, username, parsed.targetId, wallet, timeframeKey);
  const components = getStatsComponents(parsed.viewerId, parsed.targetId, page, timeframeKey);
  return interaction.update({ content: rendered.content, embeds: rendered.embeds, files: rendered.files || [], components });
}

module.exports = { handleStats, handleStatsButton };
