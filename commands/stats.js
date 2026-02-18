const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const store = require('../data/store');
const binomial = require('../utils/binomial');

const GAMES = ['flip', 'dice', 'roulette', 'blackjack', 'mines', 'letitride', 'duel'];
const THEORETICAL_WIN_CHANCE = {
  flip: 0.5,
  dice: 0.5,
  roulette: 18 / 37,
  blackjack: 0.48,
  mines: null,
  letitride: 0.5,
  duel: 0.5,
};

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

async function createQuickChartUrl(chartConfig, width = 980, height = 420) {
  const directChartUrl = `https://quickchart.io/chart?width=${width}&height=${height}&devicePixelRatio=1.5&backgroundColor=%231f1f1f&c=${encodeURIComponent(JSON.stringify(chartConfig))}`;
  if (directChartUrl.length <= 2000) return directChartUrl;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    const resp = await fetch('https://quickchart.io/chart/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        width,
        height,
        devicePixelRatio: 1.5,
        backgroundColor: '#1f1f1f',
        chart: chartConfig,
        format: 'png',
      }),
    });
    clearTimeout(timeout);
    if (!resp.ok) return null;
    const body = await resp.json().catch(() => null);
    if (!body || typeof body.url !== 'string') return null;
    return body.url;
  } catch {
    return null;
  }
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function parseStatsCustomId(customId) {
  const parts = customId.split('_');
  if (parts.length < 4) return null;
  const page = parts[1];
  const viewerId = parts[2];
  const targetId = parts[3];
  if (!page || !viewerId || !targetId) return null;
  return { page, viewerId, targetId };
}

function getNavRow(viewerId, targetId, activePage) {
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
        .setCustomId(`stats_${page.key}_${viewerId}_${targetId}`)
        .setLabel(page.label)
        .setStyle(page.key === activePage ? ButtonStyle.Primary : ButtonStyle.Secondary)
    );
  }
  return [row];
}

