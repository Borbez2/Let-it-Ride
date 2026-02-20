const { ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder, StringSelectMenuBuilder } = require('discord.js');
const { CONFIG } = require('../config');
const store = require('../data/store');
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
    { key: 'topbets', label: 'Top Bets' },
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

function getTimeframeRow(viewerId, targetId, activeTimeframeKey) {
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`stats_tf_${viewerId}_${targetId}`)
    .setPlaceholder('Select timeframe')
    .addOptions(STATS_TIMEFRAMES.map(tf => ({
      label: tf.label,
      value: tf.key,
      default: tf.key === activeTimeframeKey,
    })));
  return new ActionRowBuilder().addComponents(menu);
}

function getStatsComponents(viewerId, targetId, activePage, timeframeKey) {
  const rows = [getNavRow(viewerId, targetId, activePage, timeframeKey)];
  if (activePage === 'networth') {
    rows.push(getTimeframeRow(viewerId, targetId, timeframeKey));
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
    title: `◈ ${username}'s Stats`,
    color: 0x2b2d31,
    fields: [
      {
        name: '◉ Economy Snapshot',
        value: `> Purse: **${store.formatNumber(wallet.balance || 0)}**\n> Bank: **${store.formatNumber(wallet.bank || 0)}**\n> Net Worth: **${store.formatNumber(currentTotalBalance)}**`,
        inline: true,
      },
      {
        name: '▲ Lifetime Summary',
        value: `> Earnings: **${store.formatNumber(stats.lifetimeEarnings || 0)}**\n> Losses: **${store.formatNumber(stats.lifetimeLosses || 0)}**\n> Net: **${netProfit >= 0 ? '+' : ''}${store.formatNumber(netProfit)}**\n> Win Rate: **${overallWinRate}%** (${totalWins}/${totalGames})`,
        inline: true,
      },
      {
        name: '▸ Most Played',
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
    const deltaIcon = deltaVal == null ? '' : (deltaVal >= 0 ? '▲' : '▼');
    const deltaText = deltaVal == null ? 'n/a' : `${deltaVal >= 0 ? '+' : ''}${deltaVal.toFixed(1)}%`;
    const expectedText = expected == null ? 'n/a' : `${expected.toFixed(1)}%`;

    fields.push({
      name: `${deltaIcon} ${capitalize(game)}`,
      value: `> **${gs.wins}**W / **${gs.losses}**L\n> Actual: **${actual.toFixed(1)}%**\n> Baseline: ${expectedText}\n> Δ **${deltaText}**`,
      inline: true,
    });
  }

  return {
    title: `⚔ ${username}'s Win/Loss`,
    color: 0x2b2d31,
    fields,
  };
}

async function renderNetWorthPage(username, wallet, timeframeKey = STATS_DEFAULT_TIMEFRAME_KEY) {
  const history = Array.isArray(wallet.stats.netWorthHistory) ? wallet.stats.netWorthHistory : [];
  const timeframe = getStatsTimeframeByKey(timeframeKey);

  if (history.length < 2) {
    return {
      content: '',
      embeds: [{
        title: `▲ ${username}'s Networth`,
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
        title: `▲ ${username}'s Networth`,
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

  const changeIcon = delta >= 0 ? '▲' : '▼';
  const networthEmbed = {
    title: `${changeIcon} ${username}'s Networth`,
    color: 0x2b2d31,
    fields: [
      {
        name: '◉ Current Balance',
        value: `> Purse: **${store.formatNumber(wallet.balance || 0)}**\n> Bank: **${store.formatNumber(wallet.bank || 0)}**\n> Net Worth: **${store.formatNumber((wallet.balance || 0) + (wallet.bank || 0))}**`,
        inline: true,
      },
      {
        name: `◈ ${timeframe.label} Overview`,
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



function renderTopBetsPage(username, wallet) {
  const stats = wallet.stats;
  const topWins = Array.isArray(stats.topWins) ? stats.topWins : [];
  const topLosses = Array.isArray(stats.topLosses) ? stats.topLosses : [];

  let winsText = '';
  for (let i = 0; i < topWins.length; i++) {
    const entry = topWins[i];
    const timeStr = entry.t ? `<t:${Math.floor(entry.t / 1000)}:R>` : '';
    winsText += `> **${i + 1}.** ${capitalize(entry.game)} — **+${store.formatNumber(entry.amount)}** ${timeStr}\n`;
  }
  if (!winsText) winsText = '> No wins recorded yet\n';

  let lossesText = '';
  for (let i = 0; i < topLosses.length; i++) {
    const entry = topLosses[i];
    const timeStr = entry.t ? `<t:${Math.floor(entry.t / 1000)}:R>` : '';
    lossesText += `> **${i + 1}.** ${capitalize(entry.game)} — **-${store.formatNumber(entry.amount)}** ${timeStr}\n`;
  }
  if (!lossesText) lossesText = '> No losses recorded yet\n';

  return {
    title: `🏆 ${username}'s Top Bets`,
    color: 0x2b2d31,
    fields: [
      { name: '▲ Biggest Wins', value: winsText, inline: false },
      { name: '▼ Biggest Losses', value: lossesText, inline: false },
    ],
  };
}


async function renderPage(page, username, userId, wallet, timeframeKey = STATS_DEFAULT_TIMEFRAME_KEY) {
  switch (page) {
    case 'winloss':
      return { content: '', embeds: [renderWinLossPage(username, wallet)] };
    case 'topbets':
      return { content: '', embeds: [renderTopBetsPage(username, wallet)] };
    case 'networth':
      return renderNetWorthPage(username, wallet, timeframeKey);
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

async function handleStatsSelectMenu(interaction) {
  if (!interaction.customId.startsWith('stats_tf_')) return;

  const parts = interaction.customId.split('_');
  // Format: stats_tf_viewerId_targetId
  const viewerId = parts[2];
  const targetId = parts[3];

  if (interaction.user.id !== viewerId) {
    return interaction.reply({ content: 'Open your own /stats panel to interact.', ephemeral: true });
  }

  if (!store.hasWallet(targetId)) {
    return interaction.update({ content: 'Stats no longer available for this user.', components: [] });
  }

  const timeframeKey = interaction.values[0];
  const user = await interaction.client.users.fetch(targetId).catch(() => null);
  const username = user ? user.username : 'Unknown';
  const wallet = store.getWallet(targetId);
  const validTimeframeKey = getStatsTimeframeByKey(timeframeKey).key;
  const rendered = await renderPage('networth', username, targetId, wallet, validTimeframeKey);
  const components = getStatsComponents(viewerId, targetId, 'networth', validTimeframeKey);
  return interaction.update({ content: rendered.content, embeds: rendered.embeds, files: rendered.files || [], components });
}

module.exports = { handleStats, handleStatsButton, handleStatsSelectMenu };
