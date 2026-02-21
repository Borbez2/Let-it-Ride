const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, AttachmentBuilder } = require('discord.js');
const { CONFIG, RARITIES, COLLECTIBLES } = require('../config');
const store = require('../data/store');
const { renderChartToBuffer } = require('../utils/renderChart');
const GIVEAWAY_CHANNEL_ID = CONFIG.bot.channels.giveaway;

const activeTrades = new Map();
const pendingGiveawayMessages = new Map();
const RARITY_ORDER = CONFIG.ui.rarityOrder;


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

function persistTradeSessions() {
  store.setRuntimeState('session:trades', {
    activeTrades: Object.fromEntries(activeTrades),
  });
}

function restoreTradeSessions() {
  const state = store.getRuntimeState('session:trades', null);
  if (!state || typeof state !== 'object') return;
  if (state.activeTrades && typeof state.activeTrades === 'object') {
    for (const [tradeKey, trade] of Object.entries(state.activeTrades)) {
      activeTrades.set(tradeKey, trade);
    }
  }
}

restoreTradeSessions();

// Build the upgrades embed and buttons.
function renderUpgradesPage(userId, successMessage) {
  const w = store.getWallet(userId);
  const maxLevel = CONFIG.economy.upgrades.maxLevel;
  const interestCosts = CONFIG.economy.upgrades.costs.interest;
  const cashbackCosts = CONFIG.economy.upgrades.costs.cashback;
  const spinCosts = CONFIG.economy.upgrades.costs.spinMult;
  const universalIncomeCosts = CONFIG.economy.upgrades.costs.universalIncome;
  const iLvl = w.interestLevel || 0, cLvl = w.cashbackLevel || 0, sLvl = w.spinMultLevel || 0, uLvl = w.universalIncomeMultLevel || 0;
  const bonuses = store.getUserBonuses(userId);
  const iRate = store.getInterestRate(userId), cRatePct = store.getCashbackRate(userId) * 100, sMult = (1 + sLvl * 0.1), uChance = bonuses.universalIncomeDoubleChance * 100;
  const iBaseRate = CONFIG.economy.bank.baseInvestRate + (iLvl * CONFIG.economy.upgrades.interestPerLevel);
  const cBaseRatePct = cLvl * 0.1;
  const iCost = iLvl < maxLevel ? interestCosts[iLvl] : null;
  const cCost = cLvl < maxLevel ? cashbackCosts[cLvl] : null;
  const sCost = sLvl < maxLevel ? spinCosts[sLvl] : null;
  const uCost = uLvl < maxLevel ? universalIncomeCosts[uLvl] : null;

  const bar = (lvl, max) => '▰'.repeat(lvl) + '▱'.repeat(max - lvl);

  const fields = [
    {
      name: '∑ Bank Interest',
      value: `> ${bar(iLvl, maxLevel)} **Lv ${iLvl}/${maxLevel}**\n> Rate: **${(iRate * 100).toFixed(2)}%**/day (hourly)\n> ${iCost ? `Next: **${((iBaseRate + 0.01) * 100).toFixed(2)}%** for **${store.formatNumber(iCost)}**` : '✨ **MAXED**'}`,
      inline: true,
    },
    {
      name: '↩ Loss Cashback',
      value: `> ${bar(cLvl, maxLevel)} **Lv ${cLvl}/${maxLevel}**\n> Rate: **${cRatePct.toFixed(2)}%** back\n> ${cCost ? `Next: **${(cBaseRatePct + 0.1).toFixed(2)}%** for **${store.formatNumber(cCost)}**` : '✨ **MAXED**'}`,
      inline: true,
    },
    { name: '\u200b', value: '\u200b', inline: false },
    {
      name: '⟳× Spin Payout Mult',
      value: `> ${bar(sLvl, maxLevel)} **Lv ${sLvl}/${maxLevel}**\n> Multiplier: **${sMult.toFixed(1)}x** payout\n> ${sCost ? `Next: **${(sMult + 0.1).toFixed(1)}x** for **${store.formatNumber(sCost)}**` : '✨ **MAXED**'}`,
      inline: true,
    },
    {
      name: '∀× Universal Income Chance',
      value: `> ${bar(uLvl, maxLevel)} **Lv ${uLvl}/${maxLevel}**\n> Chance: **${uChance.toFixed(2)}%** to double\n> ${uCost ? `Next: **${(((uLvl + 1) * CONFIG.economy.upgrades.universalIncomePerLevelChance) * 100).toFixed(0)}%** for **${store.formatNumber(uCost)}**` : '✨ **MAXED**'}`,
      inline: true,
    },
    { name: '\u200b', value: '\u200b', inline: false },
  ];

  const embed = {
    title: '⬆️ Upgrades',
    color: 0x2b2d31,
    description: `> 💰 Purse: **${store.formatNumber(w.balance)}** coins`,
    fields,
  };

  if (successMessage) {
    embed.footer = { text: `✅ ${successMessage}` };
  }

  const rows = [];
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`upgrade_interest_${userId}`)
      .setLabel(iCost ? `∑ Interest (${store.formatNumberShort(iCost)})` : '∑ Interest MAXED')
      .setStyle(iCost ? ButtonStyle.Success : ButtonStyle.Secondary).setDisabled(!iCost || w.balance < iCost),
    new ButtonBuilder().setCustomId(`upgrade_cashback_${userId}`)
      .setLabel(cCost ? `↩ Cashback (${store.formatNumberShort(cCost)})` : '↩ Cashback MAXED')
      .setStyle(cCost ? ButtonStyle.Success : ButtonStyle.Secondary).setDisabled(!cCost || w.balance < cCost),
  ));
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`upgrade_spinmult_${userId}`)
      .setLabel(sCost ? `⟳× Spin Mult (${store.formatNumberShort(sCost)})` : '⟳× Spin Mult MAXED')
      .setStyle(sCost ? ButtonStyle.Success : ButtonStyle.Secondary).setDisabled(!sCost || w.balance < sCost),
    new ButtonBuilder().setCustomId(`upgrade_universalmult_${userId}`)
      .setLabel(uCost ? `∀× Income Chance (${store.formatNumberShort(uCost)})` : '∀× Income Chance MAXED')
      .setStyle(uCost ? ButtonStyle.Success : ButtonStyle.Secondary).setDisabled(!uCost || w.balance < uCost),
  ));
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`upgrade_refresh_${userId}`).setLabel('Refresh').setStyle(ButtonStyle.Primary),
  ));
  return { embed, rows };
}

// Render trade UI components and message content.
function renderTradeButtons(trade) {
  const rows = [];
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`trade_setcoins_${trade.initiatorId}`).setLabel('Set Coins').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`trade_additem_${trade.initiatorId}`).setLabel('Add Item').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`trade_removeitem_${trade.initiatorId}`).setLabel('Remove Item').setStyle(ButtonStyle.Secondary),
  ));
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`trade_confirm_${trade.initiatorId}`).setLabel('Confirm').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`trade_cancel_${trade.initiatorId}`).setLabel('Cancel').setStyle(ButtonStyle.Danger),
  ));
  return rows;
}

function renderTradeView(trade) {
  const initItems = trade.initiatorOffer.items.length
    ? trade.initiatorOffer.items.map(i => `${i.emoji} ${i.name}`).join('\n')
    : '*Nothing*';
  const tgtItems = trade.targetOffer.items.length
    ? trade.targetOffer.items.map(i => `${i.emoji} ${i.name}`).join('\n')
    : '*Nothing*';
  const initName = trade.initiatorUsername || trade.initiatorId;
  const tgtName = trade.targetUsername || trade.targetId;
  return {
    title: '🔄 Trade',
    color: 0x2b2d31,
    fields: [
      {
        name: `Offer from ${initName}`,
        value: `💰 **Coins:** ${store.formatNumber(trade.initiatorOffer.coins)}\n📦 **Items:**\n${initItems}`,
        inline: true,
      },
      {
        name: `Offer from ${tgtName}`,
        value: `💰 **Coins:** ${store.formatNumber(trade.targetOffer.coins)}\n📦 **Items:**\n${tgtItems}`,
        inline: true,
      },
    ],
    footer: {
      text: `${trade.initiatorConfirmed ? '✅' : '⬜'} ${initName}  |  ${trade.targetConfirmed ? '✅' : '⬜'} ${tgtName}`,
    },
  };
}

