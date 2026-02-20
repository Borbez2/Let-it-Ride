const { Client, GatewayIntentBits, Events, REST, Routes, SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require('discord.js');
require('dotenv').config();

const { CONFIG } = require('./config');
const store = require('./data/store');
const blackjack = require('./games/blackjack');
const mines = require('./games/mines');
const simple = require('./games/simple');
const economy = require('./commands/economy');
const adminCmd = require('./commands/admin');
const helpCmd = require('./commands/help');
const statsCmd = require('./commands/stats');
const pityCmd = require('./commands/pity');
const dbBackup = require('./utils/dbBackup');
const { renderChartToBuffer } = require('./utils/renderChart');

// Load required environment values from .env.
const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const ANNOUNCE_CHANNEL_ID = process.env.ANNOUNCE_CHANNEL_ID;
const DAILY_EVENTS_CHANNEL_ID = CONFIG.bot.channels.dailyEvents;
const HOURLY_PAYOUT_CHANNEL_ID = CONFIG.bot.channels.hourlyPayout;
const LIFE_STATS_CHANNEL_ID = CONFIG.bot.channels.lifeStats;
const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim()).filter(Boolean);
const STATS_RESET_ADMIN_IDS = (process.env.STATS_RESET_ADMIN_IDS || process.env.ADMIN_IDS || '')
  .split(',')
  .map(id => id.trim())
  .filter(Boolean);

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error("Missing env vars.");
  process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
let isBotActive = true;
const LIVE_GRAPH_SLOT_SECONDS = CONFIG.bot.graph.liveSlotSeconds;
const LIVE_GRAPH_MAX_USERS = CONFIG.bot.graph.maxUsers;
const LIVE_GRAPH_SESSION_TTL_MS = CONFIG.bot.graph.sessionTtlMs;
const DEFAULT_GRAPH_TIMEFRAME_SEC = CONFIG.bot.graph.defaultTimeframeSec;
const LIVE_GRAPH_TIMEFRAMES = CONFIG.bot.graph.timeframes;
const liveGraphSessions = new Map();
const PUBLIC_GRAPH_REFRESH_MS = CONFIG.bot.graph.publicRefreshMs;
const publicGraphState = {
  chartBuffer: null,
  datasetsCount: 0,
  generatedAt: 0,
};
const lifeStatsLoopState = {
  timer: null,
  running: false,
  stopped: false,
};
let stopDbBackupScheduler = null;

