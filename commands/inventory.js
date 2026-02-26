const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { CONFIG, RARITIES } = require('../config');
const store = require('../data/store');

const RARITY_ORDER = CONFIG.ui.rarityOrder;
const INVENTORY_TABS = ['overview', ...RARITY_ORDER];

// how many items to show per rarity page; chosen to stay well below Discord's
// 4096 character limit for an embed description.  The UI already included
// placeholders for paging (`page`/`totalPages`) so we finally make use of them.
const ITEMS_PER_PAGE = CONFIG.ui.inventoryItemsPerPage || 15;

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
  // everything after the third underscore is the user id (ids are numeric but
  // we guard against potential underscores in future).
  const userId = parts.slice(3).join('_');
  let page = Number(parts[2]);
  if (Number.isNaN(page) || page < 0) page = 0;
  // ensure an integer
  page = Math.trunc(page);
  return { tab: parts[1], page, userId };
}

// build dynamic navigation rows for the inventory tabs (overview + all rarities)
function buildInventoryNavRows(userId, activeTab) {
  const tabs = ['overview', ...RARITY_ORDER];
  const rows = [];
  for (let i = 0; i < tabs.length; i += 5) {
    const row = new ActionRowBuilder();
    for (const key of tabs.slice(i, i + 5)) {
      const label = key === 'overview'
        ? '◈ Overview'
        : `${RARITIES[key]?.emoji || ''} ${key.charAt(0).toUpperCase() + key.slice(1)}`;
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`inv_${key}_0_${userId}`)
          .setLabel(label)
          .setStyle(key === activeTab ? ButtonStyle.Primary : ButtonStyle.Secondary)
      );
    }
    rows.push(row);
  }
  return rows;
}

// legacy helpers removed; calls below updated

function buildInventoryPageRow(userId, tab, page, totalPages) {
  if (totalPages <= 1) return null;
  const row = new ActionRowBuilder();
  row.addComponents(
    new ButtonBuilder()
      .setCustomId(`inv_${tab}_prev_${page}_${userId}`)
      .setLabel('Prev')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 0),
    new ButtonBuilder()
      .setCustomId(`inv_${tab}_next_${page}_${userId}`)
      .setLabel('Next')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages - 1),
  );
  return row;
}

// ── Render pages ──

function renderInventoryOverview(userId, username) {
  const cs = store.getCollectionStats(userId);
  const dupeCount = store.countDuplicates(userId);
  const globalBar = renderCollectionBar(cs.totalOwned, cs.totalItems, '▰', '▱', 20);
  let description = `> **${username}'s Collection**\n> ${globalBar} **${cs.totalOwned}/${cs.totalItems}**\n`;
  if (dupeCount > 0) description += `> 📦 **${dupeCount}** duplicate(s) available to sell\n`;
  description += '\n';

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

function renderInventoryRarityPage(userId, username, rarity, page = 0) {
  const cs = store.getCollectionStats(userId);
  const info = cs.byRarity[rarity];
  if (!info) return { embeds: [{ title: '🎒 Inventory', color: 0x2b2d31, description: 'Unknown rarity.' }] };

  const allItems = info.items;
  const rarityLabel = rarity.charAt(0).toUpperCase() + rarity.slice(1);
  const bar = renderCollectionBar(info.owned, info.total, '▰', '▱', 15);
  const completeTag = info.complete ? ' ✨ **COMPLETE** - set bonus active!' : '';

  // paging calculations
  const totalItems = allItems.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / ITEMS_PER_PAGE));
  const currentPage = Math.min(Math.max(0, page || 0), totalPages - 1);
  const pageItems = allItems.slice(currentPage * ITEMS_PER_PAGE, (currentPage + 1) * ITEMS_PER_PAGE);

  let description = `> ${RARITIES[rarity].emoji} **${rarityLabel} Collection** ${bar} **${info.owned}/${info.total}**${completeTag}`;
  if (totalPages > 1) description += ` (page ${currentPage + 1}/${totalPages})`;
  description += '\n\n';

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

  // Build a map of item id -> count from user's inventory
  const w = store.getWallet(userId);
  const invCountMap = {};
  for (const inv of (w.inventory || [])) {
    invCountMap[inv.id] = inv.count || 1;
  }

  for (const item of pageItems) {
    const owned = cs.ownedIds.has(item.id);
    const buffStr = formatItemBuffDisplay(getItemDisplayBuff(item, allItems));
    const count = invCountMap[item.id] || 0;
    const countTag = count > 1 ? ` **(x${count})**` : '';
    if (owned) {
      description += `${item.emoji} **${item.name}**${countTag} - *${buffStr}*\n`;
      if (item.description) description += `> _${item.description}_\n`;
    } else {
      description += `⬛ ~~${item.name}~~ - *${buffStr}*\n`;
      if (item.description) description += `> _${item.description}_\n`;
    }
  }

  return {
    embeds: [{
      title: `🎒 Inventory - ${rarityLabel}`,
      color: 0x2b2d31,
      description,
    }],
    page: currentPage,
    totalPages,
  };
}