async function updateTradeMessage(interaction, trade) {
  const channelId = trade.channelId || interaction.channelId;
  if (!channelId || !trade.messageId) return false;
  const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
  if (!channel) return false;
  const message = await channel.messages.fetch(trade.messageId).catch(() => null);
  if (!message) return false;
  await message.edit({ embeds: [renderTradeView(trade)], content: '', components: renderTradeButtons(trade) }).catch(() => null);
  return true;
}

// ── Inventory UI (tabbed, rarity-grouped) ──

const INVENTORY_ITEMS_PER_PAGE = 10;
const INVENTORY_TABS = ['overview', ...RARITY_ORDER];

function parseInventoryCustomId(customId) {
  // Format: inv_{tab}_{page}_{userId}
  const parts = customId.split('_');
  if (parts.length < 4) return null;
  return { tab: parts[1], page: parseInt(parts[2], 10) || 0, userId: parts[3] };
}

function buildInventoryNavRow(userId, activeTab, page) {
  const row = new ActionRowBuilder();
  // Overview tab + rarity tabs (top row)
  const tabsToShow = [
    { key: 'overview', label: '◈ Overview' },
    { key: 'common', label: `${RARITIES.common.emoji} Common` },
    { key: 'uncommon', label: `${RARITIES.uncommon.emoji} Uncommon` },
    { key: 'rare', label: `${RARITIES.rare.emoji} Rare` },
    { key: 'legendary', label: `${RARITIES.legendary.emoji} Legendary` },
  ];
  for (const tab of tabsToShow) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`inv_${tab.key}_0_${userId}`)
        .setLabel(tab.label)
        .setStyle(tab.key === activeTab ? ButtonStyle.Primary : ButtonStyle.Secondary)
    );
  }
  return row;
}

function buildInventoryNavRow2(userId, activeTab, page) {
  const row = new ActionRowBuilder();
  const tabsToShow = [
    { key: 'epic', label: `${RARITIES.epic.emoji} Epic` },
    { key: 'mythic', label: `${RARITIES.mythic.emoji} Mythic` },
    { key: 'divine', label: `${RARITIES.divine.emoji} Divine` },
  ];
  for (const tab of tabsToShow) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`inv_${tab.key}_0_${userId}`)
        .setLabel(tab.label)
        .setStyle(tab.key === activeTab ? ButtonStyle.Primary : ButtonStyle.Secondary)
    );
  }
  return row;
}

function buildInventoryPageRow(userId, tab, page, totalPages) {
  if (totalPages <= 1) return null;
  const row = new ActionRowBuilder();
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(`inv_${tab}_${page - 1}_${userId}`)
      .setLabel('◀ Prev')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 0),
    new ButtonBuilder()
      .setCustomId(`inv_${tab}_${page + 1}_${userId}`)
      .setLabel('Next ▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages - 1),
  );
  return row;
}

// Helper: get the displayed buff for a specific collectible item.
// Each item cycles through 5 buff types based on its position within its rarity group.
const ITEM_BUFF_TYPES = ['interestRate', 'cashbackRate', 'minesRevealChance', 'universalDoubleChance', 'spinWeight'];
const ITEM_BUFF_LABELS = ['∑', '↩', '⛁⌖', '∀×', '⟳×'];

function getItemDisplayBuff(item, allItemsOfRarity) {
  const idx = allItemsOfRarity.findIndex(c => c.id === item.id);
  const typeIdx = (idx >= 0 ? idx : 0) % 5;
  const type = ITEM_BUFF_TYPES[typeIdx];
  const label = ITEM_BUFF_LABELS[typeIdx];
  const cfg = CONFIG.collectibles.mysteryBox.perItemDisplayBuff[item.rarity] || {};
  const value = cfg[type] || 0;
  return { type, label, value };
}

function formatItemBuffDisplay({ type, label, value }) {
  if (type === 'spinWeight') {
    const dec = value >= 0.1 ? 2 : value >= 0.01 ? 3 : value >= 0.001 ? 4 : 5;
    return `${label} +${value.toFixed(dec)}x`;
  }
  const pct = value * 100;
  const dec = pct >= 1 ? 2 : pct >= 0.1 ? 3 : pct >= 0.01 ? 4 : 5;
  const suffix = type === 'interestRate' ? '/day' : '';
  return `${label} +${pct.toFixed(dec)}%${suffix}`;
}

function fmtPct(val, suffix = '') {
  const pct = val * 100;
  const dec = pct >= 1 ? 2 : pct >= 0.1 ? 3 : pct >= 0.01 ? 4 : 5;
  return `${pct.toFixed(dec)}%${suffix}`;
}

function fmtWeight(val) {
  const dec = val >= 0.1 ? 3 : val >= 0.01 ? 4 : 5;
  return `${val.toFixed(dec)}x`;
}

function renderCollectionBar(owned, total, filledChar = '▰', emptyChar = '▱', barLength = null) {
  const len = barLength !== null ? barLength : total;
  const filled = total > 0 ? Math.round((owned / total) * len) : 0;
  return filledChar.repeat(filled) + emptyChar.repeat(len - filled);
}

function renderInventoryOverview(userId, username) {
  const cs = store.getCollectionStats(userId);

  // Global progress bar
  const globalBar = renderCollectionBar(cs.totalOwned, cs.totalItems, '▰', '▱', 20);
  let description = `> **${username}'s Collection**\n> ${globalBar} **${cs.totalOwned}/${cs.totalItems}**\n\n`;

  // Per-rarity progress (proportional bars since 120 items won't fit)
  for (const rarity of RARITY_ORDER) {
    const info = cs.byRarity[rarity];
    const bar = renderCollectionBar(info.owned, info.total, '▰', '▱', 10);
    const completeTag = info.complete ? ' ✨' : '';
    description += `> ${RARITIES[rarity].emoji} **${rarity.charAt(0).toUpperCase() + rarity.slice(1)}** ${bar} ${info.owned}/${info.total}${completeTag}\n`;
  }

  // Total stat boosts
  const t = cs.totals;
  description += `\n**◈ Total Stat Boosts**\n`;
  description += `> ∑ Interest: **+${fmtPct(t.interestRate, '/day')}**\n`;
  description += `> ↩ Cashback: **+${fmtPct(t.cashbackRate)}**\n`;
  description += `> ⛁⌖ Mines Save: **+${fmtPct(t.minesRevealChance)}**\n`;
  description += `> ∀× Income Double: **+${fmtPct(t.universalDoubleChance)}**\n`;
  description += `> ⟳× Spin Payout: **+${fmtWeight(t.spinWeight)}**\n`;

  // Completed collections
  const completed = RARITY_ORDER.filter(r => cs.byRarity[r].complete);
  if (completed.length > 0) {
    description += `\n**✨ Completed Collections**\n`;
    for (const rarity of completed) {
      description += `> ${RARITIES[rarity].emoji} ${rarity.charAt(0).toUpperCase() + rarity.slice(1)} — bonus applied!\n`;
    }
  }

  return {
    embeds: [{
      title: '🎒 Inventory',
      color: 0x2b2d31,
      description,
    }],
  };
}

// Calculate per-buff-type totals for owned vs full set of a rarity
function calcRarityBoosts(items, ownedIds, rarity) {
  const cfg = CONFIG.collectibles.mysteryBox.perItemDisplayBuff[rarity] || {};
  const owned = { interestRate: 0, cashbackRate: 0, minesRevealChance: 0, universalDoubleChance: 0, spinWeight: 0 };
  const full  = { interestRate: 0, cashbackRate: 0, minesRevealChance: 0, universalDoubleChance: 0, spinWeight: 0 };
  for (let i = 0; i < items.length; i++) {
    const type = ITEM_BUFF_TYPES[i % 5];
    const val  = cfg[type] || 0;
    full[type] += val;
    if (ownedIds.has(items[i].id)) owned[type] += val;
  }
  return { owned, full };
}