function withTimeout(promise, timeoutMs = 2000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout:${timeoutMs}ms`)), timeoutMs)),
  ]);
}

function getGraphPalette() {
  return [
    '#ff6384', '#36a2eb', '#ffce56', '#4bc0c0', '#9966ff', '#ff9f40', '#8dd17e', '#ff7aa2', '#00bcd4', '#cddc39',
    '#f06292', '#64b5f6', '#ffd54f', '#4db6ac', '#9575cd', '#ffb74d', '#81c784', '#ba68c8', '#90a4ae', '#ef5350',
  ];
}

function formatTimeframe(seconds) {
  const predefined = LIVE_GRAPH_TIMEFRAMES.find((entry) => entry.seconds === seconds);
  if (predefined) return predefined.label || predefined.key;
  if (seconds === null) return 'All';
  if (seconds % 86400 === 0) return `${Math.floor(seconds / 86400)}d`;
  if (seconds % 3600 === 0) return `${Math.floor(seconds / 3600)}h`;
  if (seconds % 60 === 0) return `${Math.floor(seconds / 60)}min`;
  return `${seconds}s`;
}

function roundUpToStep(value, step) {
  return Math.ceil(value / step) * step;
}

function pickSlotSeconds(durationMs, maxPoints = 180) {
  if (durationMs <= 0) return LIVE_GRAPH_SLOT_SECONDS;
  const raw = Math.ceil((durationMs / 1000) / Math.max(1, maxPoints - 1));
  return Math.max(LIVE_GRAPH_SLOT_SECONDS, roundUpToStep(raw, LIVE_GRAPH_SLOT_SECONDS));
}

function buildAdaptiveLabels(slotCount, startTs, slotSeconds, mode = 'relative') {
  const tickEvery = Math.max(1, Math.floor(slotCount / 8));
  return Array.from({ length: slotCount }, (_, i) => {
    if (i !== slotCount - 1 && (i % tickEvery !== 0)) return '';
    const ts = startTs + (i * slotSeconds * 1000);
    if (mode === 'clock') {
      const d = new Date(ts);
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }
    const age = (slotCount - i - 1) * slotSeconds;
    if (age === 0) return 'Now';
    if (age >= 86400) return `-${Math.floor(age / 86400)}d`;
    if (age >= 3600) return `-${Math.floor(age / 3600)}h`;
    if (age >= 60) return `-${Math.floor(age / 60)}m`;
    return `-${age}s`;
  });
}

function getGraphCandidateIds(wallets) {
  return Object.entries(wallets)
    .map(([id, wallet]) => {
      const history = Array.isArray(wallet?.stats?.netWorthHistory) ? wallet.stats.netWorthHistory : [];
      const last = history.length ? history[history.length - 1] : null;
      return { id, points: history.length, lastValue: last?.v || 0 };
    })
    .filter((row) => row.points >= 2)
    .sort((a, b) => b.lastValue - a.lastValue)
    .slice(0, LIVE_GRAPH_MAX_USERS)
    .map((row) => row.id);
}

async function resolveUsersByIds(ids) {
  const usersById = new Map();
  await Promise.all(ids.map(async (id) => {
    const cached = client.users.cache.get(id);
    if (cached) {
      usersById.set(id, cached);
      return;
    }
    const fetched = await withTimeout(client.users.fetch(id), 1500).catch(() => null);
    if (fetched) usersById.set(id, fetched);
  }));
  return usersById;
}

function buildSeriesByRange(history, startTs, slotCount, slotSeconds = LIVE_GRAPH_SLOT_SECONDS) {
  const values = Array(slotCount).fill(null);
  for (let i = history.length - 1; i >= 0; i--) {
    const point = history[i];
    const ts = point?.t || 0;
    if (ts < startTs) break;
    const slotIndex = Math.floor((ts - startTs) / (slotSeconds * 1000));
    if (slotIndex < 0 || slotIndex >= slotCount) continue;
    values[slotIndex] = point?.v || 0;
  }
  return values;
}



function resolveGraphWindow({ wallets, selectedIds, timeframeSec = DEFAULT_GRAPH_TIMEFRAME_SEC, startTs = null, endTs = Date.now(), maxPoints = 180 }) {
  const safeEnd = Math.max(0, endTs || Date.now());
  if (Number.isFinite(startTs) && startTs !== null) {
    const durationMs = Math.max(0, safeEnd - startTs);
    const slotSeconds = pickSlotSeconds(durationMs, maxPoints);
    const slotCount = Math.max(2, Math.floor(durationMs / (slotSeconds * 1000)) + 1);
    return { startTs, endTs: safeEnd, slotSeconds, slotCount, labelMode: 'clock' };
  }

  if (timeframeSec === null) {
    let earliest = safeEnd;
    for (const id of selectedIds || []) {
      const history = Array.isArray(wallets[id]?.stats?.netWorthHistory) ? wallets[id].stats.netWorthHistory : [];
      if (history.length > 0) earliest = Math.min(earliest, history[0].t || safeEnd);
    }
    const durationMs = Math.max(1000, safeEnd - earliest);
    const slotSeconds = pickSlotSeconds(durationMs, maxPoints);
    const slotCount = Math.max(2, Math.floor(durationMs / (slotSeconds * 1000)) + 1);
    return { startTs: earliest, endTs: safeEnd, slotSeconds, slotCount, labelMode: 'relative' };
  }

  const durationMs = Math.max(1000, timeframeSec * 1000);
  const rangeStart = safeEnd - durationMs;
  const slotSeconds = pickSlotSeconds(durationMs, maxPoints);
  const slotCount = Math.max(2, Math.floor(durationMs / (slotSeconds * 1000)) + 1);
  return { startTs: rangeStart, endTs: safeEnd, slotSeconds, slotCount, labelMode: 'relative' };
}

async function buildPlayerNetworthGraph({ wallets, selectedIds, timeframeSec, includeAvatars, startTs = null, endTs = Date.now(), maxPoints = 180 }) {
  const window = resolveGraphWindow({ wallets, selectedIds, timeframeSec, startTs, endTs, maxPoints });
  const labels = buildAdaptiveLabels(window.slotCount, window.startTs, window.slotSeconds, window.labelMode);
  const ids = (selectedIds || []).slice(0, LIVE_GRAPH_MAX_USERS);
  const usersById = await resolveUsersByIds(ids);
  const palette = getGraphPalette();

  const datasets = [];
  for (let index = 0; index < ids.length; index++) {
    const id = ids[index];
    const history = Array.isArray(wallets[id]?.stats?.netWorthHistory) ? wallets[id].stats.netWorthHistory : [];
    const series = buildSeriesByRange(history, window.startTs, window.slotCount, window.slotSeconds);
    const points = series.filter((v) => v !== null).length;
    if (points < 2) continue;

    const user = usersById.get(id) || client.users.cache.get(id);
    const color = palette[index % palette.length];
    const name = (user?.username || `User ${id.slice(-4)}`).slice(0, 16);
    const lastNonNull = series.reduce((acc, val, idx) => (val !== null ? idx : acc), -1);
    const pointRadius = series.map((value, pointIndex) => {
      if (value === null) return 0;
      return pointIndex === lastNonNull ? 7 : 0;
    });

    datasets.push({
      label: name,
      data: series,
      borderColor: color,
      backgroundColor: color,
      borderWidth: 2,
      pointRadius,
      pointHoverRadius: pointRadius,
      pointStyle: 'circle',
      tension: 0.25,
      spanGaps: true,
      fill: false,
    });
  }

  return { labels, datasets, usersById, slotSeconds: window.slotSeconds, startTs: window.startTs, endTs: window.endTs };
}

function getOrCreateLiveGraphSession(viewerId, candidateIds) {
  const now = Date.now();
  const existing = liveGraphSessions.get(viewerId);
  if (existing && existing.expiresAt > now) {
    existing.candidateIds = candidateIds;
    existing.selectedIds = existing.selectedIds.filter((id) => candidateIds.includes(id));
    if (existing.selectedIds.length === 0) existing.selectedIds = candidateIds.slice(0, LIVE_GRAPH_MAX_USERS);
    existing.expiresAt = now + LIVE_GRAPH_SESSION_TTL_MS;
    return existing;
  }

  const next = {
    viewerId,
    timeframeSec: DEFAULT_GRAPH_TIMEFRAME_SEC,
    candidateIds,
    selectedIds: candidateIds.slice(0, LIVE_GRAPH_MAX_USERS),
    lastChartBuffer: null,
    expiresAt: now + LIVE_GRAPH_SESSION_TTL_MS,
  };
  liveGraphSessions.set(viewerId, next);
  return next;
}

function buildLiveGraphControlRows(session, usersById) {
  const rows = [];
  const tfValues = LIVE_GRAPH_TIMEFRAMES;
  for (let i = 0; i < tfValues.length; i += 5) {
    const timeframeRow = new ActionRowBuilder();
    for (const tf of tfValues.slice(i, i + 5)) {
      timeframeRow.addComponents(
        new ButtonBuilder()
          .setCustomId(`livestats_tf_${session.viewerId}_${tf.key}`)
          .setLabel(tf.label || tf.key)
          .setStyle(session.timeframeSec === tf.seconds ? ButtonStyle.Primary : ButtonStyle.Secondary)
      );
    }
    rows.push(timeframeRow);
  }

  const candidates = session.candidateIds.slice(0, LIVE_GRAPH_MAX_USERS);
  for (let i = 0; i < candidates.length; i += 5) {
    const row = new ActionRowBuilder();
    const slice = candidates.slice(i, i + 5);
    for (const id of slice) {
      const user = usersById.get(id) || client.users.cache.get(id);
      const labelBase = (user?.username || id.slice(-4)).slice(0, 12);
      const selected = session.selectedIds.includes(id);
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`livestats_tg_${session.viewerId}_${id}`)
          .setLabel(`${selected ? '✓' : '✕'} ${labelBase}`)
          .setStyle(selected ? ButtonStyle.Success : ButtonStyle.Secondary)
      );
    }
    rows.push(row);
    if (rows.length >= 5) break;
  }

  return rows;
}

// Register all slash command definitions.
const commands = [
  new SlashCommandBuilder().setName('balance').setDescription('Check your coin balance'),
  new SlashCommandBuilder().setName('daily').setDescription('Claim your daily coins'),
  new SlashCommandBuilder().setName('flip').setDescription('Flip coins, instant 50/50')
    .addStringOption(o => o.setName('amount').setDescription(`Bet per flip (e.g. ${CONFIG.commands.amountExamples})`).setRequired(true))
    .addIntegerOption(o => o.setName('quantity').setDescription(`Number of flips (${CONFIG.commands.limits.flipQuantity.min}-${CONFIG.commands.limits.flipQuantity.max})`).setMinValue(CONFIG.commands.limits.flipQuantity.min).setMaxValue(CONFIG.commands.limits.flipQuantity.max)),
  new SlashCommandBuilder().setName('blackjack').setDescription('Play blackjack')
    .addStringOption(o => o.setName('amount').setDescription(`Bet amount (e.g. ${CONFIG.commands.amountExamples})`).setRequired(true)),
  new SlashCommandBuilder().setName('roulette').setDescription('Play roulette')
    .addStringOption(o => o.setName('amount').setDescription(`Bet amount (e.g. ${CONFIG.commands.amountExamples})`).setRequired(true)),
  new SlashCommandBuilder().setName('allin17black').setDescription('Go ALL IN on 17 black in roulette'),
  new SlashCommandBuilder().setName('mines').setDescription('Navigate a minefield for multiplied rewards')
    .addStringOption(o => o.setName('amount').setDescription(`Bet amount (e.g. ${CONFIG.commands.amountExamples})`).setRequired(true))
    .addIntegerOption(o => o.setName('mines').setDescription(`Number of mines (${CONFIG.commands.limits.minesCount.min}-${CONFIG.commands.limits.minesCount.max})`).setRequired(true).setMinValue(CONFIG.commands.limits.minesCount.min).setMaxValue(CONFIG.commands.limits.minesCount.max)),
  new SlashCommandBuilder().setName('leaderboard').setDescription('See the richest players'),
  new SlashCommandBuilder().setName('give').setDescription('Give coins to someone')
    .addUserOption(o => o.setName('user').setDescription('Who to give to').setRequired(true))
    .addStringOption(o => o.setName('amount').setDescription(`Amount (e.g. ${CONFIG.commands.amountExamples})`).setRequired(true)),
  new SlashCommandBuilder().setName('trade').setDescription('Start a trade with someone')
    .addUserOption(o => o.setName('user').setDescription('Who to trade with').setRequired(true)),
  new SlashCommandBuilder().setName('duel').setDescription('Challenge someone to a coin flip duel')
    .addUserOption(o => o.setName('opponent').setDescription('Who to challenge').setRequired(true))
    .addStringOption(o => o.setName('amount').setDescription(`Bet amount (e.g. ${CONFIG.commands.amountExamples})`).setRequired(true)),
  new SlashCommandBuilder().setName('letitride').setDescription('Win and keep doubling')
    .addStringOption(o => o.setName('amount').setDescription(`Starting bet (e.g. ${CONFIG.commands.amountExamples})`).setRequired(true)),
  new SlashCommandBuilder().setName('deposit').setDescription('Deposit coins to your bank')
    .addStringOption(o => o.setName('amount').setDescription(`Amount to deposit (e.g. ${CONFIG.commands.amountExamples})`).setRequired(true)),
  new SlashCommandBuilder().setName('invest').setDescription('Deposit coins to your bank (alias)')
    .addStringOption(o => o.setName('amount').setDescription(`Amount to invest (e.g. ${CONFIG.commands.amountExamples})`).setRequired(true)),
  new SlashCommandBuilder().setName('withdraw').setDescription('Withdraw from your bank')
    .addStringOption(o => o.setName('amount').setDescription(`Amount to withdraw (e.g. ${CONFIG.commands.amountExamples})`).setRequired(true)),
  new SlashCommandBuilder().setName('bank').setDescription('Check your bank status'),
  new SlashCommandBuilder().setName('upgrades').setDescription('View and purchase upgrades'),
  new SlashCommandBuilder().setName('inventory').setDescription('View your collectibles')
    .addIntegerOption(o => o.setName('page').setDescription('Page number').setMinValue(1)),
  new SlashCommandBuilder().setName('collection').setDescription('Collectible leaderboard'),
  new SlashCommandBuilder().setName('pool').setDescription('View the universal pool and daily spin pool'),
  new SlashCommandBuilder().setName('stats').setDescription('Open the multi-page stats dashboard with graphs and bonus details')
    .addUserOption(o => o.setName('user').setDescription('User to check stats for (optional)').setRequired(false)),
  new SlashCommandBuilder().setName('pity').setDescription('View your active pity stacks and per-stack timers'),
  new SlashCommandBuilder().setName('mysterybox').setDescription(`Buy mystery boxes for ${CONFIG.collectibles.mysteryBox.cost.toLocaleString()} coins each`)
    .addIntegerOption(o => o.setName('quantity').setDescription(`Number of boxes to buy (${CONFIG.commands.limits.mysteryBoxQuantity.min}-${CONFIG.commands.limits.mysteryBoxQuantity.max})`).setMinValue(CONFIG.commands.limits.mysteryBoxQuantity.min).setMaxValue(CONFIG.commands.limits.mysteryBoxQuantity.max)),
  new SlashCommandBuilder().setName('help').setDescription('View the help guide for all game systems'),
  adminCmd.buildAdminCommand(),
  new SlashCommandBuilder().setName('giveaway').setDescription('Start a giveaway via popup form with an optional message')
    .addStringOption(o => o.setName('message').setDescription('Optional giveaway message').setRequired(false).setMaxLength(200)),
].map(c => c.toJSON());

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  try {
    console.log("Registering commands...");
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log("Commands registered!");
  } catch (err) { console.error("Failed:", err); }
}

// Distribute hourly bank interest and universal pool shares.
async function distributeUniversalPool() {
  const wallets = store.getAllWallets();
  const poolData = store.getPoolData();
  const ids = Object.keys(wallets);

  if (ids.length === 0) return;

  const interestRows = [];
  for (const id of ids) {
    const interest = store.processBank(id);
    interestRows.push({ id, interest });
  }

  let share = 0;
  if (poolData.universalPool > 0) {
    share = Math.floor(poolData.universalPool / ids.length);
  }

  const doubledPayouts = [];
  if (share > 0) {
    for (const id of ids) {
      const doubleChance = store.getUniversalIncomeDoubleChance(id);
      const gotDouble = Math.random() < doubleChance;
      const payout = gotDouble ? share * 2 : share;
      store.getWallet(id).bank += payout;
      store.trackUniversalIncome(id, payout);
      if (gotDouble) {
        doubledPayouts.push({ id, payout });
      }
    }
    poolData.universalPool -= share * ids.length;
  }

  poolData.lastHourlyPayout = Date.now();
  store.savePool();
  store.saveWallets();

  const channel = await client.channels.fetch(HOURLY_PAYOUT_CHANNEL_ID).catch((err) => {
    console.error(`Hourly channel fetch failed for ${HOURLY_PAYOUT_CHANNEL_ID}:`, err);
    return null;
  });
  if (channel) {
    const rows = [];
    for (const row of interestRows) {
      const u = await client.users.fetch(row.id).catch(() => null);
      const name = (u ? u.username : 'Unknown').substring(0, 14).padEnd(14);
      rows.push(`${name} ${store.formatNumber(row.interest).padStart(11)}`);
    }

    let table = '**Hourly Bank Interest (paid to bank)**\n```\nPlayer          Interest\n-------------- -----------\n';
    table += rows.join('\n');
    table += '\n```';

    await channel.send(table).catch((err) => {
      console.error(`Hourly interest message send failed for ${HOURLY_PAYOUT_CHANNEL_ID}:`, err);
    });
    await channel.send(
      `Universal income paid to bank: **${store.formatNumber(share)}** coins per player this hour (${ids.length} players).`
    ).catch((err) => {
      console.error(`Hourly universal message send failed for ${HOURLY_PAYOUT_CHANNEL_ID}:`, err);
    });
    if (doubledPayouts.length > 0) {
      const lines = doubledPayouts.map(entry => `<@${entry.id}> earned **double universal income** from their perk (**${store.formatNumber(entry.payout)}** total).`);
      await channel.send(`✨ **Hourly Universal Income Mult Procs**\n${lines.join('\n')}`).catch((err) => {
        console.error(`Hourly perk message send failed for ${HOURLY_PAYOUT_CHANNEL_ID}:`, err);
      });
    }
  } else {
    console.error(`Hourly payout skipped: channel ${HOURLY_PAYOUT_CHANNEL_ID} not accessible.`);
  }

  console.log(`Hourly distribution complete. Players: ${ids.length}, universal share: ${share}`);
  await postLifeStatistics().catch((err) => {
    console.error('Life stats update failed after hourly distribution:', err);
  });
}

