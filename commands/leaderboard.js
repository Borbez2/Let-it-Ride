const { AttachmentBuilder } = require('discord.js');
const { CONFIG } = require('../config');
const store = require('../data/store');
const { renderChartToBuffer } = require('../utils/renderChart');

function buildMonospaceTable(columns, rows) {
  const widths = columns.map((column) => {
    const rowMax = rows.reduce((max, row) => Math.max(max, String(row[column.key] ?? '').length), 0);
    return Math.max(column.header.length, rowMax);
  });

  const formatRow = (rowObj) => columns
    .map((column, index) => String(rowObj[column.key] ?? '').padEnd(widths[index]))
    .join('  ');

  const headerRow = formatRow(Object.fromEntries(columns.map((col) => [col.key, col.header])));
  const dividerRow = widths.map((w) => '-'.repeat(w)).join('  ');
  const bodyRows = rows.map((row) => formatRow(row));
  return ['```', headerRow, dividerRow, ...bodyRows, '```'].join('\n');
}

// ── Graph helpers ──

function pickSlotSeconds(durationMs, maxPoints = 200) {
  if (durationMs <= 0) return 10;
  const raw = Math.ceil((durationMs / 1000) / Math.max(1, maxPoints - 1));
  return Math.max(10, Math.ceil(raw / 10) * 10);
}

function buildRelativeLabels(slotCount, slotSeconds) {
  const tickEvery = Math.max(1, Math.floor(slotCount / 8));
  return Array.from({ length: slotCount }, (_, i) => {
    if (i !== slotCount - 1 && (i % tickEvery !== 0)) return '';
    const age = (slotCount - i - 1) * slotSeconds;
    if (age === 0) return 'Now';
    if (age >= 86400) return `-${Math.floor(age / 86400)}d`;
    if (age >= 3600) return `-${Math.floor(age / 3600)}h`;
    if (age >= 60) return `-${Math.floor(age / 60)}m`;
    return `-${age}s`;
  });
}

function seriesForRange(history, startTs, slotCount, slotSeconds) {
  const data = Array(slotCount).fill(null);
  for (let i = history.length - 1; i >= 0; i--) {
    const point = history[i];
    const ts = point?.t || 0;
    if (ts < startTs) break;
    const idx = Math.floor((ts - startTs) / (slotSeconds * 1000));
    if (idx < 0 || idx >= slotCount) continue;
    data[idx] = point?.v || 0;
  }
  return data;
}

async function buildAllPlayersGraphBuffer(client, wallets) {
  const palette = [
    '#ff6384', '#36a2eb', '#ffce56', '#4bc0c0', '#9966ff', '#ff9f40', '#8dd17e', '#ff7aa2', '#00bcd4', '#cddc39',
    '#f06292', '#64b5f6', '#ffd54f', '#4db6ac', '#9575cd', '#ffb74d', '#81c784', '#ba68c8', '#90a4ae', '#ef5350',
  ];

  const candidates = Object.entries(wallets)
    .map(([id, w]) => {
      const history = Array.isArray(w?.stats?.netWorthHistory) ? w.stats.netWorthHistory : [];
      const last = history.length ? history[history.length - 1].v || 0 : 0;
      return { id, history, last };
    })
    .filter((row) => row.history.length >= 2)
    .sort((a, b) => b.last - a.last)
    .slice(0, 20);

  if (!candidates.length) return null;

  const now = Date.now();
  const earliest = candidates.reduce((min, c) => Math.min(min, c.history[0]?.t || now), now);
  const durationMs = Math.max(1000, now - earliest);
  const slotSeconds = pickSlotSeconds(durationMs, 220);
  const slotCount = Math.max(2, Math.floor(durationMs / (slotSeconds * 1000)) + 1);
  const labels = buildRelativeLabels(slotCount, slotSeconds);

  const datasets = [];
  for (let i = 0; i < candidates.length; i++) {
    const entry = candidates[i];
    const user = await client.users.fetch(entry.id).catch(() => null);
    const label = (user?.username || `User ${entry.id.slice(-4)}`).slice(0, 16);
    const data = seriesForRange(entry.history, earliest, slotCount, slotSeconds);
    const points = data.filter((v) => v !== null).length;
    if (points < 2) continue;
    datasets.push({
      label,
      data,
      borderColor: palette[i % palette.length],
      backgroundColor: palette[i % palette.length],
      borderWidth: 2,
      pointRadius: 0,
      tension: 0.25,
      spanGaps: true,
      fill: false,
    });
  }

  if (!datasets.length) return null;

  const chartConfig = {
    type: 'line',
    data: { labels, datasets },
    options: {
      plugins: {
        legend: { display: true, position: 'bottom', labels: { color: '#ffffff', boxWidth: 10 } },
        title: { display: true, text: 'Player Networth', color: '#ffffff' },
      },
      scales: {
        x: { ticks: { color: '#d9d9d9', maxTicksLimit: 10 }, grid: { color: 'rgba(255,255,255,0.08)' } },
        y: { ticks: { color: '#d9d9d9' }, grid: { color: 'rgba(255,255,255,0.08)' } },
      },
      layout: { padding: 8 },
    },
  };

  return renderChartToBuffer(chartConfig, 980, 420).catch(() => null);
}