function renderInventoryRarityPage(userId, username, rarity, page) {
  const cs = store.getCollectionStats(userId);
  const info = cs.byRarity[rarity];
  if (!info) return { embeds: [{ title: '🎒 Inventory', color: 0x2b2d31, description: 'Unknown rarity.' }] };

  const allItems = info.items;

  const rarityLabel = rarity.charAt(0).toUpperCase() + rarity.slice(1);
  // Fixed-length bar so all rarities appear uniform
  const bar = renderCollectionBar(info.owned, info.total, '▰', '▱', 15);
  const completeTag = info.complete ? ' ✨ **COMPLETE** — set bonus active!' : '';

  let description = `> ${RARITIES[rarity].emoji} **${rarityLabel} Collection** ${bar} **${info.owned}/${info.total}**${completeTag}\n\n`;

  // Set bonus as a bullet-point list
  const cb = CONFIG.collectibles.mysteryBox.collectionCompleteBonus[rarity];
  if (cb) {
    const tag = info.complete ? '✨ Active' : `${info.total - info.owned} left to unlock`;
    description += `**◈ Set Bonus** (${tag}):\n`;
    if (cb.interestRate)         description += `> • ∑ Interest: **+${fmtPct(cb.interestRate, '/day')}**\n`;
    if (cb.cashbackRate)         description += `> • ↩ Cashback: **+${fmtPct(cb.cashbackRate)}**\n`;
    if (cb.minesRevealChance)    description += `> • ⛁⌖ Mines Save: **+${fmtPct(cb.minesRevealChance)}**\n`;
    if (cb.universalDoubleChance)description += `> • ∀× Income Double: **+${fmtPct(cb.universalDoubleChance)}**\n`;
    if (cb.spinWeight)           description += `> • ⟳× Spin Payout: **+${fmtWeight(cb.spinWeight)}**\n`;
  }
  description += '\n';

  // Per-rarity stat boost summary: owned vs. full collection (items + set bonus)
  const boosts = calcRarityBoosts(allItems, cs.ownedIds, rarity);
  const fullWithBonus = { ...boosts.full };
  if (cb) {
    for (const key of Object.keys(fullWithBonus)) fullWithBonus[key] += cb[key] || 0;
  }
  if (Object.values(fullWithBonus).some(v => v > 0)) {
    const ownedBoostLines = [];
    const fullBoostLines  = [];
    if (fullWithBonus.interestRate > 0) {
      ownedBoostLines.push(`∑ **+${fmtPct(boosts.owned.interestRate, '/day')}**`);
      fullBoostLines.push(`∑ **+${fmtPct(fullWithBonus.interestRate, '/day')}**`);
    }
    if (fullWithBonus.cashbackRate > 0) {
      ownedBoostLines.push(`↩ **+${fmtPct(boosts.owned.cashbackRate)}**`);
      fullBoostLines.push(`↩ **+${fmtPct(fullWithBonus.cashbackRate)}**`);
    }
    if (fullWithBonus.minesRevealChance > 0) {
      ownedBoostLines.push(`⛁⌖ **+${fmtPct(boosts.owned.minesRevealChance)}**`);
      fullBoostLines.push(`⛁⌖ **+${fmtPct(fullWithBonus.minesRevealChance)}**`);
    }
    if (fullWithBonus.universalDoubleChance > 0) {
      ownedBoostLines.push(`∀× **+${fmtPct(boosts.owned.universalDoubleChance)}**`);
      fullBoostLines.push(`∀× **+${fmtPct(fullWithBonus.universalDoubleChance)}**`);
    }
    if (fullWithBonus.spinWeight > 0) {
      ownedBoostLines.push(`⟳× **+${fmtWeight(boosts.owned.spinWeight)}**`);
      fullBoostLines.push(`⟳× **+${fmtWeight(fullWithBonus.spinWeight)}**`);
    }
    description += `**◈ Stat Boosts from this Rarity**\n`;
    description += `> Currently: ${ownedBoostLines.join('  ')}\n`;
    description += `> Full set:   ${fullBoostLines.join('  ')}\n`;
    description += '\n';
  }

  for (const item of allItems) {
    const owned = cs.ownedIds.has(item.id);
    const buffStr = formatItemBuffDisplay(getItemDisplayBuff(item, allItems));
    if (owned) {
      description += `${item.emoji} **${item.name}** — *${buffStr}*\n`;
    } else {
      description += `⬛ ~~${item.name}~~ — *${buffStr}*\n`;
    }
  }

  return {
    embeds: [{
      title: `🎒 Inventory — ${rarityLabel}`,
      color: 0x2b2d31,
      description,
    }],
    page: 0,
    totalPages: 1,
  };
}

function buildInventoryComponents(userId, tab, page, totalPages) {
  const rows = [
    buildInventoryNavRow(userId, tab, page),
    buildInventoryNavRow2(userId, tab, page),
  ];
  const pageRow = buildInventoryPageRow(userId, tab, page, totalPages || 1);
  if (pageRow) rows.push(pageRow);
  return rows;
}

function renderInventoryPage(userId, username, tab, page) {
  if (tab === 'overview') {
    const rendered = renderInventoryOverview(userId, username);
    return { ...rendered, components: buildInventoryComponents(userId, tab, page, 1) };
  }
  const rendered = renderInventoryRarityPage(userId, username, tab, page);
  return {
    ...rendered,
    components: buildInventoryComponents(userId, tab, rendered.page || 0, rendered.totalPages || 1),
  };
}

// Build a rarity picker for trade item selection
function buildTradeRarityPicker(userId, trade, isInit) {
  const inv = store.getWallet(userId).inventory;
  const offer = isInit ? trade.initiatorOffer : trade.targetOffer;
  const usedIndices = new Set(offer.items.map(i => i._idx));

  // Count available items per rarity
  const rarityCounts = {};
  for (let i = 0; i < inv.length; i++) {
    if (usedIndices.has(i)) continue;
    const r = inv[i].rarity;
    rarityCounts[r] = (rarityCounts[r] || 0) + 1;
  }

  const options = RARITY_ORDER
    .filter(r => rarityCounts[r] > 0)
    .map(r => ({
      label: `${r.charAt(0).toUpperCase() + r.slice(1)} (${rarityCounts[r]})`,
      value: r,
      emoji: RARITIES[r] ? RARITIES[r].emoji : undefined,
    }));

  if (options.length === 0) return null;

  // If only one rarity available, skip the picker and go straight to items
  if (options.length === 1) return null;

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`trade_pickrarity_${trade.initiatorId}_${userId}`)
    .setPlaceholder('Select a rarity to browse')
    .addOptions(options);

  return new ActionRowBuilder().addComponents(menu);
}

// Build a select menu from a player's inventory for adding items
function buildItemSelectMenu(userId, trade, isInit, rarityFilter) {
  const inv = store.getWallet(userId).inventory;
  const offer = isInit ? trade.initiatorOffer : trade.targetOffer;
  const usedIndices = new Set(offer.items.map(i => i._idx));

  const getItemNumber = (entry) => {
    const idMatch = typeof entry.item.id === 'string' ? entry.item.id.match(/_(\d+)$/) : null;
    if (idMatch) return parseInt(idMatch[1], 10);
    const nameMatch = typeof entry.item.name === 'string' ? entry.item.name.match(/(\d+)/) : null;
    if (nameMatch) return parseInt(nameMatch[1], 10);
    return Number.MAX_SAFE_INTEGER;
  };

  const available = inv
    .map((item, idx) => ({ item, idx }))
    .filter(e => !usedIndices.has(e.idx))
    .filter(e => !rarityFilter || e.item.rarity === rarityFilter)
    .sort((a, b) => {
      const an = getItemNumber(a);
      const bn = getItemNumber(b);
      if (an !== bn) return an - bn;
      return (a.item.name || '').localeCompare(b.item.name || '');
    })
    .slice(0, 25); // Discord max 25 options

  if (available.length === 0) return null;

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`trade_selectitem_${trade.initiatorId}_${userId}`)
    .setPlaceholder('Select an item to add')
    .addOptions(available.map(e => ({
      label: e.item.name.substring(0, 100),
      description: e.item.rarity,
      value: String(e.idx),
      emoji: e.item.emoji || undefined,
    })));

  return new ActionRowBuilder().addComponents(menu);
}

// Build a select menu for removing items from offer
function buildRemoveSelectMenu(userId, trade, isInit) {
  const offer = isInit ? trade.initiatorOffer : trade.targetOffer;
  if (offer.items.length === 0) return null;

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`trade_unselectitem_${trade.initiatorId}_${userId}`)
    .setPlaceholder('Select an item to remove from offer')
    .addOptions(offer.items.map((item, offerIdx) => ({
      label: item.name.substring(0, 100),
      description: item.rarity,
      value: String(offerIdx),
      emoji: item.emoji || undefined,
    })));

  return new ActionRowBuilder().addComponents(menu);
}