async function postLifeStatistics() {
  const channel = await client.channels.fetch(LIFE_STATS_CHANNEL_ID).catch(() => null);
  if (!channel) return;

  const now = Date.now();
  store.trackLifeStatsHeartbeat(now);

  const wallets = store.getAllWallets();
  const ids = Object.keys(wallets);
  const poolData = store.getPoolData();
  const share = ids.length > 0 ? Math.floor((poolData.universalPool || 0) / ids.length) : 0;

  const candidateIds = getGraphCandidateIds(wallets);
  let datasets = [];
  let labels = [];
  let chartBuffer = publicGraphState.chartBuffer;
  const shouldRefreshGraph = !publicGraphState.generatedAt || (now - publicGraphState.generatedAt >= PUBLIC_GRAPH_REFRESH_MS) || !publicGraphState.chartBuffer;

  if (shouldRefreshGraph) {
    const graph = await buildPlayerNetworthGraph({
      wallets,
      selectedIds: candidateIds,
      timeframeSec: DEFAULT_GRAPH_TIMEFRAME_SEC,
      includeAvatars: false,
      endTs: now,
      maxPoints: 220,
    });
    labels = graph.labels;
    datasets = graph.datasets;

    const chartConfig = {
      type: 'line',
      data: { labels, datasets },
      options: {
        plugins: {
          legend: {
            display: true,
            position: 'bottom',
            labels: { color: '#ffffff', boxWidth: 10, usePointStyle: true, pointStyleWidth: 14 },
          },
          title: { display: true, text: 'Player Networth', color: '#ffffff' },
        },
        scales: {
          x: { ticks: { color: '#d9d9d9', maxTicksLimit: 10 }, grid: { color: 'rgba(255,255,255,0.08)' } },
          y: { ticks: { color: '#d9d9d9' }, grid: { color: 'rgba(255,255,255,0.08)' } },
        },
        layout: { padding: 8 },
      },
    };

    const freshBuffer = datasets.length > 0 ? await renderChartToBuffer(chartConfig, 980, 420).catch((err) => { console.error('Chart render failed:', err); return null; }) : null;
    if (freshBuffer) {
      chartBuffer = freshBuffer;
      publicGraphState.chartBuffer = freshBuffer;
      publicGraphState.datasetsCount = datasets.length;
      publicGraphState.generatedAt = now;
    } else {
      chartBuffer = publicGraphState.chartBuffer || null;
    }
  } else {
    datasets = Array.from({ length: publicGraphState.datasetsCount });
  }

  const text =
    `**Live Economy Snapshot**\n` +
    `• Universal Pool: **${store.formatNumber(poolData.universalPool || 0)}**\n` +
    `• Daily Spin Pool: **${store.formatNumber(poolData.lossPool || 0)}**\n` +
    `• Current Hourly Payout Per Player: **${store.formatNumber(share)}**\n` +
    `• Graph Timeframe: ${formatTimeframe(DEFAULT_GRAPH_TIMEFRAME_SEC)}\n` +
    `• Players in Graph: ${shouldRefreshGraph ? datasets.length : publicGraphState.datasetsCount}\n` +
    `• Last Updated: <t:${Math.floor(Date.now() / 1000)}:R>`;

  const controls = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('livestats_open')
        .setLabel('Open Big Graph')
        .setStyle(ButtonStyle.Primary)
    ),
  ];

  const payload = chartBuffer
    ? {
        content: text,
        embeds: [{ title: 'Player Networth', image: { url: 'attachment://networth.png' } }],
        files: [new AttachmentBuilder(chartBuffer, { name: 'networth.png' })],
        components: controls,
      }
    : { content: text, embeds: [], files: [], components: controls };

  const state = store.getRuntimeState('lifeStatsMessageRef', null);
  if (state && state.messageId) {
    const msg = await channel.messages.fetch(state.messageId).catch(() => null);
    if (msg) {
      const edited = await msg.edit(payload).then(() => true).catch((err) => {
        console.error('Live stats message edit failed:', err);
        return false;
      });
      if (edited) return;
    }
  }

  const sent = await channel.send(payload).catch((err) => {
    console.error(`Live stats message send failed for ${LIFE_STATS_CHANNEL_ID}:`, err);
    return null;
  });
  if (sent) {
    store.setRuntimeState('lifeStatsMessageRef', {
      channelId: channel.id,
      messageId: sent.id,
    });
  }
}

