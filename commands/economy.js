const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, AttachmentBuilder } = require('discord.js');
const { CONFIG, RARITIES } = require('../config');
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
      name: '🏦 Bank Interest',
      value: `> ${bar(iLvl, maxLevel)} **Lv ${iLvl}/${maxLevel}**\n> Rate: **${(iRate * 100).toFixed(2)}%**/day (hourly)\n> ${iCost ? `Next: **${((iBaseRate + 0.01) * 100).toFixed(2)}%** for **${store.formatNumber(iCost)}**` : '✨ **MAXED**'}`,
      inline: true,
    },
    {
      name: 'Loss Cashback',
      value: `> ${bar(cLvl, maxLevel)} **Lv ${cLvl}/${maxLevel}**\n> Rate: **${cRatePct.toFixed(2)}%** back\n> ${cCost ? `Next: **${(cBaseRatePct + 0.1).toFixed(2)}%** for **${store.formatNumber(cCost)}**` : '✨ **MAXED**'}`,
      inline: true,
    },
    { name: '\u200b', value: '\u200b', inline: false },
    {
      name: 'Spin Payout Mult',
      value: `> ${bar(sLvl, maxLevel)} **Lv ${sLvl}/${maxLevel}**\n> Multiplier: **${sMult.toFixed(1)}x** payout\n> ${sCost ? `Next: **${(sMult + 0.1).toFixed(1)}x** for **${store.formatNumber(sCost)}**` : '✨ **MAXED**'}`,
      inline: true,
    },
    {
      name: 'Double Universal Income Chance',
      value: `> ${bar(uLvl, maxLevel)} **Lv ${uLvl}/${maxLevel}**\n> Chance: **${uChance.toFixed(2)}%** to double\n> ${uCost ? `Next: **${(((uLvl + 1) * CONFIG.economy.upgrades.universalIncomePerLevelChance) * 100).toFixed(0)}%** for **${store.formatNumber(uCost)}**` : '✨ **MAXED**'}`,
      inline: true,
    },
    { name: '\u200b', value: '\u200b', inline: false },
  ];

  let inventoryText;
  if (bonuses.inventoryEffects.length === 0) {
    inventoryText = '> No active item boosts yet\n> Use **/mysterybox** to buy collectible boxes!';
  } else {
    inventoryText = bonuses.inventoryEffects.slice(0, 5).map((line) => `> ${line}`).join('\n');
  }
  fields.push({ name: '🎒 Item & Collection Effects', value: inventoryText, inline: false });

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
      .setLabel(iCost ? `Interest (${store.formatNumberShort(iCost)})` : 'Interest MAXED')
      .setStyle(iCost ? ButtonStyle.Success : ButtonStyle.Secondary).setDisabled(!iCost || w.balance < iCost),
    new ButtonBuilder().setCustomId(`upgrade_cashback_${userId}`)
      .setLabel(cCost ? `Cashback (${store.formatNumberShort(cCost)})` : 'Cashback MAXED')
      .setStyle(cCost ? ButtonStyle.Success : ButtonStyle.Secondary).setDisabled(!cCost || w.balance < cCost),
  ));
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`upgrade_spinmult_${userId}`)
      .setLabel(sCost ? `Spin Payout Mult (${store.formatNumberShort(sCost)})` : 'Spin Payout Mult MAXED')
      .setStyle(sCost ? ButtonStyle.Success : ButtonStyle.Secondary).setDisabled(!sCost || w.balance < sCost),
    new ButtonBuilder().setCustomId(`upgrade_universalmult_${userId}`)
      .setLabel(uCost ? `Double Universal Income Chance (${store.formatNumberShort(uCost)})` : 'Double Universal Income Chance MAXED')
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
  let t = `**Trade**\n\n<@${trade.initiatorId}> offers:\n Coins: ${store.formatNumber(trade.initiatorOffer.coins)}`;
  if (trade.initiatorOffer.items.length) t += `\n Items: ${trade.initiatorOffer.items.map(i => `${i.emoji} ${i.name}`).join(', ')}`;
  t += `\n\n<@${trade.targetId}> offers:\n Coins: ${store.formatNumber(trade.targetOffer.coins)}`;
  if (trade.targetOffer.items.length) t += `\n Items: ${trade.targetOffer.items.map(i => `${i.emoji} ${i.name}`).join(', ')}`;
  t += `\n\n${trade.initiatorConfirmed ? '✅' : '⬜'} <@${trade.initiatorId}> | ${trade.targetConfirmed ? '✅' : '⬜'} <@${trade.targetId}>`;
  return t;
}