// Slash command handlers.

async function handleBalance(interaction) {
  const userId = interaction.user.id, username = interaction.user.username;
  const payout = store.processBank(userId);
  const w = store.getWallet(userId);
  const total = w.balance + (w.bank || 0);
  const streakText = w.streak > 0 ? `> 🔥 Streak: **${w.streak}** day${w.streak === 1 ? '' : 's'}` : '> 🔥 Streak: **0** days';

  const embed = {
    title: 'Balance',
    color: 0x2b2d31,
    description: `> **${username}**\n> \n> 💰 Purse: **${store.formatNumber(w.balance)}**\n> 🏦 Bank: **${store.formatNumber(w.bank || 0)}**\n> Net Worth: **${store.formatNumber(total)}**\n> \n${streakText}`,
  };

  if (payout > 0) {
    embed.footer = { text: `+${store.formatNumber(payout)} interest collected` };
  }

  return interaction.reply({ embeds: [embed] });
}

async function handleDaily(interaction) {
  const userId = interaction.user.id;
  const c = store.checkDaily(userId);
  if (!c.canClaim) return interaction.reply(`Already claimed. **${c.hours}h ${c.mins}m** left\n🔥 Streak: ${c.streak}`);
  const r = store.claimDaily(userId);
  const sm = r.streak > 1
    ? `\n🔥 ${r.streak} day streak! (+${store.formatNumber(CONFIG.economy.daily.streakBonusPerDay * (r.streak - 1))} bonus)`
    : '';
  return interaction.reply(`Claimed **${store.formatNumber(r.reward)}** coins!${sm}\nBalance: **${store.formatNumber(r.newBalance)}**`);
}

async function handleDeposit(interaction) {
  const userId = interaction.user.id;
  const rawAmount = interaction.options.getString('amount');
  const bal = store.getBalance(userId);
  
  // Parse the amount (supports "all", "4.7k", "1.2m", etc.)
  const amount = rawAmount && typeof rawAmount === 'string' 
    ? store.parseAmount(rawAmount, bal)
    : interaction.options.getInteger('amount');
  
  if (!amount || amount <= 0) {
    return interaction.reply(CONFIG.commands.invalidAmountText);
  }
  
  if (amount > bal) return interaction.reply(`You only have **${store.formatNumber(bal)}**`);
  store.processBank(userId);
  const w = store.getWallet(userId);
  w.balance -= amount; w.bank += amount;
  if (!w.lastBankPayout) w.lastBankPayout = Date.now();
  store.saveWallets();
  const rate = store.getInterestRate(userId);
  return interaction.reply(`Deposited **${store.formatNumber(amount)}** to bank\nBank: **${store.formatNumber(w.bank)}** (${(rate * 100).toFixed(0)}% daily, paid hourly)\nPurse: **${store.formatNumber(w.balance)}**`);
}

async function handleWithdraw(interaction) {
  const userId = interaction.user.id;
  const rawAmount = interaction.options.getString('amount');
  let w = store.getWallet(userId);
  
  // Parse the amount (supports "all", "4.7k", "1.2m", etc.)
  const amount = rawAmount && typeof rawAmount === 'string'
    ? store.parseAmount(rawAmount, w.bank)
    : interaction.options.getInteger('amount');
  
  if (!amount || amount <= 0) {
    return interaction.reply(CONFIG.commands.invalidAmountText);
  }
  
  if (amount > w.bank) return interaction.reply(`❌ Insufficient bank funds. You only have **${store.formatNumber(w.bank)}** in your bank (you tried to withdraw **${store.formatNumber(amount)}**).`);
  store.processBank(userId);
  w = store.getWallet(userId);
  if (amount > w.bank) return interaction.reply(`❌ Insufficient bank funds. You only have **${store.formatNumber(w.bank)}** in your bank (you tried to withdraw **${store.formatNumber(amount)}**).`);
  w.bank -= amount; w.balance += amount; store.saveWallets();
  return interaction.reply(`Withdrew **${store.formatNumber(amount)}**\nBank: **${store.formatNumber(w.bank)}** | Purse: **${store.formatNumber(w.balance)}**`);
}

async function handleBank(interaction) {
  const userId = interaction.user.id;
  const payout = store.processBank(userId);
  const { embed, components } = buildBankPage(userId, 'overview', payout);
  return interaction.reply({ content: '', embeds: [embed], components });
}

// ── Bank Tab Helpers ──

function getBankNavRow(userId, activePage) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`bank_tab_overview_${userId}`)
      .setLabel('◈ Overview')
      .setStyle(activePage === 'overview' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`bank_tab_breakdown_${userId}`)
      .setLabel('∑ Breakdown')
      .setStyle(activePage === 'breakdown' ? ButtonStyle.Primary : ButtonStyle.Secondary),
  );
}

function computeTieredDailyInterestLocal(balance, r) {
  const cfg = CONFIG.economy.bank.tieredInterest;
  if (!cfg) return balance * r;
  const { slab1Threshold: t1, slab2Threshold: t2, slab2Scale, slab3Scale } = cfg;
  return Math.min(balance, t1) * r
    + Math.max(0, Math.min(balance, t2) - t1) * r * slab2Scale
    + Math.max(0, balance - t2) * r * slab3Scale;
}

function buildBankOverviewEmbed(userId, payout) {
  const w = store.getWallet(userId);
  const r = store.getInterestRate(userId);
  const bank = w.bank || 0;
  const dailyInterest = Math.floor(computeTieredDailyInterestLocal(bank, r));
  const hourlyInterest = Math.floor(dailyInterest / 24);
  const last = w.lastBankPayout || Date.now();
  const next = last + 3600000;
  const rem = Math.max(0, next - Date.now());
  const mins = Math.floor(rem / 60000);
  const pending = (w.stats?.interest?.pendingCoins || 0);
  const totalEarned = w.stats?.interest?.totalEarned || 0;

  const fields = [
    {
      name: '◈ Balance',
      value: `> 💰 Purse: **${store.formatNumber(w.balance)}**\n> ◈ Bank: **${store.formatNumber(bank)}**`,
      inline: true,
    },
    {
      name: '∑ Interest Rate',
      value: `> **${(r * 100).toFixed(2)}%**/day · Lv ${w.interestLevel || 0}/${CONFIG.economy.upgrades.maxLevel}\n> Paid hourly to your bank`,
      inline: true,
    },
    { name: '\u200b', value: '\u200b', inline: false },
    {
      name: '📊 Estimates',
      value: `> Hourly: ~**${store.formatNumber(hourlyInterest)}** coins\n> Daily: ~**${store.formatNumber(dailyInterest)}** coins`,
      inline: true,
    },
    {
      name: '⏰ Payout Timer',
      value: `> Next payout: **${mins}m**\n> Pending: **${store.formatNumber(pending)}** coins`,
      inline: true,
    },
    { name: '\u200b', value: '\u200b', inline: false },
    {
      name: '📜 Lifetime',
      value: `> Total interest earned: **${store.formatNumber(totalEarned)}**`,
      inline: false,
    },
  ];

  const embed = {
    title: '◈ Bank — Overview',
    color: 0x2b2d31,
    description: bank <= 0
      ? '> Bank is empty. Use `/deposit` to move coins from your purse.'
      : '> Your bank balance earns interest using a tiered rate system. See the **∑ Breakdown** tab for details.',
    fields,
  };

  if (payout > 0) {
    embed.footer = { text: `+${store.formatNumber(payout)} interest collected` };
  }

  return embed;
}