async function buildLiveBigGraphPayload(viewerId) {
  const wallets = store.getAllWallets();
  const candidateIds = getGraphCandidateIds(wallets);
  const session = getOrCreateLiveGraphSession(viewerId, candidateIds);
  const selectedIds = session.selectedIds.filter((id) => session.candidateIds.includes(id));

  const { labels, datasets, usersById } = await buildPlayerNetworthGraph({
    wallets,
    selectedIds,
    timeframeSec: session.timeframeSec,
    includeAvatars: true,
    maxPoints: 260,
  });

  const chartConfig = {
    type: 'line',
    data: { labels, datasets },
    options: {
      plugins: {
        legend: {
          display: true,
          position: 'bottom',
          labels: { color: '#ffffff', boxWidth: 10, usePointStyle: true, pointStyleWidth: 14 },
        },
        title: { display: true, text: 'Player Networth', color: '#ffffff' },
      },
      scales: {
        x: { ticks: { color: '#d9d9d9', maxTicksLimit: 12 }, grid: { color: 'rgba(255,255,255,0.08)' } },
        y: { ticks: { color: '#d9d9d9' }, grid: { color: 'rgba(255,255,255,0.08)' } },
      },
      layout: { padding: 8 },
    },
  };

  let chartBuffer = datasets.length > 0 ? await renderChartToBuffer(chartConfig, 1600, 900).catch(() => null) : null;
  if (!chartBuffer && session.lastChartBuffer) chartBuffer = session.lastChartBuffer;
  if (chartBuffer) session.lastChartBuffer = chartBuffer;

  const content =
    `**Player Networth (Big Picture)**\n` +
    `• Timeframe: ${formatTimeframe(session.timeframeSec)}\n` +
    `• Players in Graph: ${datasets.length}\n` +
    `• Last Updated: <t:${Math.floor(Date.now() / 1000)}:R>`;

  const components = buildLiveGraphControlRows(session, usersById);
  return {
    content,
    embeds: chartBuffer ? [{ title: 'Player Networth', image: { url: 'attachment://networth.png' } }] : [],
    files: chartBuffer ? [new AttachmentBuilder(chartBuffer, { name: 'networth.png' })] : [],
    components,
    ephemeral: true,
  };
}