async function updateTradeMessage(interaction, trade) {
  const channelId = trade.channelId || interaction.channelId;
  if (!channelId || !trade.messageId) return false;
  const channel = await interaction.client.channels.fetch(channelId).catch(() => null);
  if (!channel) return false;
  const message = await channel.messages.fetch(trade.messageId).catch(() => null);
  if (!message) return false;
  await message.edit({ content: renderTradeView(trade), components: renderTradeButtons(trade) }).catch(() => null);
  return true;
}

function buildInventoryText(username, inventory, safePage, total, perPage) {
  const items = inventory.slice(safePage * perPage, (safePage + 1) * perPage);
  const counts = Object.fromEntries(RARITY_ORDER.map(r => [r, 0]));
  inventory.forEach(i => { if (counts[i.rarity] !== undefined) counts[i.rarity]++; });

  let text = `**${username}'s Inventory** (${inventory.length} items) - Page ${safePage + 1}/${total}\n\n`;
  text += `${RARITIES.common.emoji} ${counts.common} common | ${RARITIES.uncommon.emoji} ${counts.uncommon} uncommon | ${RARITIES.rare.emoji} ${counts.rare} rare | ${RARITIES.legendary.emoji} ${counts.legendary} legendary | ${RARITIES.epic.emoji} ${counts.epic} epic | ${RARITIES.mythic.emoji} ${counts.mythic} mythic | ${RARITIES.divine.emoji} ${counts.divine} divine\n\n`;
  items.forEach(it => { text += `${it.emoji} ${it.name}\n`; });
  return text;
}

function buildInventoryButtons(userId, safePage, total) {
  if (total <= 1) return [];
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`invpage_${userId}_${safePage - 1}`)
        .setLabel('Previous')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(safePage <= 0),
      new ButtonBuilder()
        .setCustomId(`invpage_${userId}_${safePage + 1}`)
        .setLabel('Next')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(safePage >= total - 1),
    ),
  ];
}

