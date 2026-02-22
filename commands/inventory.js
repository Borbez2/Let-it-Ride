const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { CONFIG, RARITIES } = require('../config');
const store = require('../data/store');

const RARITY_ORDER = CONFIG.ui.rarityOrder;
const INVENTORY_TABS = ['overview', ...RARITY_ORDER];

// ── Buff helpers ──

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

// ── Navigation ──

function parseInventoryCustomId(customId) {
  const parts = customId.split('_');
  if (parts.length < 4) return null;
  return { tab: parts[1], page: parseInt(parts[2], 10) || 0, userId: parts[3] };
}

function buildInventoryNavRow(userId, activeTab) {
  const row = new ActionRowBuilder();
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

function buildInventoryNavRow2(userId, activeTab) {
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
      .setLabel('Prev')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 0),
    new ButtonBuilder()
      .setCustomId(`inv_${tab}_${page + 1}_${userId}`)
      .setLabel('Next')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages - 1),
  );
  return row;
}

// ── Render pages ──

function renderInventoryOverview(userId, username) {
  const cs = store.getCollectionStats(userId);
  const globalBar = renderCollectionBar(cs.totalOwned, cs.totalItems, '▰', '▱', 20);
  let description = `> **${username}'s Collection**\n> ${globalBar} **${cs.totalOwned}/${cs.totalItems}**\n\n`;

  for (const rarity of RARITY_ORDER) {
    const info = cs.byRarity[rarity];
    const bar = renderCollectionBar(info.owned, info.total, '▰', '▱', 10);
    const completeTag = info.complete ? ' ✨' : '';
    description += `> ${RARITIES[rarity].emoji} **${rarity.charAt(0).toUpperCase() + rarity.slice(1)}** ${bar} ${info.owned}/${info.total}${completeTag}\n`;
  }

  const t = cs.totals;
  description += `\n**Total Stat Boosts**\n`;
  description += `> ∑ Interest: **+${fmtPct(t.interestRate, '/day')}**\n`;
  description += `> ↩ Cashback: **+${fmtPct(t.cashbackRate)}**\n`;
  description += `> ⛁⌖ Mines Save: **+${fmtPct(t.minesRevealChance)}**\n`;
  description += `> ∀× Income Double: **+${fmtPct(t.universalDoubleChance)}**\n`;
  description += `> ⟳× Spin Payout: **+${fmtWeight(t.spinWeight)}**\n`;

  const completed = RARITY_ORDER.filter(r => cs.byRarity[r].complete);
  if (completed.length > 0) {
    description += `\n**✨ Completed Collections**\n`;
    for (const rarity of completed) {
      description += `> ${RARITIES[rarity].emoji} ${rarity.charAt(0).toUpperCase() + rarity.slice(1)} - bonus applied!\n`;
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
  const bar = renderCollectionBar(info.owned, info.total, '▰', '▱', 15);
  const completeTag = info.complete ? ' ✨ **COMPLETE** - set bonus active!' : '';

  let description = `> ${RARITIES[rarity].emoji} **${rarityLabel} Collection** ${bar} **${info.owned}/${info.total}**${completeTag}\n\n`;

  const cb = CONFIG.collectibles.mysteryBox.collectionCompleteBonus[rarity];
  if (cb) {
    const tag = info.complete ? '✨ Active' : `${info.total - info.owned} left to unlock`;
    description += `**Set Bonus** (${tag}):\n`;
    if (cb.interestRate)         description += `> - ∑ Interest: **+${fmtPct(cb.interestRate, '/day')}**\n`;
    if (cb.cashbackRate)         description += `> - ↩ Cashback: **+${fmtPct(cb.cashbackRate)}**\n`;
    if (cb.minesRevealChance)    description += `> - ⛁⌖ Mines Save: **+${fmtPct(cb.minesRevealChance)}**\n`;
    if (cb.universalDoubleChance)description += `> - ∀× Income Double: **+${fmtPct(cb.universalDoubleChance)}**\n`;
    if (cb.spinWeight)           description += `> - ⟳× Spin Payout: **+${fmtWeight(cb.spinWeight)}**\n`;
  }
  description += '\n';

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
    description += `**Stat Boosts from this Rarity**\n`;
    description += `> Currently: ${ownedBoostLines.join('  ')}\n`;
    description += `> Full set:   ${fullBoostLines.join('  ')}\n`;
    description += '\n';
  }

  for (const item of allItems) {
    const owned = cs.ownedIds.has(item.id);
    const buffStr = formatItemBuffDisplay(getItemDisplayBuff(item, allItems));
    if (owned) {
      description += `${item.emoji} **${item.name}** - *${buffStr}*\n`;
    } else {
      description += `⬛ ~~${item.name}~~ - *${buffStr}*\n`;
    }
  }

  return {
    embeds: [{
      title: `🎒 Inventory - ${rarityLabel}`,
      color: 0x2b2d31,
      description,
    }],
    page: 0,
    totalPages: 1,
  };
}

function buildInventoryComponents(userId, tab, page, totalPages) {
  const rows = [
    buildInventoryNavRow(userId, tab),
    buildInventoryNavRow2(userId, tab),
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

// ── Handlers ──

async function handleInventory(interaction) {
  const userId = interaction.user.id, username = interaction.user.username;
  const result = renderInventoryPage(userId, username, 'overview', 0);
  return interaction.reply({ content: '', embeds: result.embeds, components: result.components });
}

async function handleInventoryButton(interaction, parts) {
  const parsed = parseInventoryCustomId(interaction.customId);
  if (!parsed) return;
  if (interaction.user.id !== parsed.userId) return interaction.reply({ content: 'Not your inventory!', ephemeral: true });

  const username = interaction.user.username;
  const result = renderInventoryPage(parsed.userId, username, parsed.tab, parsed.page);
  return interaction.update({ content: '', embeds: result.embeds, components: result.components });
}

module.exports = { handleInventory, handleInventoryButton };