async function handleLiveStatsButton(interaction) {
  if (interaction.customId === 'livestats_open') {
    const payload = await buildLiveBigGraphPayload(interaction.user.id);
    return interaction.reply(payload);
  }

  if (interaction.customId.startsWith('livestats_tf_')) {
    const parts = interaction.customId.split('_');
    const viewerId = parts[2];
    const timeframeKey = parts[3];
    const timeframe = LIVE_GRAPH_TIMEFRAMES.find((entry) => entry.key === timeframeKey);
    if (interaction.user.id !== viewerId) {
      return interaction.reply({ content: 'Open your own graph panel to use these controls.', ephemeral: true });
    }
    if (!timeframe) {
      return interaction.reply({ content: 'Invalid timeframe selection.', ephemeral: true });
    }

    const candidateIds = getGraphCandidateIds(store.getAllWallets());
    const session = getOrCreateLiveGraphSession(viewerId, candidateIds);
    session.timeframeSec = timeframe.seconds;
    session.expiresAt = Date.now() + LIVE_GRAPH_SESSION_TTL_MS;
    liveGraphSessions.set(viewerId, session);
    const payload = await buildLiveBigGraphPayload(viewerId);
    return interaction.update(payload);
  }

  if (interaction.customId.startsWith('livestats_tg_')) {
    const parts = interaction.customId.split('_');
    const viewerId = parts[2];
    const targetId = parts[3];
    if (interaction.user.id !== viewerId) {
      return interaction.reply({ content: 'Open your own graph panel to use these controls.', ephemeral: true });
    }

    const candidateIds = getGraphCandidateIds(store.getAllWallets());
    const session = getOrCreateLiveGraphSession(viewerId, candidateIds);
    if (!session.candidateIds.includes(targetId)) {
      return interaction.reply({ content: 'Player is not available in current graph candidates.', ephemeral: true });
    }

    const selected = new Set(session.selectedIds);
    if (selected.has(targetId)) selected.delete(targetId);
    else selected.add(targetId);
    session.selectedIds = Array.from(selected);
    session.expiresAt = Date.now() + LIVE_GRAPH_SESSION_TTL_MS;
    liveGraphSessions.set(viewerId, session);

    const payload = await buildLiveBigGraphPayload(viewerId);
    return interaction.update(payload);
  }
}