async function resolveTargetFromOptions(interaction) {
  const targetUser = interaction.options.getUser('user');
  const targetUsername = interaction.options.getString('username');

  let userId = interaction.user.id;
  let username = interaction.user.username;

  if (targetUser) {
    userId = targetUser.id;
    username = targetUser.username;
  } else if (targetUsername) {
    const lookup = targetUsername.trim().toLowerCase();
    const wallets = store.getAllWallets();
    const ids = Object.keys(wallets);

    for (const id of ids) {
      const u = await interaction.client.users.fetch(id).catch(() => null);
      if (u && u.username.toLowerCase() === lookup) {
        userId = u.id;
        username = u.username;
        break;
      }
    }
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

  let text = `**Stats Dashboard: ${username}**\n\n`;
  text += `**Economy Snapshot**\n`;
  text += `• Purse: ${store.formatNumber(wallet.balance || 0)}\n`;
  text += `• Bank: ${store.formatNumber(wallet.bank || 0)}\n`;
  text += `• Total Net Worth: ${store.formatNumber(currentTotalBalance)}\n\n`;

  text += `**Lifetime Summary**\n`;
  text += `• Total Earnings: ${store.formatNumber(stats.lifetimeEarnings || 0)}\n`;
  text += `• Total Losses: ${store.formatNumber(stats.lifetimeLosses || 0)}\n`;
  text += `• Net: ${netProfit >= 0 ? '+' : ''}${store.formatNumber(netProfit)}\n`;
  text += `• Overall Win Rate: ${overallWinRate}% (${totalWins}/${totalGames})\n\n`;

  const topGames = GAMES
    .map((game) => {
      const gs = stats[game] || { wins: 0, losses: 0 };
      const plays = gs.wins + gs.losses;
      return { game, plays, wins: gs.wins, losses: gs.losses };
    })
    .sort((a, b) => b.plays - a.plays)
    .slice(0, 3);

  text += `**Most Played Games**\n`;
  for (const item of topGames) {
    if (item.plays === 0) continue;
    const wr = ((item.wins / item.plays) * 100).toFixed(1);
    text += `• ${capitalize(item.game)}: ${item.wins}W ${item.losses}L (${wr}% win rate)\n`;
  }
  if (topGames.every((g) => g.plays === 0)) {
    text += `• No game history yet\n`;
  }

  return text;
}

function renderWinLossPage(username, wallet) {
  const stats = wallet.stats;
  let text = `**Win Loss Profile: ${username}**\n\n`;

  for (const game of GAMES) {
    const gs = stats[game] || { wins: 0, losses: 0 };
    const plays = gs.wins + gs.losses;
    if (plays === 0) {
      text += `• ${capitalize(game)}: No plays\n`;
      continue;
    }

    const actual = (gs.wins / plays) * 100;
    const expected = THEORETICAL_WIN_CHANCE[game] == null ? null : (THEORETICAL_WIN_CHANCE[game] * 100);
    const expectedText = expected == null ? 'n/a' : `${expected.toFixed(1)}%`;
    const deltaText = expected == null ? 'n/a' : `${(actual - expected) >= 0 ? '+' : ''}${(actual - expected).toFixed(1)}%`;

    text += `• ${capitalize(game)}: ${gs.wins}W ${gs.losses}L | Actual ${actual.toFixed(1)}% | Baseline ${expectedText} | Delta ${deltaText}\n`;
  }

  return text;
}

function renderBinomialPage(username, userId, wallet) {
  const stats = wallet.stats;
  const totalGames = GAMES.reduce((sum, g) => sum + ((stats[g] || {}).wins || 0) + ((stats[g] || {}).losses || 0), 0);
  const totalWins = GAMES.reduce((sum, g) => sum + ((stats[g] || {}).wins || 0), 0);
  const bonuses = store.getUserBonuses(userId);
  const mb = wallet.stats.mysteryBox || {};
  const bonusStats = wallet.stats.bonuses || {};
  const binomialPity = bonuses.binomialPity || {};

  let text = `**Pity, Luck, and EV: ${username}**\n\n`;
  if (totalGames === 0) {
    text += `No game rounds recorded yet.\n\n`;
  } else {
    const luck = binomial.getLuckAssessment(totalWins, totalGames, 0.5);
    text += `**Binomial Luck Analysis**\n`;
    text += `Assumption: 50/50 baseline across rounds\n`;
    text += `• Wins: ${totalWins}/${totalGames}\n`;
    text += `• Expected Wins: ${(luck.expectedWins || 0).toFixed(1)}\n`;
    text += `• Win Rate Delta: ${luck.winRateDelta >= 0 ? '+' : ''}${luck.winRateDelta.toFixed(2)}%\n`;
    if (luck.direction === 'neutral') {
      text += `• Result: Neutral\n\n`;
    } else {
      text += `• Result: ${capitalize(luck.direction)} (${luck.confidence.toFixed(2)}% probability of being this lucky/unlucky)\n\n`;
    }
  }

  text += `**Luck and Pity**\n`;
  text += `• Box Luck (items + pity): ${(bonuses.mysteryBoxLuck * 100).toFixed(2)}%\n`;
  text += `• Pity Streak: ${bonuses.pityStreak || 0}\n`;
  text += `• Pity Luck Bonus: ${(bonuses.pityLuckBonus * 100).toFixed(2)}%\n`;
  text += `• Boxes Opened: ${mb.opened || 0}\n`;
  text += `• High Rarity Hits (legendary+): ${mb.luckyHighRarity || 0}\n`;
  text += `• Best Pity Streak: ${mb.bestPityStreak || 0}\n`;
  if (binomialPity.active) {
    const minsLeft = Math.max(0, Math.ceil((binomialPity.expiresInMs || 0) / 60000));
    text += `• Pity Boost: ACTIVE (+${(binomialPity.boostRate * 100).toFixed(2)}% all games, ${minsLeft}m left, ${binomialPity.activeStacks || 0} stacks)\n`;
  } else {
    text += `• Pity Boost: inactive\n`;
  }
  text += `• Last Pity State: ${capitalize(binomialPity.lastDirection || 'neutral')} (${(binomialPity.lastConfidence || 0).toFixed(2)}%, ${binomialPity.lastTotalGames || 0} games)\n`;
  text += `• Pity Triggers: ${binomialPity.triggers || 0}\n\n`;

  text += `**EV and Special Effects**\n`;
  text += `• EV Boost Profit Earned: ${store.formatNumber(bonusStats.evBoostProfit || 0)}\n`;
  text += `• Pity Trigger Rule: unlucky thresholds at 60/70/80/90%, then +1% thresholds from 91% to 99%, applying only thresholds >= ${Number(binomialPity.thresholdConfidence || 97).toFixed(2)}%\n`;
  text += `• Per Trigger EV Stack: +${(Number((bonuses.runtimeTuning || {}).binomialPityBoostRate || 0) * 100).toFixed(2)}%\n`;
  const evPairs = Object.entries(bonuses.evBoostByGame || {}).filter(([, value]) => value > 0);
  if (evPairs.length > 0) {
    text += `• EV Boost by Game: ${evPairs.map(([k, v]) => `${capitalize(k)} +${(v * 100).toFixed(2)}%`).join(', ')}\n`;
  } else {
    text += `• EV Boost by Game: none active\n`;
  }

  if (totalGames === 0) {
    text += `\nPlay more rounds to improve confidence calculations.`;
  }

  return text;
}

async function renderNetWorthPage(username, wallet) {
  const history = Array.isArray(wallet.stats.netWorthHistory) ? wallet.stats.netWorthHistory : [];
  let text = `**Networth: ${username}**\n\n`;

  if (history.length < 2) {
    text += `Not enough history yet. Keep playing and this chart will fill in automatically.`;
    return { content: text, embeds: [] };
  }

  const now = Date.now();
  const trimmed = downsampleSeries(history, 240);
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
        title: { display: true, text: 'Player Networth', color: '#ffffff' },
      },
      scales: {
        x: { ticks: { color: '#d9d9d9', maxTicksLimit: 8 }, grid: { color: 'rgba(255,255,255,0.08)' } },
        y: { ticks: { color: '#d9d9d9' }, grid: { color: 'rgba(255,255,255,0.08)' } },
      },
      layout: { padding: 8 },
    },
  };
  const chartUrl = await createQuickChartUrl(chartConfig, 980, 420);

  text += `• Purse: ${store.formatNumber(wallet.balance || 0)}\n`;
  text += `• Bank: ${store.formatNumber(wallet.bank || 0)}\n`;
  text += `• Total Net Worth: ${store.formatNumber((wallet.balance || 0) + (wallet.bank || 0))}\n`;
  text += `• Samples: ${values.length}\n`;
  text += `• Start: ${store.formatNumber(first)}\n`;
  text += `• Current: ${store.formatNumber(last)}\n`;
  text += `• Change: ${delta >= 0 ? '+' : ''}${store.formatNumber(delta)}\n`;
  text += `• Range: ${store.formatNumber(low)} - ${store.formatNumber(high)}\n`;

  return {
    content: text,
    embeds: chartUrl ? [{ title: 'Player Networth', image: { url: chartUrl } }] : [],
  };
}