function buildBankBreakdownEmbed(userId) {
  const w = store.getWallet(userId);
  const r = store.getInterestRate(userId);
  const bank = w.bank || 0;
  const cfg = CONFIG.economy.bank.tieredInterest;
  const t1 = cfg?.slab1Threshold ?? 1000000;
  const t2 = cfg?.slab2Threshold ?? 10000000;
  const s2 = cfg?.slab2Scale ?? 0.1;
  const s3 = cfg?.slab3Scale ?? 0.01;

  const inSlab1 = Math.min(bank, t1);
  const inSlab2 = Math.max(0, Math.min(bank, t2) - t1);
  const inSlab3 = Math.max(0, bank - t2);

  const earn1 = Math.floor(inSlab1 * r);
  const earn2 = Math.floor(inSlab2 * r * s2);
  const earn3 = Math.floor(inSlab3 * r * s3);
  const totalDaily = earn1 + earn2 + earn3;

  const rPct = (r * 100).toFixed(2);
  const r2Pct = (r * s2 * 100).toFixed(3);
  const r3Pct = (r * s3 * 100).toFixed(4);

  const fields = [
    {
      name: '∑ Your Rate (r)',
      value: `> **${rPct}%**/day (base ${(CONFIG.economy.bank.baseInvestRate * 100).toFixed(0)}% + Lv${w.interestLevel || 0} upgrades + items)`,
      inline: false,
    },
    {
      name: `Slab 1 — 0 to ${store.formatNumber(t1)} · rate = r`,
      value: `> In slab: **${store.formatNumber(inSlab1)}** coins\n> Rate: **${rPct}%** → ~**${store.formatNumber(earn1)}**/day`,
      inline: false,
    },
    {
      name: `Slab 2 — ${store.formatNumber(t1)} to ${store.formatNumber(t2)} · rate = r × ${s2}`,
      value: `> In slab: **${store.formatNumber(inSlab2)}** coins\n> Rate: **${r2Pct}%** → ~**${store.formatNumber(earn2)}**/day`,
      inline: false,
    },
    {
      name: `Slab 3 — above ${store.formatNumber(t2)} · rate = r × ${s3}`,
      value: `> In slab: **${store.formatNumber(inSlab3)}** coins\n> Rate: **${r3Pct}%** → ~**${store.formatNumber(earn3)}**/day`,
      inline: false,
    },
    { name: '\u200b', value: '\u200b', inline: false },
    {
      name: '▸ Total estimated interest',
      value: `> **${store.formatNumber(totalDaily)}**/day · **${store.formatNumber(Math.floor(totalDaily / 24))}**/hour`,
      inline: false,
    },
  ];

  return {
    title: '◈ Bank — Tiered Interest Breakdown',
    color: 0x2b2d31,
    description: '> Interest is calculated in slabs like tax brackets. Higher balances earn at a lower marginal rate, but every slab still contributes.',
    fields,
  };
}

function buildBankPage(userId, page, payout = 0) {
  const embed = page === 'breakdown'
    ? buildBankBreakdownEmbed(userId)
    : buildBankOverviewEmbed(userId, payout);
  const components = [getBankNavRow(userId, page)];
  return { embed, components };
}

async function handleBankButton(interaction, parts) {
  // customId: bank_tab_<page>_<userId>
  const page = parts[2];
  const uid = parts[3];
  if (interaction.user.id !== uid) return interaction.reply({ content: 'Not your bank view!', ephemeral: true });
  const { embed, components } = buildBankPage(uid, page);
  return interaction.update({ content: '', embeds: [embed], components });
}

async function handleGive(interaction) {
  const userId = interaction.user.id, username = interaction.user.username;
  const target = interaction.options.getUser('user');
  const rawAmount = interaction.options.getString('amount');
  const bal = store.getBalance(userId);
  
  const amount = store.parseAmount(rawAmount, bal);
  if (!amount || amount <= 0) {
    return interaction.reply(CONFIG.commands.invalidAmountText);
  }
  
  if (target.id === userId) return interaction.reply("Can't give to yourself");
  if (target.bot) return interaction.reply("Can't give to a bot");
  if (amount > bal) return interaction.reply(`You only have **${store.formatNumber(bal)}**`);
  store.setBalance(userId, bal - amount);
  store.setBalance(target.id, store.getBalance(target.id) + amount);
  return interaction.reply(`**${username}** gave **${store.formatNumber(amount)}** to **${target.username}**`);
}

async function handleTrade(interaction) {
  const userId = interaction.user.id;
  const target = interaction.options.getUser('user');
  if (target.id === userId) return interaction.reply("Can't trade with yourself");
  if (target.bot) return interaction.reply("Can't trade with a bot");
  const trade = {
    initiatorId: userId, targetId: target.id,
    initiatorUsername: interaction.user.username,
    targetUsername: target.username,
    initiatorOffer: { coins: 0, items: [] }, targetOffer: { coins: 0, items: [] },
    initiatorConfirmed: false, targetConfirmed: false, createdAt: Date.now(),
  };
  activeTrades.set(userId, trade);
  const msg = await interaction.reply({
    content: `**${interaction.user.username}** wants to trade with **${target.username}**`,
    embeds: [renderTradeView(trade)],
    components: renderTradeButtons(trade),
    fetchReply: true,
  });
  trade.channelId = interaction.channelId;
  trade.messageId = msg.id;
  persistTradeSessions();
  return;
}

async function handleLeaderboard(interaction, client) {
  const wallets = store.getAllWallets();
  const entries = Object.entries(wallets)
    .map(([id, d]) => ({ id, balance: d.balance || 0, bank: d.bank || 0 }))
    .sort((a, b) => (b.balance + b.bank) - (a.balance + a.bank)).slice(0, 10);
  if (!entries.length) return interaction.reply("No players yet!");

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
    title: 'Leaderboard',
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

async function handleUpgrades(interaction) {
  const { embed, rows } = renderUpgradesPage(interaction.user.id);
  return interaction.reply({ content: '', embeds: [embed], components: rows });
}

async function handleMysteryBox(interaction) {
  const userId = interaction.user.id;
  const quantity = interaction.options.getInteger('quantity') || 1;
  const w = store.getWallet(userId);
  const totalCost = quantity * CONFIG.collectibles.mysteryBox.cost;
  
  if (w.balance < totalCost) {
    return interaction.reply(`Need **${store.formatNumber(totalCost)}** coins (you have ${store.formatNumber(w.balance)})`);
  }
  
  w.balance -= totalCost;
  store.ensureWalletStatsShape(w);
  const items = [];
  const newInventoryItems = [];
  let totalCompensation = 0;
  
  for (let i = 0; i < quantity; i++) {
    const item = store.rollMysteryBox(userId);
    
    // Check if this is a duplicate (already in inventory or added this batch)
    if (item.id && item.id.startsWith('placeholder_')) {
      const isDuplicate = w.inventory.some(inv => inv.id === item.id)
        || newInventoryItems.some(inv => inv.id === item.id);
      if (isDuplicate) {
        // Give compensation instead of duplicate
        const compensation = store.getDuplicateCompensation(item.id, item._rarity);
        totalCompensation += compensation;
        items.push({ ...item, isDuplicate: true, compensation });
        continue;
      }
    }
    
    const invItem = { id: item.id, name: item.name, rarity: item.rarity, emoji: item.emoji, obtainedAt: Date.now() };
    newInventoryItems.push(invItem);
    items.push(item);
  }

  // Build reply message before committing any state
  let replyPayload;
  if (quantity === 1) {
    const item = items[0];
    if (item.isDuplicate) {
      replyPayload = `${item.emoji} **Mystery Box - DUPLICATE**\n\nYou already have: **${item.name}**\nCompensation: **${store.formatNumber(item.compensation)}** coins\nNew Balance: **${store.formatNumber(w.balance + totalCompensation)}**`;
    } else {
      replyPayload = `${item.emoji} **Mystery Box**\n\nYou got: **${item.name}** (${item.rarity})\nBalance: **${store.formatNumber(w.balance + totalCompensation)}**`;
    }
  } else {
    // Group by rarity for bulk display
    const byRarity = {};
    let duplicateCount = 0;
    for (const item of items) {
      if (item.isDuplicate) {
        duplicateCount++;
      } else {
        if (!byRarity[item.rarity]) byRarity[item.rarity] = [];
        byRarity[item.rarity].push(item);
      }
    }
    
    let summary = `**Mystery Boxes x${quantity}**\n\n`;
    for (const rarity of RARITY_ORDER) {
      const rarityItems = byRarity[rarity];
      if (!rarityItems || rarityItems.length === 0) continue;
      summary += `${RARITIES[rarity].emoji} ${rarity}: x${rarityItems.length}\n`;
    }
    if (duplicateCount > 0) {
      summary += `\n⚠️ Duplicates: x${duplicateCount}\n💰 Compensation: **${store.formatNumber(totalCompensation)}**\n`;
    }
    summary += `\nBalance: **${store.formatNumber(w.balance + totalCompensation)}**`;
    replyPayload = summary;
  }
  
  // Try to reply first — only commit state if the interaction succeeds
  try {
    await interaction.reply(replyPayload);
  } catch (err) {
    // Interaction failed (expired, already replied, etc.) — rollback balance
    w.balance += totalCost;
    store.saveWallets();
    return;
  }
  
  // Interaction succeeded — commit inventory, stats, and compensation
  for (const invItem of newInventoryItems) {
    w.inventory.push(invItem);
  }
  w.balance += totalCompensation;
  if (totalCompensation > 0) {
    store.trackMysteryBoxDuplicateComp(userId, totalCompensation);
  }
  w.stats.mysteryBox.spent = (w.stats.mysteryBox.spent || 0) + totalCost;
  store.applyMysteryBoxStats(userId, items);
  store.saveWallets();
}

async function handleInventory(interaction) {
  const userId = interaction.user.id, username = interaction.user.username;
  const result = renderInventoryPage(userId, username, 'overview', 0);
  return interaction.reply({ content: '', embeds: result.embeds, components: result.components });
}

async function handleInventoryButton(interaction, parts) {
  // New format: inv_{tab}_{page}_{userId}
  const parsed = parseInventoryCustomId(interaction.customId);
  if (!parsed) return;
  if (interaction.user.id !== parsed.userId) return interaction.reply({ content: "Not your inventory!", ephemeral: true });

  const username = interaction.user.username;
  const result = renderInventoryPage(parsed.userId, username, parsed.tab, parsed.page);
  return interaction.update({ content: '', embeds: result.embeds, components: result.components });
}

async function handleCollection(interaction, client) {
  const wallets = store.getAllWallets();
  const entries = Object.entries(wallets)
    .map(([id, d]) => ({ id, count: (d.inventory || []).length, unique: new Set((d.inventory || []).map(i => i.id)).size }))
    .filter(e => e.count > 0)
    .sort((a, b) => b.unique - a.unique || b.count - a.count).slice(0, 10);
  if (!entries.length) return interaction.reply("Nobody has collectibles yet!");

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
    title: 'Collectible Leaderboard',
    color: 0x2b2d31,
    description: tableText,
  };

  return interaction.reply({ embeds: [tableEmbed] });
}