function restartLifeStatsInterval() {
  lifeStatsLoopState.stopped = true;
  if (lifeStatsLoopState.timer) {
    clearTimeout(lifeStatsLoopState.timer);
    lifeStatsLoopState.timer = null;
  }
  lifeStatsLoopState.running = false;

  const tuning = store.getRuntimeTuning();

  const scheduleNext = () => {
    if (lifeStatsLoopState.stopped) return;
    lifeStatsLoopState.timer = setTimeout(runCycle, tuning.lifeStatsIntervalMs);
  };

  const runCycle = async () => {
    if (lifeStatsLoopState.stopped) return;
    if (lifeStatsLoopState.running) {
      scheduleNext();
      return;
    }

    lifeStatsLoopState.running = true;
    try {
      await withTimeout(postLifeStatistics(), Math.max(10000, tuning.lifeStatsIntervalMs * 2));
    } catch (err) {
      console.error('Periodic life stats update failed:', err);
    } finally {
      lifeStatsLoopState.running = false;
      scheduleNext();
    }
  };

  lifeStatsLoopState.stopped = false;
  runCycle().catch((err) => {
    console.error('Life stats loop bootstrap failed:', err);
  });
  console.log(`Life stats interval set to ${tuning.lifeStatsIntervalMs}ms.`);
}

async function onRuntimeConfigUpdated() {
  restartLifeStatsInterval();
  await postLifeStatistics().catch(() => null);
}

async function buildLeaderboardBoard(title = '**Leaderboard**') {
  const wallets = store.getAllWallets();
  const entries = Object.entries(wallets)
    .map(([id, d]) => ({ id, balance: d.balance || 0, bank: d.bank || 0 }))
    .sort((a, b) => (b.balance + b.bank) - (a.balance + a.bank)).slice(0, 10);
  if (entries.length === 0) return null;

  let board = `${title}\n\`\`\`\nRank Player          Purse       Bank        Total\n---- -------------- ----------- ----------- -----------\n`;
  const medals = ['1st', '2nd', '3rd'];
  for (let i = 0; i < entries.length; i++) {
    const u = await client.users.fetch(entries[i].id).catch(() => null);
    const name = (u ? u.username : 'Unknown').substring(0, 14).padEnd(14);
    const rank = (medals[i] || `${i + 1}th`).padEnd(4);
    board += `${rank} ${name} ${store.formatNumber(entries[i].balance).padStart(11)} ${store.formatNumber(entries[i].bank).padStart(11)} ${store.formatNumber(entries[i].balance + entries[i].bank).padStart(11)}\n`;
  }
  board += '\`\`\`';
  return board;
}

// Run the daily spin payout.
async function runDailySpin() {
  const poolData = store.getPoolData();
  if (poolData.lossPool <= 0) return;
  try {
    const channel = await client.channels.fetch(DAILY_EVENTS_CHANNEL_ID).catch(() => null);
    if (!channel) return;
    const wallets = store.getAllWallets();
    const entries = Object.entries(wallets)
      .map(([id, d]) => ({ id, total: (d.balance || 0) + (d.bank || 0) }))
      .filter(e => e.total > 0);
    if (entries.length === 0) return;

    const basePrize = poolData.lossPool;
    let roll = Math.random() * entries.length;
    let winner = entries[0];
    for (const e of entries) { roll -= 1; if (roll <= 0) { winner = e; break; } }

    const spinMult = store.getSpinWeight(winner.id);
    const prize = Math.floor(basePrize * spinMult);
    store.getWallet(winner.id).balance += prize;
    store.trackDailySpinWin(winner.id, prize);
    poolData.lossPool = 0;
    poolData.lastDailySpin = Date.now();
    store.savePool(); store.saveWallets();

    const names = [];
    for (const e of entries) {
      const u = await client.users.fetch(e.id).catch(() => null);
      names.push(u ? u.username : 'Unknown');
    }
    const winnerUser = await client.users.fetch(winner.id).catch(() => null);
    const winnerName = winnerUser ? winnerUser.username : 'Unknown';
    const winnerMult = store.getSpinWeight(winner.id);

    const arrows = ['▶', '▷', '►', '▹'];
    let msg = await channel.send(`🎰 **DAILY SPIN** 🎰\nBase Pool: **${store.formatNumber(basePrize)}** coins\n\nSpinning...`);
    for (let f = 0; f < 8; f++) {
      await new Promise(r => setTimeout(r, 500 + f * 80));
      const rn = names[Math.floor(Math.random() * names.length)];
      await msg.edit(`🎰 **DAILY SPIN** 🎰\nBase Pool: **${store.formatNumber(basePrize)}** coins\n\n${arrows[f % 4]} ${rn} ${arrows[f % 4]}`);
    }
    await new Promise(r => setTimeout(r, 1200));
    await msg.edit(
      `🎰 **DAILY SPIN** 🎰\nBase Pool: **${store.formatNumber(basePrize)}** coins\n\n` +
      `🎉🎉🎉\n<@${winner.id}> (**${winnerName}**) WINS **${store.formatNumber(prize)}** COINS!\nPayout Mult: **x${winnerMult.toFixed(1)}**\n🎉🎉🎉`
    );
    await postLifeStatistics().catch(() => null);
    console.log(`Daily spin: ${winnerName} won ${prize} (base ${basePrize}, mult x${spinMult.toFixed(1)})`);
  } catch (err) { console.error("Daily spin error:", err); }
}

