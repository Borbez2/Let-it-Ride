// ═══════════════════════════════════════════════════════════════════════════
// Graph computation utilities – pure functions with no Discord dependency.
// Extracted from bot.js for easier testing and maintenance.
// ═══════════════════════════════════════════════════════════════════════════

const { CONFIG } = require('../config');

const LIVE_GRAPH_SLOT_SECONDS = CONFIG.bot.graph.liveSlotSeconds;
const LIVE_GRAPH_MAX_USERS = CONFIG.bot.graph.maxUsers;
const LIVE_GRAPH_TIMEFRAMES = CONFIG.bot.graph.timeframes;

/** Standard color palette for graph lines. */
function getGraphPalette() {
  return [
    '#ff6384', '#36a2eb', '#ffce56', '#4bc0c0', '#9966ff', '#ff9f40', '#8dd17e', '#ff7aa2', '#00bcd4', '#cddc39',
    '#f06292', '#64b5f6', '#ffd54f', '#4db6ac', '#9575cd', '#ffb74d', '#81c784', '#ba68c8', '#90a4ae', '#ef5350',
  ];
}

/** Format a seconds-based timeframe into a human-readable label. */
function formatTimeframe(seconds) {
  const predefined = LIVE_GRAPH_TIMEFRAMES.find((entry) => entry.seconds === seconds);
  if (predefined) return predefined.label || predefined.key;
  if (seconds === null) return 'All';
  if (seconds % 86400 === 0) return `${Math.floor(seconds / 86400)}d`;
  if (seconds % 3600 === 0) return `${Math.floor(seconds / 3600)}h`;
  if (seconds % 60 === 0) return `${Math.floor(seconds / 60)}min`;
  return `${seconds}s`;
}

/** Map graph type key to wallet stats history key. */
function historyKeyForType(type) {
  switch (type) {
    case 'xp': return 'xpHistory';
    case 'collectibles': return 'collectibleHistory';
    default: return 'netWorthHistory';
  }
}

function roundUpToStep(value, step) {
  return Math.ceil(value / step) * step;
}

/** Choose slot seconds to fit within maxPoints given a duration. */
function pickSlotSeconds(durationMs, maxPoints = 180) {
  if (durationMs <= 0) return LIVE_GRAPH_SLOT_SECONDS;
  const raw = Math.ceil((durationMs / 1000) / Math.max(1, maxPoints - 1));
  return Math.max(LIVE_GRAPH_SLOT_SECONDS, roundUpToStep(raw, LIVE_GRAPH_SLOT_SECONDS));
}

/** Generate X-axis labels for a graph window. */
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

/**
 * Get the top candidate user IDs for graph display, sorted by last value.
 * Pure function – wallets is a plain object map.
 */
function getGraphCandidateIds(wallets, historyKey = 'netWorthHistory') {
  return Object.entries(wallets)
    .map(([id, wallet]) => {
      const history = Array.isArray(wallet?.stats?.[historyKey]) ? wallet.stats[historyKey] : [];
      const last = history.length ? history[history.length - 1] : null;
      return { id, points: history.length, lastValue: last?.v || 0 };
    })
    .filter((row) => row.points >= 2)
    .sort((a, b) => b.lastValue - a.lastValue)
    .slice(0, LIVE_GRAPH_MAX_USERS)
    .map((row) => row.id);
}

/**
 * Build an array of values for a single user's history, slotted into a fixed grid.
 * Forward-fills gaps with the last known value.
 */
function buildSeriesByRange(history, startTs, slotCount, slotSeconds = LIVE_GRAPH_SLOT_SECONDS) {
  const values = Array(slotCount).fill(null);

  // Find the last value before the window to seed forward-fill
  let seedValue = null;
  for (let i = 0; i < history.length; i++) {
    const ts = history[i]?.t || 0;
    if (ts >= startTs) break;
    seedValue = history[i]?.v || 0;
  }

  // Place history points into slots
  for (let i = history.length - 1; i >= 0; i--) {
    const point = history[i];
    const ts = point?.t || 0;
    if (ts < startTs) break;
    const slotIndex = Math.floor((ts - startTs) / (slotSeconds * 1000));
    if (slotIndex < 0 || slotIndex >= slotCount) continue;
    values[slotIndex] = point?.v || 0;
  }

  // Forward-fill: carry the last known value through null gaps
  let carry = seedValue;
  for (let i = 0; i < slotCount; i++) {
    if (values[i] !== null) {
      carry = values[i];
    } else if (carry !== null) {
      values[i] = carry;
    }
  }

  return values;
}

/**
 * Resolve the graph window parameters (start, end, slot count, slot size).
 * Pure computation – does not touch Discord.
 */
function resolveGraphWindow({ wallets, selectedIds, timeframeSec = null, startTs = null, endTs = Date.now(), maxPoints = 180 }) {
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

module.exports = {
  getGraphPalette,
  formatTimeframe,
  historyKeyForType,
  roundUpToStep,
  pickSlotSeconds,
  buildAdaptiveLabels,
  getGraphCandidateIds,
  buildSeriesByRange,
  resolveGraphWindow,
  // Re-export constants for callers
  LIVE_GRAPH_SLOT_SECONDS,
  LIVE_GRAPH_MAX_USERS,
  LIVE_GRAPH_TIMEFRAMES,
};