async function handlePool(interaction) {
  const poolData = store.getPoolData();
  const wallets = store.getAllWallets();
  const nextHourly = poolData.lastHourlyPayout + 3600000;
  const minsH = Math.max(0, Math.floor((nextHourly - Date.now()) / 60000));
  const players = Object.keys(wallets).length;
  const share = players > 0 ? Math.floor(poolData.universalPool / players) : 0;
  let text = `**Universal Pool** (5% win tax)\nTotal: **${store.formatNumber(poolData.universalPool)}** coins\nPlayers: ${players} | Your share: ~**${store.formatNumber(share)}**\nNext payout: ${minsH}m\n\n`;
  text += `**Daily Spin Pool** (5% loss tax)\nTotal: **${store.formatNumber(poolData.lossPool)}** coins\nSpins daily at 11:15pm, winnings multiplied by Spin Payout Mult upgrade`;
  return interaction.reply(text);
}

// Button handlers.

async function handleUpgradeButton(interaction, parts) {
  const action = parts[1], uid = parts[2];
  if (interaction.user.id !== uid) return interaction.reply({ content: "Not yours!", ephemeral: true });
  const w = store.getWallet(uid);

  if (action === 'refresh') {
    const { embed, rows } = renderUpgradesPage(uid);
    return interaction.update({ content: '', embeds: [embed], components: rows });
  }
  if (action === 'interest') {
    store.processBank(uid);
    const lvl = w.interestLevel || 0;
    if (lvl >= CONFIG.economy.upgrades.maxLevel) return interaction.reply({ content: "Maxed!", ephemeral: true });
    const cost = CONFIG.economy.upgrades.costs.interest[lvl];
    if (w.balance < cost) return interaction.reply({ content: `Need ${store.formatNumber(cost)}`, ephemeral: true });
    w.balance -= cost; w.interestLevel = lvl + 1; store.saveWallets();
    const { embed, rows } = renderUpgradesPage(uid, `Interest → Lv ${w.interestLevel}`);
    return interaction.update({ content: '', embeds: [embed], components: rows });
  }
  if (action === 'cashback') {
    const lvl = w.cashbackLevel || 0;
    if (lvl >= CONFIG.economy.upgrades.maxLevel) return interaction.reply({ content: "Maxed!", ephemeral: true });
    const cost = CONFIG.economy.upgrades.costs.cashback[lvl];
    if (w.balance < cost) return interaction.reply({ content: `Need ${store.formatNumber(cost)}`, ephemeral: true });
    w.balance -= cost; w.cashbackLevel = lvl + 1; store.saveWallets();
    const { embed, rows } = renderUpgradesPage(uid, `Cashback → Lv ${w.cashbackLevel}`);
    return interaction.update({ content: '', embeds: [embed], components: rows });
  }
  if (action === 'spinmult') {
    const lvl = w.spinMultLevel || 0;
    if (lvl >= CONFIG.economy.upgrades.maxLevel) return interaction.reply({ content: "Maxed!", ephemeral: true });
    const cost = CONFIG.economy.upgrades.costs.spinMult[lvl];
    if (w.balance < cost) return interaction.reply({ content: `Need ${store.formatNumber(cost)}`, ephemeral: true });
    w.balance -= cost; w.spinMultLevel = lvl + 1; store.saveWallets();
    const { embed, rows } = renderUpgradesPage(uid, `Spin Payout Mult → Lv ${w.spinMultLevel} (${(1 + w.spinMultLevel * 0.1).toFixed(1)}x)`);
    return interaction.update({ content: '', embeds: [embed], components: rows });
  }
  if (action === 'universalmult') {
    const lvl = w.universalIncomeMultLevel || 0;
    if (lvl >= CONFIG.economy.upgrades.maxLevel) return interaction.reply({ content: "Maxed!", ephemeral: true });
    const cost = CONFIG.economy.upgrades.costs.universalIncome[lvl];
    if (w.balance < cost) return interaction.reply({ content: `Need ${store.formatNumber(cost)}`, ephemeral: true });
    w.balance -= cost; w.universalIncomeMultLevel = lvl + 1; store.saveWallets();
    const newChancePct = ((w.universalIncomeMultLevel * CONFIG.economy.upgrades.universalIncomePerLevelChance) * 100).toFixed(0);
    const { embed, rows } = renderUpgradesPage(uid, `Income Double → Lv ${w.universalIncomeMultLevel} (${newChancePct}% chance)`);
    return interaction.update({ content: '', embeds: [embed], components: rows });
  }
}