function buildInventoryComponents(userId, tab, page, totalPages) {
  let rows = [];
  const navRows = buildInventoryNavRows(userId, tab);
  if (Array.isArray(navRows)) rows = rows.concat(navRows);
  else rows.push(navRows);
  const pageRow = buildInventoryPageRow(userId, tab, page, totalPages || 1);
  if (pageRow) rows.push(pageRow);

  // Sell duplicates button (only if user has duplicates)
  const dupeCount = store.countDuplicates(userId);
  if (dupeCount > 0) {
    const sellRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`inv_selldups_0_${userId}`)
        .setLabel(`💰 Sell All Duplicates (${dupeCount})`)
        .setStyle(ButtonStyle.Danger),
    );
    rows.push(sellRow);
  }

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
  // allow callers to jump to a specific page when opening (1-based input)
  const requestedPage = interaction.options?.getInteger('page') || 1;
  const pageIndex = Math.max(0, requestedPage - 1);
  const result = renderInventoryPage(userId, username, 'overview', pageIndex);
  return interaction.reply({ content: '', embeds: result.embeds, components: result.components });
}

async function handleInventoryButton(interaction, parts) {
  console.log('inventory button clicked', interaction.customId, parts);
  try {
    const parsed = parseInventoryCustomId(interaction.customId);
    console.log('parsed inventory id', parsed);
    if (!parsed) {
      // respond so Discord doesn't show a "This interaction failed" message
      return interaction.reply({ content: 'Unknown inventory action.', ephemeral: true });
    }
    if (interaction.user.id !== parsed.userId) {
      // only the user who opened the inventory can navigate it
      return interaction.reply({ content: 'Not your inventory!', ephemeral: true });
    }

    // Handle sell duplicates
    if (parsed.tab === 'selldups') {
      const result = store.sellAllDuplicates(parsed.userId);
      if (result.totalItemsSold === 0) {
        return interaction.reply({ content: 'No duplicates to sell!', ephemeral: true });
      }
      const lines = [`**Sold ${result.totalItemsSold} duplicate(s) for ${store.formatNumber(result.totalCoins)} coins:**`];
      for (const entry of result.breakdown) {
        lines.push(`> ${entry.emoji} ${entry.name} x${entry.sold} → +${store.formatNumber(entry.sold * entry.refundEach)}`);
      }
      const username = interaction.user.username;
      const overviewResult = renderInventoryPage(parsed.userId, username, 'overview', 0);
      overviewResult.embeds[0].footer = { text: lines.join('\n').slice(0, 2048) };
      return interaction.update({ content: '', embeds: overviewResult.embeds, components: overviewResult.components });
    }

    const username = interaction.user.username;

    // sanity check page bounds so we can catch weird state early
    if (parsed.tab !== 'overview') {
      const cs = store.getCollectionStats(parsed.userId);
      const totalItems = cs.byRarity[parsed.tab]?.items.length || 0;
      const totalPages = Math.max(1, Math.ceil(totalItems / ITEMS_PER_PAGE));
      if (parsed.page < 0 || parsed.page >= totalPages) {
        console.warn('inventory page out of bounds', parsed); // useful when debugging
        return interaction.reply({ content: `Page ${parsed.page + 1} does not exist for ${parsed.tab}.`, ephemeral: true });
      }
    }

    const result = renderInventoryPage(parsed.userId, username, parsed.tab, parsed.page);
    return interaction.update({ content: '', embeds: result.embeds, components: result.components });
  } catch (err) {
    console.error('Inventory button handler error:', err);
    console.error('Interaction context:', {
      customId: interaction.customId,
      userId: interaction.user.id,
      parsed: parsed,
      stack: err && err.stack
    });
    if (!interaction.replied && !interaction.deferred) {
      return interaction.reply({ content: `Something went wrong with your inventory.\nError: ${err && err.message}`, ephemeral: true });
    }
  }
}

module.exports = { handleInventory, handleInventoryButton };