function renderBonusesPage(username, userId, wallet) {
  const bonuses = store.getUserBonuses(userId);
  let text = `**Bonuses and Modifiers: ${username}**\n\n`;

  text += `**Upgrade Totals**\n`;
  text += `• Bank Interest: ${(bonuses.interestRate * 100).toFixed(2)}%/day\n`;
  text += `• Cashback: ${(bonuses.cashbackRate * 100).toFixed(2)}%\n`;
  text += `• Daily Spin Weight: ${bonuses.spinWeight.toFixed(2)}x\n`;
  text += `• Universal Double Chance: ${(bonuses.universalIncomeDoubleChance * 100).toFixed(2)}%\n\n`;

  text += `**Other Modifiers**\n`;
  text += `• Mines Save Chance: ${(bonuses.minesRevealChance * 100).toFixed(2)}%\n`;
  text += `• Mystery Box Base Luck (from items): ${(bonuses.inventoryLuckBonus * 100).toFixed(2)}%\n`;

  text += `\n**Inventory Effects**\n`;
  if (!bonuses.inventoryEffects.length) {
    text += `• No item effects active yet\n`;
  } else {
    for (const line of bonuses.inventoryEffects) {
      text += `• ${line}\n`;
    }
  }

  return text;
}

async function renderPage(page, username, userId, wallet) {
  switch (page) {
    case 'winloss':
      return { content: renderWinLossPage(username, wallet), embeds: [] };
    case 'binomial':
      return { content: renderBinomialPage(username, userId, wallet), embeds: [] };
    case 'networth':
      return renderNetWorthPage(username, wallet);
    case 'bonuses':
      return { content: renderBonusesPage(username, userId, wallet), embeds: [] };
    case 'overview':
    default:
      return renderNetWorthPage(username, wallet);
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
  const rendered = await renderPage('networth', target.username, target.userId, wallet);
  const components = getNavRow(interaction.user.id, target.userId, 'networth');
  return interaction.reply({ content: rendered.content, embeds: rendered.embeds, components });
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
  const rendered = await renderPage(page, username, parsed.targetId, wallet);
  const components = getNavRow(parsed.viewerId, parsed.targetId, page);
  return interaction.update({ content: rendered.content, embeds: rendered.embeds, components });
}

module.exports = { handleStats, handleStatsButton };