async function handleTradeButton(interaction, parts) {
  const action = parts[1], tradeKey = parts[2];
  const trade = activeTrades.get(tradeKey);
  if (!trade) return interaction.reply({ content: "Trade expired!", ephemeral: true });
  const isInit = interaction.user.id === trade.initiatorId;
  const isTgt = interaction.user.id === trade.targetId;
  if (!isInit && !isTgt) return interaction.reply({ content: "Not your trade!", ephemeral: true });

  if (action === 'setcoins') {
    // Show a modal for entering coin amount
    const modal = new ModalBuilder()
      .setCustomId(`trade_coinmodal_${trade.initiatorId}_${interaction.user.id}`)
      .setTitle('Set Coin Offer');
    const input = new TextInputBuilder()
      .setCustomId('coin_amount')
      .setLabel('How many coins do you want to offer?')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('e.g. 5000')
      .setRequired(true);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return interaction.showModal(modal);
  }

  if (action === 'additem') {
    // Show rarity picker first if multiple rarities are available
    const rarityPicker = buildTradeRarityPicker(interaction.user.id, trade, isInit);
    if (rarityPicker) {
      return interaction.reply({ content: "Pick a rarity to browse:", components: [rarityPicker], ephemeral: true });
    }
    // Only one (or zero) rarity — show items directly
    const menu = buildItemSelectMenu(interaction.user.id, trade, isInit, null);
    if (!menu) return interaction.reply({ content: "No items available to add!", ephemeral: true });
    return interaction.reply({ content: "Select an item to add to your offer:", components: [menu], ephemeral: true });
  }

  if (action === 'removeitem') {
    const menu = buildRemoveSelectMenu(interaction.user.id, trade, isInit);
    if (!menu) return interaction.reply({ content: "No items in your offer to remove!", ephemeral: true });
    return interaction.reply({ content: "Select an item to remove from your offer:", components: [menu], ephemeral: true });
  }

  if (action === 'confirm') {
    if (isInit) trade.initiatorConfirmed = true;
    if (isTgt) trade.targetConfirmed = true;
    persistTradeSessions();
    if (trade.initiatorConfirmed && trade.targetConfirmed) {
      const iw = store.getWallet(trade.initiatorId), tw = store.getWallet(trade.targetId);
      if (iw.balance < trade.initiatorOffer.coins || tw.balance < trade.targetOffer.coins) {
        activeTrades.delete(tradeKey);
        persistTradeSessions();
        return interaction.update({ content: "Trade failed, not enough coins.", components: [] });
      }
      // Validate all offered items still exist in inventories
      for (const item of trade.initiatorOffer.items) {
        if (item._idx >= iw.inventory.length || iw.inventory[item._idx].id !== item.id) {
          activeTrades.delete(tradeKey);
          persistTradeSessions();
          return interaction.update({ content: "Trade failed, inventory changed.", components: [] });
        }
      }
      for (const item of trade.targetOffer.items) {
        if (item._idx >= tw.inventory.length || tw.inventory[item._idx].id !== item.id) {
          activeTrades.delete(tradeKey);
          persistTradeSessions();
          return interaction.update({ content: "Trade failed, inventory changed.", components: [] });
        }
      }

      // Exchange coins
      iw.balance -= trade.initiatorOffer.coins; iw.balance += trade.targetOffer.coins;
      tw.balance -= trade.targetOffer.coins; tw.balance += trade.initiatorOffer.coins;

      // Exchange items (remove by index descending to keep indices valid)
      const initRemoveIdxs = trade.initiatorOffer.items.map(i => i._idx).sort((a, b) => b - a);
      const tgtRemoveIdxs = trade.targetOffer.items.map(i => i._idx).sort((a, b) => b - a);

      const initItemsToGive = [];
      for (const idx of initRemoveIdxs) {
        const rm = iw.inventory.splice(idx, 1)[0];
        initItemsToGive.push({ id: rm.id, name: rm.name, rarity: rm.rarity, emoji: rm.emoji, obtainedAt: rm.obtainedAt });
      }
      const tgtItemsToGive = [];
      for (const idx of tgtRemoveIdxs) {
        const rm = tw.inventory.splice(idx, 1)[0];
        tgtItemsToGive.push({ id: rm.id, name: rm.name, rarity: rm.rarity, emoji: rm.emoji, obtainedAt: rm.obtainedAt });
      }

      // Add received items
      for (const item of tgtItemsToGive) iw.inventory.push(item);
      for (const item of initItemsToGive) tw.inventory.push(item);

      store.saveWallets(); activeTrades.delete(tradeKey); persistTradeSessions();
      const initGave = [
        trade.initiatorOffer.coins ? `💰 ${store.formatNumber(trade.initiatorOffer.coins)} coins` : null,
        ...initItemsToGive.map(i => `${i.emoji} ${i.name}`),
      ].filter(Boolean);
      const tgtGave = [
        trade.targetOffer.coins ? `💰 ${store.formatNumber(trade.targetOffer.coins)} coins` : null,
        ...tgtItemsToGive.map(i => `${i.emoji} ${i.name}`),
      ].filter(Boolean);
      const completedEmbed = {
        title: '✅ Trade Complete',
        color: 0x57f287,
        fields: [
          {
            name: `${trade.initiatorUsername} gave`,
            value: initGave.length ? initGave.join('\n') : '*Nothing*',
            inline: true,
          },
          {
            name: `${trade.targetUsername} gave`,
            value: tgtGave.length ? tgtGave.join('\n') : '*Nothing*',
            inline: true,
          },
        ],
      };
      return interaction.update({ content: '', embeds: [completedEmbed], components: [] });
    }
    return interaction.update({ embeds: [renderTradeView(trade)], content: '', components: renderTradeButtons(trade) });
  }
  if (action === 'cancel') {
    const cancellerName = interaction.user.username;
    activeTrades.delete(tradeKey);
    persistTradeSessions();
    return interaction.update({
      content: '',
      embeds: [{ title: '❌ Trade Cancelled', color: 0xed4245, description: `Cancelled by **${cancellerName}**.` }],
      components: [],
    });
  }
}

// Handle trade select menu interactions.
async function handleTradeSelectMenu(interaction) {
  const parts = interaction.customId.split('_');
  // trade_selectitem_{tradeKey}_{userId} or trade_unselectitem_{tradeKey}_{userId}
  const action = parts[1];
  const tradeKey = parts[2];
  const forUser = parts[3];

  const trade = activeTrades.get(tradeKey);
  if (!trade) return interaction.reply({ content: "Trade expired!", ephemeral: true });
  if (interaction.user.id !== forUser) return interaction.reply({ content: "Not yours!", ephemeral: true });

  const isInit = interaction.user.id === trade.initiatorId;
  const offer = isInit ? trade.initiatorOffer : trade.targetOffer;

  if (action === 'selectitem') {
    const idx = parseInt(interaction.values[0]);
    const inv = store.getWallet(interaction.user.id).inventory;
    if (idx >= inv.length) return interaction.reply({ content: "Invalid item!", ephemeral: true });
    const item = inv[idx];
    offer.items.push({ id: item.id, name: item.name, rarity: item.rarity, emoji: item.emoji, _idx: idx });
    trade.initiatorConfirmed = false; trade.targetConfirmed = false;
    persistTradeSessions();

    await interaction.deferUpdate();
    await updateTradeMessage(interaction, trade);
    return interaction.editReply({ content: `Added **${item.name}** to your offer!`, components: [] });
  }

  if (action === 'pickrarity') {
    const rarity = interaction.values[0];
    const menu = buildItemSelectMenu(interaction.user.id, trade, isInit, rarity);
    if (!menu) return interaction.update({ content: "No items of that rarity available!", components: [] });
    return interaction.update({ content: `Select a **${rarity}** item to add:`, components: [menu] });
  }

  if (action === 'unselectitem') {
    const offerIdx = parseInt(interaction.values[0]);
    if (offerIdx >= offer.items.length) return interaction.reply({ content: "Invalid!", ephemeral: true });
    const removed = offer.items.splice(offerIdx, 1)[0];
    trade.initiatorConfirmed = false; trade.targetConfirmed = false;
    persistTradeSessions();
    await interaction.deferUpdate();
    await updateTradeMessage(interaction, trade);
    return interaction.editReply({ content: `Removed **${removed.name}** from your offer!`, components: [] });
  }
}

// Handle trade modal submissions for coin amounts.
async function handleTradeModal(interaction) {
  const parts = interaction.customId.split('_');
  // trade_coinmodal_{tradeKey}_{userId}
  const tradeKey = parts[2];
  const forUser = parts[3];

  const trade = activeTrades.get(tradeKey);
  if (!trade) return interaction.reply({ content: "Trade expired!", ephemeral: true });
  if (interaction.user.id !== forUser) return interaction.reply({ content: "Not yours!", ephemeral: true });

  const raw = interaction.fields.getTextInputValue('coin_amount').replace(/,/g, '').trim();
  const amount = parseInt(raw);
  if (isNaN(amount) || amount < 0) return interaction.reply({ content: "Enter a valid number (0 or more).", ephemeral: true });

  const bal = store.getBalance(interaction.user.id);
  if (amount > bal) return interaction.reply({ content: `You only have **${store.formatNumber(bal)}** coins.`, ephemeral: true });

  const isInit = interaction.user.id === trade.initiatorId;
  if (isInit) trade.initiatorOffer.coins = amount;
  else trade.targetOffer.coins = amount;
  trade.initiatorConfirmed = false; trade.targetConfirmed = false;
  persistTradeSessions();

  await interaction.deferUpdate();
  await updateTradeMessage(interaction, trade);
  return interaction.followUp({ content: `✅ Set your coin offer to **${store.formatNumber(amount)}**.`, ephemeral: true });
}