// End giveaways once their timers expire.
async function checkExpiredGiveaways() {
  try {
    // Loop through giveaways and process anything that expired.
    const giveaways = store.getAllGiveaways();
    for (const giveaway of giveaways) {
      if (Date.now() > giveaway.expiresAt) {
        const announceChannelId = giveaway.channelId || ANNOUNCE_CHANNEL_ID;
        const channel = announceChannelId
          ? await client.channels.fetch(announceChannelId).catch(() => null)
          : null;
        const disabledRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`giveaway_ended_${giveaway.id}`)
            .setLabel('Giveaway Ended')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true),
        );

        if (giveaway.participants.length > 0) {
          // Pick a random winner from participants.
          const winner = giveaway.participants[Math.floor(Math.random() * giveaway.participants.length)];
          store.getWallet(winner).balance += giveaway.amount;
          store.trackGiveawayWin(winner, giveaway.amount);
          store.trackGiveawayCreated(giveaway.initiatorId, giveaway.amount);
          store.saveWallets();
          
          const initiatorUser = await client.users.fetch(giveaway.initiatorId).catch(() => null);
          const initiatorName = initiatorUser ? initiatorUser.username : 'Unknown';

          const giveawayMessageLine = giveaway.message ? `\nMessage: ${giveaway.message}` : '';

          if (channel && giveaway.messageId) {
            const originalMessage = await channel.messages.fetch(giveaway.messageId).catch(() => null);
            if (originalMessage) {
              await originalMessage.edit({
                content:
                  `🎉 **GIVEAWAY ENDED!**\n\nHost: <@${giveaway.initiatorId}>\nPrize Pool: **${store.formatNumber(giveaway.amount)}** coins\n` +
                  `Participants: ${giveaway.participants.length}${giveawayMessageLine}\nEnds: **ENDED**\nWinner: <@${winner}>`,
                components: [disabledRow],
              }).catch(() => {});
            }
          }

          if (channel) {
            await channel.send(
              `🎉 **GIVEAWAY ENDED!**\n\n` +
              `<@${winner}> won **${store.formatNumber(giveaway.amount)}** coins from **${initiatorName}**'s giveaway!\n` +
              `Participants: ${giveaway.participants.length}${giveawayMessageLine}`
            ).catch(() => {});
          }
        } else {
          // Refund the host if nobody joined.
          store.getWallet(giveaway.initiatorId).balance += giveaway.amount;
          store.saveWallets();

          const giveawayMessageLine = giveaway.message ? `\nMessage: ${giveaway.message}` : '';

          if (channel && giveaway.messageId) {
            const originalMessage = await channel.messages.fetch(giveaway.messageId).catch(() => null);
            if (originalMessage) {
              await originalMessage.edit({
                content:
                  `🎉 **GIVEAWAY ENDED**\n\nHost: <@${giveaway.initiatorId}>\nPrize Pool: **${store.formatNumber(giveaway.amount)}** coins\n` +
                  `Participants: 0${giveawayMessageLine}\nEnds: **ENDED**\nNo participants joined. Host refunded.`,
                components: [disabledRow],
              }).catch(() => {});
            }
          }

          if (channel) {
            await channel.send(
              `🎉 **GIVEAWAY ENDED**\n\nNo participants joined, so <@${giveaway.initiatorId}> was refunded **${store.formatNumber(giveaway.amount)}** coins.`
            ).catch(() => {});
          }
        }
        
        store.removeGiveaway(giveaway.id);
      }
    }
    
  } catch (err) { console.error("Giveaway check error:", err); }
}

// Post a daily leaderboard snapshot.
async function postDailyLeaderboard() {
  try {
    const channel = await client.channels.fetch(DAILY_EVENTS_CHANNEL_ID).catch(() => null);
    if (!channel) return;
    const board = await buildLeaderboardBoard('**Daily Leaderboard**');
    if (!board) return;
    await channel.send(board);
  } catch (err) { console.error("Leaderboard post error:", err); }
}

// Schedule recurring jobs and daily timers.
function scheduleAll() {
  function msUntilNextUtcHour() {
    const now = new Date();
    const next = new Date(now);
    next.setUTCMinutes(0, 0, 0);
    next.setUTCHours(next.getUTCHours() + 1);
    return next - now;
  }

  function msUntilNextDaily1115() {
    const now = new Date();
    const next = new Date(now);
    next.setHours(CONFIG.bot.scheduler.dailySpinHourLocal, CONFIG.bot.scheduler.dailySpinMinuteLocal, 0, 0);
    if (now >= next) next.setDate(next.getDate() + 1);
    return next - now;
  }

  function scheduleNextHourly() {
    const delay = msUntilNextUtcHour();
    setTimeout(async () => {
      try {
        await distributeUniversalPool();
      } catch (err) {
        console.error('Hourly distribution error:', err);
      } finally {
        scheduleNextHourly();
      }
    }, delay);
  }

  function scheduleNextDaily1115() {
    const delay = msUntilNextDaily1115();
    setTimeout(async () => {
      try {
        await runDailySpin();
      } catch (err) {
        console.error('Daily 11:15 cycle error:', err);
      } finally {
        scheduleNextDaily1115();
      }
    }, delay);
  }

  const missedHourlyMs = Date.now() - (store.getPoolData().lastHourlyPayout || 0);
  if (missedHourlyMs >= CONFIG.economy.pools.hourlyPayoutMs) {
    distributeUniversalPool().catch((err) => console.error('Startup catch-up hourly error:', err));
  }

  scheduleNextHourly();
  setInterval(checkExpiredGiveaways, CONFIG.economy.pools.giveawayExpiryCheckMs);
  restartLifeStatsInterval();
  scheduleNextDaily1115();

  if (!stopDbBackupScheduler) {
    stopDbBackupScheduler = dbBackup.startHourlyBackupScheduler({ logger: console, runOnStartup: true });
  }

  const hourlyMs = msUntilNextUtcHour();
  const dailyMs = msUntilNextDaily1115();
  console.log(
    `Daily 11:15 cycle in ${Math.round(dailyMs / 60000)} min (spin only). ` +
    `Hourly payout in ${Math.round(hourlyMs / 60000)} min (next UTC hour).`
  );
}