// ── Handlers ──

async function handleLeaderboard(interaction, client) {
  const wallets = store.getAllWallets();
  const entries = Object.entries(wallets)
    .map(([id, d]) => ({ id, balance: d.balance || 0, bank: d.bank || 0 }))
    .sort((a, b) => (b.balance + b.bank) - (a.balance + a.bank)).slice(0, 10);
  if (!entries.length) return interaction.reply({ embeds: [{ color: 0x2b2d31, description: 'No players yet!' }] });

  const medals = ['🥇', '🥈', '🥉'];
  const lines = [];
  for (let i = 0; i < entries.length; i++) {
    const u = await client.users.fetch(entries[i].id).catch(() => null);
    const username = u ? u.username : 'Unknown';
    const rank = i < 3 ? medals[i] : `${i + 1}.`;
    const wallet = store.formatNumber(entries[i].balance);
    const bank = store.formatNumber(entries[i].bank);
    const total = store.formatNumber(entries[i].balance + entries[i].bank);
    lines.push(`${rank} **${username}**`);
    lines.push(`Wallet: ${wallet} | Bank: ${bank} | Total: ${total}`);
  }

  const tableEmbed = {
    title: '🏆 Leaderboard',
    color: 0x2b2d31,
    description: lines.join('\n'),
  };

  const graphBuffer = await buildAllPlayersGraphBuffer(client, wallets);
  const replyPayload = { embeds: [tableEmbed] };
  if (graphBuffer) {
    tableEmbed.image = { url: 'attachment://networth.png' };
    replyPayload.files = [new AttachmentBuilder(graphBuffer, { name: 'networth.png' })];
  }

  return interaction.reply(replyPayload);
}

async function handleCollection(interaction, client) {
  const wallets = store.getAllWallets();
  const entries = Object.entries(wallets)
    .map(([id, d]) => ({ id, count: (d.inventory || []).length, unique: new Set((d.inventory || []).map(i => i.id)).size }))
    .filter(e => e.count > 0)
    .sort((a, b) => b.unique - a.unique || b.count - a.count).slice(0, 10);
  if (!entries.length) return interaction.reply({ embeds: [{ color: 0x2b2d31, description: 'Nobody has collectibles yet!' }] });

  const medals = ['🥇', '🥈', '🥉'];
  const rows = [];
  for (let i = 0; i < entries.length; i++) {
    const u = await client.users.fetch(entries[i].id).catch(() => null);
    rows.push({
      rank: i < 3 ? medals[i] : `${i + 1}`,
      player: (u ? u.username : 'Unknown').slice(0, 24),
      unique: String(entries[i].unique),
      total: String(entries[i].count),
    });
  }

  const columns = [
    { key: 'rank', header: 'Rank' },
    { key: 'player', header: 'Player' },
    { key: 'unique', header: 'Unique' },
    { key: 'total', header: 'Total' },
  ];
  const tableText = buildMonospaceTable(columns, rows);
  const tableEmbed = {
    title: '📦 Collectible Leaderboard',
    color: 0x2b2d31,
    description: tableText,
  };

  return interaction.reply({ embeds: [tableEmbed] });
}

module.exports = { handleLeaderboard, handleCollection };