// Build a select menu from a player's inventory for adding items
function buildItemSelectMenu(userId, trade, isInit) {
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
  const w = store.getWallet(userId);
  const pp = payout > 0 ? `\n+**${store.formatNumber(payout)}** collected!` : '';
  if (w.bank <= 0) return interaction.reply(`Bank empty. Use /deposit or /invest.`);
  const rate = store.getInterestRate(userId), daily = Math.floor(w.bank * rate);
  const hourly = Math.floor(w.bank * rate / 24);
  const last = w.lastBankPayout || Date.now(), next = last + 3600000;
  const rem = Math.max(0, next - Date.now());
  const mins = Math.floor(rem / 60000);
  return interaction.reply(`**Bank**\n\nDeposited: **${store.formatNumber(w.bank)}**\nRate: ${(rate * 100).toFixed(2)}% daily (Lv ${w.interestLevel || 0})\nHourly: ~**${store.formatNumber(hourly)}** | Daily: ~**${store.formatNumber(daily)}**\nNext payout: ${mins}m${pp}\n\nPurse: **${store.formatNumber(w.balance)}**`);
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
    initiatorOffer: { coins: 0, items: [] }, targetOffer: { coins: 0, items: [] },
    initiatorConfirmed: false, targetConfirmed: false,
  };
  activeTrades.set(userId, trade);
  const msg = await interaction.reply({
    content: renderTradeView(trade) + `\n\nBoth players can set coins, add/remove items, then both confirm.`,
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
  const items = [];
  let totalCompensation = 0;
  
  for (let i = 0; i < quantity; i++) {
    const item = store.rollMysteryBox(userId);
    
    // Check if this is a duplicate placeholder
    if (item.id && item.id.startsWith('placeholder_')) {
      const isDuplicate = w.inventory.some(inv => inv.id === item.id);
      if (isDuplicate) {
        // Give compensation instead of duplicate
        const compensation = store.getDuplicateCompensation(item.id, item._rarity);
        w.balance += compensation;
        store.trackMysteryBoxDuplicateComp(userId, compensation);
        totalCompensation += compensation;
        items.push({ ...item, isDuplicate: true, compensation });
        continue;
      }
    }
    
    w.inventory.push({ id: item.id, name: item.name, rarity: item.rarity, emoji: item.emoji, obtainedAt: Date.now() });
    items.push(item);
  }
  
  store.saveWallets();
  
  if (quantity === 1) {
    const item = items[0];
    if (item.isDuplicate) {
      return interaction.reply(`${item.emoji} **Mystery Box - DUPLICATE**\n\nYou already have: **${item.name}**\nCompensation: **${store.formatNumber(item.compensation)}** coins\nNew Balance: **${store.formatNumber(w.balance)}**`);
    }
    return interaction.reply(`${item.emoji} **Mystery Box**\n\nYou got: **${item.name}** (${item.rarity})\nBalance: **${store.formatNumber(w.balance)}**`);
  }
  
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
  summary += `\nBalance: **${store.formatNumber(w.balance)}**`;
  return interaction.reply(summary);
}

async function handleInventory(interaction) {
  const userId = interaction.user.id, username = interaction.user.username;
  const w = store.getWallet(userId);
  const page = (interaction.options.getInteger('page') || 1) - 1;
  const perPage = CONFIG.commands.limits.inventoryPerPage;
  if (!w.inventory.length) return interaction.reply("Your inventory is empty. Buy a /mysterybox!");
  const total = Math.ceil(w.inventory.length / perPage);
  const safePage = Math.max(0, Math.min(page, total - 1));
  const text = buildInventoryText(username, w.inventory, safePage, total, perPage);
  const components = buildInventoryButtons(userId, safePage, total);
  return interaction.reply({ content: text, components });
}

async function handleInventoryButton(interaction, parts) {
  const userId = parts[1];
  if (interaction.user.id !== userId) return interaction.reply({ content: "Not your inventory!", ephemeral: true });

  const requestedPage = parseInt(parts[2], 10);
  const w = store.getWallet(userId);
  if (!w.inventory.length) return interaction.update({ content: "Your inventory is empty. Buy a /mysterybox!", components: [] });

  const perPage = CONFIG.commands.limits.inventoryPerPage;
  const total = Math.ceil(w.inventory.length / perPage);
  const safePage = Math.max(0, Math.min(Number.isNaN(requestedPage) ? 0 : requestedPage, total - 1));
  const username = interaction.user.username;
  const text = buildInventoryText(username, w.inventory, safePage, total, perPage);
  const components = buildInventoryButtons(userId, safePage, total);
  return interaction.update({ content: text, components });
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
    const menu = buildItemSelectMenu(interaction.user.id, trade, isInit);
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
      return interaction.update({ content: `**Trade Complete!** <@${trade.initiatorId}> ↔ <@${trade.targetId}>`, components: [] });
    }
    return interaction.update({ content: renderTradeView(trade), components: renderTradeButtons(trade) });
  }
  if (action === 'cancel') {
    activeTrades.delete(tradeKey);
    persistTradeSessions();
    return interaction.update({ content: "Trade cancelled.", components: [] });
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

    await updateTradeMessage(interaction, trade);
    return interaction.update({ content: `Added **${item.name}** to your offer!`, components: [] });
  }

  if (action === 'unselectitem') {
    const offerIdx = parseInt(interaction.values[0]);
    if (offerIdx >= offer.items.length) return interaction.reply({ content: "Invalid!", ephemeral: true });
    const removed = offer.items.splice(offerIdx, 1)[0];
    trade.initiatorConfirmed = false; trade.targetConfirmed = false;
    persistTradeSessions();
    await updateTradeMessage(interaction, trade);
    return interaction.update({ content: `Removed **${removed.name}** from your offer!`, components: [] });
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

  return interaction.update({ content: renderTradeView(trade), components: renderTradeButtons(trade) });
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

module.exports = {
  activeTrades,
  handleBalance, handleDaily, handleDeposit, handleWithdraw, handleBank,
  handleGive, handleTrade, handleLeaderboard, handleUpgrades,
  handleMysteryBox, handleInventory, handleInventoryButton, handleCollection, handlePool,
  handleUpgradeButton, handleTradeButton,
  handleTradeSelectMenu, handleTradeModal,
  handleGiveawayStart, handleGiveawayModal, handleGiveawayJoin,
};