// Giveaway handlers.

async function handleGiveawayStart(interaction) {
  const rawMessage = interaction.options.getString('message');
  const giveawayMessage = rawMessage && rawMessage.trim() ? rawMessage.trim().slice(0, 200) : null;
  pendingGiveawayMessages.set(interaction.user.id, giveawayMessage);

  const modal = new ModalBuilder()
    .setCustomId('giveaway_create_modal')
    .setTitle('Start Giveaway');

  const amountInput = new TextInputBuilder()
    .setCustomId('giveaway_amount')
    .setLabel('Prize amount (e.g. 100, 4.7k, 1.2m, all)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(20)
    .setPlaceholder('e.g. 100, 4.7k, 1.2m, all');

  const secondsInput = new TextInputBuilder()
    .setCustomId('giveaway_seconds')
    .setLabel('Seconds (0-60, blank = 0)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(2)
    .setPlaceholder('e.g. 30');

  const minutesInput = new TextInputBuilder()
    .setCustomId('giveaway_minutes')
    .setLabel('Minutes (0-60, blank = 0)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(2)
    .setPlaceholder('e.g. 10');

  const hoursInput = new TextInputBuilder()
    .setCustomId('giveaway_hours')
    .setLabel('Hours (0-24, blank = 0)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(2)
    .setPlaceholder('e.g. 1');

  const daysInput = new TextInputBuilder()
    .setCustomId('giveaway_days')
    .setLabel('Days (0-365, blank = 0)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(3)
    .setPlaceholder('e.g. 2');

  modal.addComponents(
    new ActionRowBuilder().addComponents(amountInput),
    new ActionRowBuilder().addComponents(secondsInput),
    new ActionRowBuilder().addComponents(minutesInput),
    new ActionRowBuilder().addComponents(hoursInput),
    new ActionRowBuilder().addComponents(daysInput),
  );

  return interaction.showModal(modal);
}

function parseDurationPart(rawValue, label, min, max) {
  const raw = (rawValue || '').trim();
  if (!raw) return { ok: true, value: 0 };
  if (!/^\d+$/.test(raw)) {
    return { ok: false, error: `${label} must be a whole number between ${min} and ${max}.` };
  }
  const value = parseInt(raw, 10);
  if (value < min || value > max) {
    return { ok: false, error: `${label} must be between ${min} and ${max}.` };
  }
  return { ok: true, value };
}

async function handleGiveawayModal(interaction) {
  const userId = interaction.user.id;
  const giveawayNote = pendingGiveawayMessages.get(userId) || null;
  pendingGiveawayMessages.delete(userId);

  const rawAmount = interaction.fields.getTextInputValue('giveaway_amount');
  const rawSeconds = interaction.fields.getTextInputValue('giveaway_seconds');
  const rawMinutes = interaction.fields.getTextInputValue('giveaway_minutes');
  const rawHours = interaction.fields.getTextInputValue('giveaway_hours');
  const rawDays = interaction.fields.getTextInputValue('giveaway_days');
  const bal = store.getBalance(userId);

  if (bal <= 0) {
    return interaction.reply({ content: `Not enough coins. You only have **${store.formatNumber(bal)}**`, ephemeral: true });
  }

  const amount = store.parseAmount(rawAmount, bal);
  if (!amount || amount <= 0) {
    return interaction.reply({ content: `${CONFIG.commands.invalidAmountText}.`, ephemeral: true });
  }

  if (amount > bal) {
    return interaction.reply({ content: `You only have **${store.formatNumber(bal)}**`, ephemeral: true });
  }

  const seconds = parseDurationPart(rawSeconds, 'Seconds', 0, 60);
  if (!seconds.ok) return interaction.reply({ content: seconds.error, ephemeral: true });

  const minutes = parseDurationPart(rawMinutes, 'Minutes', 0, 60);
  if (!minutes.ok) return interaction.reply({ content: minutes.error, ephemeral: true });

  const hours = parseDurationPart(rawHours, 'Hours', 0, 24);
  if (!hours.ok) return interaction.reply({ content: hours.error, ephemeral: true });

  const days = parseDurationPart(rawDays, 'Days', 0, 365);
  if (!days.ok) return interaction.reply({ content: days.error, ephemeral: true });

  const durationSeconds =
    seconds.value +
    (minutes.value * 60) +
    (hours.value * 3600) +
    (days.value * 86400);

  if (durationSeconds <= 0) {
    return interaction.reply({ content: 'Duration must be greater than 0 seconds.', ephemeral: true });
  }

  const giveawayChannel = await interaction.client.channels.fetch(GIVEAWAY_CHANNEL_ID).catch(() => null);
  if (!giveawayChannel) {
    return interaction.reply({ content: 'Could not find the giveaway channel. Please check channel permissions/ID.', ephemeral: true });
  }

  store.setBalance(userId, bal - amount);

  const durationMs = durationSeconds * 1000;
  const giveaway = store.createGiveaway(userId, amount, durationMs, GIVEAWAY_CHANNEL_ID, giveawayNote);

  const endTime = Math.floor((Date.now() + durationMs) / 1000);
  const rows = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`giveaway_join_${giveaway.id}`).setLabel('Join Giveaway').setStyle(ButtonStyle.Success),
  );

  const giveawayPostMessage = await giveawayChannel.send({
    content:
      `🎉 **GIVEAWAY STARTED!**\n\nHost: <@${userId}>\nPrize Pool: **${store.formatNumber(amount)}** coins\n` +
      `${giveaway.message ? `Message: ${giveaway.message}\n` : ''}` +
      `Participants: 0\nEnds: <t:${endTime}:R>\n\nUse the button below to join!`,
    components: [rows],
  });

  store.setGiveawayMessageRef(giveaway.id, giveawayPostMessage.id, GIVEAWAY_CHANNEL_ID);

  return interaction.reply({ content: `Giveaway posted in <#${GIVEAWAY_CHANNEL_ID}>.`, ephemeral: true });
}

async function handleGiveawayJoin(interaction, giveawayId) {
  const userId = interaction.user.id;
  const giveaway = store.getGiveaway(giveawayId);
  
  if (!giveaway) {
    return interaction.reply({ content: '❌ Giveaway not found or has already ended.', ephemeral: true });
  }
  
  if (Date.now() > giveaway.expiresAt) {
    return interaction.reply({ content: '❌ Giveaway has ended.', ephemeral: true });
  }
  
  if (giveaway.participants.includes(userId)) {
    return interaction.reply({ content: '⚠️ You already joined this giveaway!', ephemeral: true });
  }
  
  if (userId === giveaway.initiatorId) {
    return interaction.reply({ content: '⚠️ You cannot join your own giveaway!', ephemeral: true });
  }
  
  store.joinGiveaway(giveawayId, userId);
  await interaction.deferUpdate();
  const endTime = Math.floor(giveaway.expiresAt / 1000);
  await interaction.editReply({
    content:
      `🎉 **GIVEAWAY STARTED!**\n\nHost: <@${giveaway.initiatorId}>\nPrize Pool: **${store.formatNumber(giveaway.amount)}** coins\n` +
      `${giveaway.message ? `Message: ${giveaway.message}\n` : ''}` +
      `Participants: ${giveaway.participants.length}\nEnds: <t:${endTime}:R>\n\nUse the button below to join!`,
    components: interaction.message.components,
  });
  return interaction.followUp({
    content: `✅ You joined the giveaway! Participants: ${giveaway.participants.length}`,
    ephemeral: true,
  });
}

function expireTradeSessions(ttlMs) {
  const now = Date.now();
  let expired = 0;
  for (const [key, trade] of activeTrades) {
    if (trade.createdAt && now - trade.createdAt > ttlMs) {
      activeTrades.delete(key);
      expired++;
    }
  }
  if (expired > 0) persistTradeSessions();
  return expired;
}

module.exports = {
  activeTrades,
  handleBalance, handleDaily, handleDeposit, handleWithdraw, handleBank, handleBankButton,
  handleGive, handleTrade, handleLeaderboard,
  handleInventory, handleInventoryButton, handleCollection, handlePool,
  handleTradeButton,
  handleTradeSelectMenu, handleTradeModal,
  handleGiveawayStart, handleGiveawayModal, handleGiveawayJoin,
  expireTradeSessions,
};