// Run startup logic when the bot is ready.
client.once(Events.ClientReady, async () => {
  console.log(`Bot online: ${client.user.tag}`);
  await registerCommands();
  await postLifeStatistics().catch((err) => {
    console.error('Initial life stats update failed:', err);
  });
  scheduleAll();
});

// Route every incoming Discord interaction.
client.on(Events.InteractionCreate, async (interaction) => {

  const isAdminUser = ADMIN_IDS.includes(interaction.user.id);
  if (!isBotActive && !isAdminUser) {
    return interaction.reply({ content: 'Ask admin to start the bot.', ephemeral: true }).catch(() => {});
  }

  // Handle modal submissions.
  if (interaction.isModalSubmit()) {
    try {
      if (interaction.customId.startsWith('trade_coinmodal_')) return await economy.handleTradeModal(interaction);
      if (interaction.customId === 'giveaway_create_modal') return await economy.handleGiveawayModal(interaction);
    } catch (e) { console.error(e); }
    return;
  }

  // Handle select menu interactions.
  if (interaction.isStringSelectMenu()) {
    try {
      if (interaction.customId.startsWith('trade_selectitem_') || interaction.customId.startsWith('trade_unselectitem_'))
        return await economy.handleTradeSelectMenu(interaction);
    } catch (e) { console.error(e); }
    return;
  }

  // Handle button interactions.
  if (interaction.isButton()) {
    const parts = interaction.customId.split('_');
    try {
      if (interaction.customId.startsWith('livestats_')) return await handleLiveStatsButton(interaction);
      if (interaction.customId.startsWith('stats_'))    return await statsCmd.handleStatsButton(interaction);
      if (interaction.customId.startsWith('help_'))     return await helpCmd.handleHelpButton(interaction);
      if (interaction.customId.startsWith('upgrade_'))  return await economy.handleUpgradeButton(interaction, parts);
      if (interaction.customId.startsWith('trade_'))    return await economy.handleTradeButton(interaction, parts);
      if (interaction.customId.startsWith('invpage_'))  return await economy.handleInventoryButton(interaction, parts);
      if (interaction.customId.startsWith('mines_'))    return await mines.handleButton(interaction, parts);
      if (interaction.customId.startsWith('duel_'))     return await simple.handleDuelButton(interaction, parts);
      if (interaction.customId.startsWith('ride_'))     return await simple.handleRideButton(interaction, parts);
      if (interaction.customId.startsWith('bjsplit_'))  return await blackjack.handleButton(interaction, parts);
      if (interaction.customId.startsWith('bj_'))       return await blackjack.handleButton(interaction, parts);
      if (interaction.customId.startsWith('allin17_'))  return await simple.handleAllIn17Button(interaction, parts);
      if (interaction.customId.startsWith('roulette_')) return await simple.handleRouletteButton(interaction, parts);

      if (interaction.customId.startsWith('giveaway_join_')) {
        const giveawayId = interaction.customId.slice('giveaway_join_'.length);
        return await economy.handleGiveawayJoin(interaction, giveawayId);
      }
    } catch (e) { console.error(e); }
    return;
  }

  // Handle slash commands.
  if (!interaction.isChatInputCommand()) return;
  const cmd = interaction.commandName;
  const userId = interaction.user.id;
  const isAdmin = ADMIN_IDS.includes(userId);

  if (!isBotActive && !(cmd === 'admin' && isAdmin)) {
    return interaction.reply({ content: 'Ask admin to start the bot.', ephemeral: true });
  }

  try {
    // Apply pending bank interest whenever a user runs a command.
    store.processBank(userId);

    switch (cmd) {
      case 'balance':      return await economy.handleBalance(interaction);
      case 'daily':        return await economy.handleDaily(interaction);
      case 'flip':         return await simple.handleFlip(interaction);

      case 'blackjack':    return await blackjack.handleCommand(interaction);
      case 'roulette':     return await simple.handleRoulette(interaction);
      case 'allin17black': return await simple.handleAllIn17(interaction);
      case 'mines':        return await mines.handleCommand(interaction);
      case 'leaderboard':  return await economy.handleLeaderboard(interaction, client);
      case 'give':         return await economy.handleGive(interaction);
      case 'trade':        return await economy.handleTrade(interaction);
      case 'duel':         return await simple.handleDuel(interaction);
      case 'letitride':    return await simple.handleLetItRide(interaction);
      case 'deposit':
      case 'invest':       return await economy.handleDeposit(interaction);
      case 'withdraw':     return await economy.handleWithdraw(interaction);
      case 'bank':         return await economy.handleBank(interaction);
      case 'upgrades':     return await economy.handleUpgrades(interaction);
      case 'mysterybox':   return await economy.handleMysteryBox(interaction);
      case 'inventory':    return await economy.handleInventory(interaction);
      case 'collection':   return await economy.handleCollection(interaction, client);
      case 'pool':         return await economy.handlePool(interaction);
      case 'stats':        return await statsCmd.handleStats(interaction);
      case 'pity':         return await pityCmd.handlePity(interaction);
      case 'help':         return await helpCmd.handleHelp(interaction);
      case 'giveaway':     return await economy.handleGiveawayStart(interaction);
      case 'admin':        return await adminCmd.handleAdmin(
        interaction,
        client,
        ADMIN_IDS,
        STATS_RESET_ADMIN_IDS,
        runDailySpin,
        distributeUniversalPool,
        ANNOUNCE_CHANNEL_ID,
        HOURLY_PAYOUT_CHANNEL_ID,
        () => isBotActive,
        (nextState) => { isBotActive = !!nextState; },
        onRuntimeConfigUpdated,
      );
    }
  } catch (err) {
    console.error(err);
    if (!interaction.replied) await interaction.reply("Something went wrong").catch(() => {});
  }
});

client.login(TOKEN);
