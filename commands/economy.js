const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const {
  MYSTERY_BOX_COST, UPGRADE_COSTS, SPIN_MULT_COSTS,
  BASE_INVEST_RATE, RARITIES,
} = require('../config');
const store = require('../data/store');

const activeTrades = new Map();

// ─── Upgrades page ───
function renderUpgradesPage(userId) {
  const w = store.getWallet(userId);
  const iLvl = w.interestLevel || 0, cLvl = w.cashbackLevel || 0, sLvl = w.spinMultLevel || 0;
  const iRate = BASE_INVEST_RATE + (iLvl * 0.01), cRate = cLvl * 0.1, sW = 1 + sLvl;
  const iCost = iLvl < 10 ? UPGRADE_COSTS[iLvl] : null;
  const cCost = cLvl < 10 ? UPGRADE_COSTS[cLvl] : null;
  const sCost = sLvl < 10 ? SPIN_MULT_COSTS[sLvl] : null;

  let text = `**Upgrades**\n\nPurse: ${store.formatNumber(w.balance)} coins\n\n--------------------\n\n`;
  text += `**Bank Interest** Lv ${iLvl}/10 — ${(iRate * 100).toFixed(0)}% daily (hourly)\n`;
  text += iCost ? `Next: ${((iRate + 0.01) * 100).toFixed(0)}% for ${store.formatNumber(iCost)}\n\n` : `MAXED\n\n`;
  text += `**Loss Cashback** Lv ${cLvl}/10 — ${cRate.toFixed(1)}% back\n`;
  text += cCost ? `Next: ${(cRate + 0.1).toFixed(1)}% for ${store.formatNumber(cCost)}\n\n` : `MAXED\n\n`;
  text += `**Daily Spin Mult** Lv ${sLvl}/10 — ${sW}x weight\n`;
  text += sCost ? `Next: ${sW + 1}x for ${store.formatNumber(sCost)}\n\n` : `MAXED\n\n`;
  text += `Use **/mysterybox** to buy collectible boxes!\n`;

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
      .setLabel(sCost ? `Spin Mult (${store.formatNumberShort(sCost)})` : 'Spin Mult MAXED')
      .setStyle(sCost ? ButtonStyle.Success : ButtonStyle.Secondary).setDisabled(!sCost || w.balance < sCost),
    new ButtonBuilder().setCustomId(`upgrade_coming1_${userId}`)
      .setLabel('Lucky Bonus - Soon').setStyle(ButtonStyle.Secondary).setDisabled(true),
  ));
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`upgrade_refresh_${userId}`).setLabel('Refresh').setStyle(ButtonStyle.Primary),
  ));
  return { text, rows };
}

// ─── Trade rendering ───
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

// Build a select menu from a player's inventory for adding items
function buildItemSelectMenu(userId, trade, isInit) {
  const inv = store.getWallet(userId).inventory;
  const offer = isInit ? trade.initiatorOffer : trade.targetOffer;
  const usedIndices = new Set(offer.items.map(i => i._idx));

  const available = inv
    .map((item, idx) => ({ item, idx }))
    .filter(e => !usedIndices.has(e.idx))
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

// ═══════ SLASH COMMAND HANDLERS ═══════

async function handleBalance(interaction) {
  const userId = interaction.user.id, username = interaction.user.username;
  const payout = store.processBank(userId);
  const w = store.getWallet(userId);
  const sk = w.streak > 0 ? ` | 🔥 ${w.streak}` : '';
  const bk = w.bank > 0 ? `\nBank: **${store.formatNumber(w.bank)}**` : '';
  const pp = payout > 0 ? `\n+**${store.formatNumber(payout)}** interest!` : '';
  return interaction.reply(`**${username}**${sk}\n\nPurse: **${store.formatNumber(w.balance)}**${bk}\nTotal: **${store.formatNumber(w.balance + (w.bank || 0))}**${pp}`);
}

async function handleDaily(interaction) {
  const userId = interaction.user.id;
  const { DAILY_STREAK_BONUS } = require('../config');
  const c = store.checkDaily(userId);
  if (!c.canClaim) return interaction.reply(`Already claimed. **${c.hours}h ${c.mins}m** left\n🔥 Streak: ${c.streak}`);
  const r = store.claimDaily(userId);
  const sm = r.streak > 1 ? `\n🔥 ${r.streak} day streak! (+${store.formatNumber(DAILY_STREAK_BONUS * (r.streak - 1))} bonus)` : '';
  return interaction.reply(`Claimed **${store.formatNumber(r.reward)}** coins!${sm}\nBalance: **${store.formatNumber(r.newBalance)}**`);
}

async function handleDeposit(interaction) {
  const userId = interaction.user.id;
  const rawAmount = interaction.options.getString('amount');
  const bal = store.getBalance(userId);
  
  // Parse the amount (supports "all", "1k", "1m", etc.)
  const amount = rawAmount && typeof rawAmount === 'string' 
    ? store.parseAmount(rawAmount, bal)
    : interaction.options.getInteger('amount');
  
  if (!amount || amount <= 0) {
    return interaction.reply('Invalid amount. Use a number, "1k", "1m", or "all"');
  }
  
  if (amount > bal) return interaction.reply(`You only have **${store.formatNumber(bal)}**`);
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
  const w = store.getWallet(userId);
  
  // Parse the amount (supports "all", "1k", "1m", etc.)
  const amount = rawAmount && typeof rawAmount === 'string'
    ? store.parseAmount(rawAmount, w.bank)
    : interaction.options.getInteger('amount');
  
  if (!amount || amount <= 0) {
    return interaction.reply('Invalid amount. Use a number, "1k", "1m", or "all"');
  }
  
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
  return interaction.reply(`**Bank**\n\nDeposited: **${store.formatNumber(w.bank)}**\nRate: ${(rate * 100).toFixed(0)}% daily (Lv ${w.interestLevel || 0})\nHourly: ~**${store.formatNumber(hourly)}** | Daily: ~**${store.formatNumber(daily)}**\nNext payout: ${mins}m${pp}\n\nPurse: **${store.formatNumber(w.balance)}**`);
}

async function handleGive(interaction) {
  const userId = interaction.user.id, username = interaction.user.username;
  const target = interaction.options.getUser('user');
  const rawAmount = interaction.options.getString('amount');
  const bal = store.getBalance(userId);
  
  const amount = store.parseAmount(rawAmount, bal);
  if (!amount || amount <= 0) {
    return interaction.reply('Invalid amount. Use a number, "1k", "1m", or "all"');
  }
  
  if (target.id === userId) return interaction.reply("Can't give to yourself");
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
  return interaction.reply({
    content: renderTradeView(trade) + `\n\nBoth players can set coins, add/remove items, then both confirm.`,
    components: renderTradeButtons(trade),
  });
}

async function handleLeaderboard(interaction, client) {
  const wallets = store.getAllWallets();
  const entries = Object.entries(wallets)
    .map(([id, d]) => ({ id, balance: d.balance || 0, bank: d.bank || 0 }))
    .sort((a, b) => (b.balance + b.bank) - (a.balance + a.bank)).slice(0, 10);
  if (!entries.length) return interaction.reply("No players yet!");

  let board = "**Leaderboard**\n```\nRank Player          Purse       Bank        Total\n---- -------------- ----------- ----------- -----------\n";
  const medals = ['🥇', '🥈', '🥉'];
  for (let i = 0; i < entries.length; i++) {
    const u = await client.users.fetch(entries[i].id).catch(() => null);
    const nm = (u ? u.username : "Unknown").substring(0, 14).padEnd(14);
    const rk = (i < 3 ? medals[i] : `${i + 1}.`).padEnd(4);
    board += `${rk} ${nm} ${store.formatNumber(entries[i].balance).padStart(11)} ${store.formatNumber(entries[i].bank).padStart(11)} ${store.formatNumber(entries[i].balance + entries[i].bank).padStart(11)}\n`;
  }
  board += "```";
  return interaction.reply(board);
}

async function handleUpgrades(interaction) {
  const { text, rows } = renderUpgradesPage(interaction.user.id);
  return interaction.reply({ content: text, components: rows });
}

async function handleMysteryBox(interaction) {
  const userId = interaction.user.id;
  const quantity = interaction.options.getInteger('quantity') || 1;
  const w = store.getWallet(userId);
  const totalCost = quantity * MYSTERY_BOX_COST;
  
  if (w.balance < totalCost) {
    return interaction.reply(`Need **${store.formatNumber(totalCost)}** coins (you have ${store.formatNumber(w.balance)})`);
  }
  
  w.balance -= totalCost;
  const items = [];
  let totalCompensation = 0;
  
  for (let i = 0; i < quantity; i++) {
    const item = store.rollMysteryBox();
    
    // Check if this is a duplicate placeholder
    if (item.id && item.id.startsWith('placeholder_')) {
      const isDuplicate = w.inventory.some(inv => inv.id === item.id);
      if (isDuplicate) {
        // Give compensation instead of duplicate
        const compensation = store.getDuplicateCompensation(item.id, item._rarity);
        w.balance += compensation;
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
  for (const [rarity, rarityItems] of Object.entries(byRarity)) {
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
  const perPage = 15;
  if (!w.inventory.length) return interaction.reply("Your inventory is empty. Buy a /mysterybox!");
  const total = Math.ceil(w.inventory.length / perPage);
  const items = w.inventory.slice(page * perPage, (page + 1) * perPage);
  let text = `**${username}'s Inventory** (${w.inventory.length} items) - Page ${page + 1}/${total}\n\n`;
  const counts = { common: 0, uncommon: 0, rare: 0, legendary: 0, epic: 0, mythic: 0, divine: 0 };
  w.inventory.forEach(i => { if (counts[i.rarity] !== undefined) counts[i.rarity]++; });
  text += `⬜ ${counts.common} common | 🟩 ${counts.uncommon} uncommon | 🟦 ${counts.rare} rare | 🟨 ${counts.legendary} legendary | 🟪 ${counts.epic} epic | 🩷 ${counts.mythic} mythic | 🩵 ${counts.divine} divine\n\n`;
  items.forEach(it => { text += `${it.emoji} ${it.name}\n`; });
  return interaction.reply(text);
}

async function handleCollection(interaction, client) {
  const wallets = store.getAllWallets();
  const entries = Object.entries(wallets)
    .map(([id, d]) => ({ id, count: (d.inventory || []).length, unique: new Set((d.inventory || []).map(i => i.id)).size }))
    .filter(e => e.count > 0)
    .sort((a, b) => b.unique - a.unique || b.count - a.count).slice(0, 10);
  if (!entries.length) return interaction.reply("Nobody has collectibles yet!");
  let board = "**Collectible Leaderboard**\n```\nRank Player         Unique Total\n---- -------------- ------ -----\n";
  const medals = ['🥇', '🥈', '🥉'];
  for (let i = 0; i < entries.length; i++) {
    const u = await client.users.fetch(entries[i].id).catch(() => null);
    const nm = (u ? u.username : "Unknown").substring(0, 14).padEnd(14);
    const rk = (i < 3 ? medals[i] : `${i + 1}.`).padEnd(4);
    board += `${rk} ${nm} ${String(entries[i].unique).padStart(6)} ${String(entries[i].count).padStart(5)}\n`;
  }
  board += "```";
  return interaction.reply(board);
}

async function handlePool(interaction) {
  const poolData = store.getPoolData();
  const wallets = store.getAllWallets();
  const nextHourly = poolData.lastHourlyPayout + 3600000;
  const minsH = Math.max(0, Math.floor((nextHourly - Date.now()) / 60000));
  const players = Object.keys(wallets).length;
  const share = players > 0 ? Math.floor(poolData.universalPool / players) : 0;
  let text = `**Universal Pool**\nTotal: **${store.formatNumber(poolData.universalPool)}** coins\nPlayers: ${players} | Your share: ~**${store.formatNumber(share)}**\nNext payout: ${minsH}m\n\n`;
  text += `**Daily Spin Pool**\nTotal: **${store.formatNumber(poolData.lossPool)}** coins\nSpins daily at 12pm, weighted by Spin Mult upgrade`;
  return interaction.reply(text);
}

// ═══════ BUTTON HANDLERS ═══════

async function handleUpgradeButton(interaction, parts) {
  const action = parts[1], uid = parts[2];
  if (interaction.user.id !== uid) return interaction.reply({ content: "Not yours!", ephemeral: true });
  const w = store.getWallet(uid);

  if (action === 'refresh') {
    const { text, rows } = renderUpgradesPage(uid);
    return interaction.update({ content: text, components: rows });
  }
  if (action === 'interest') {
    const lvl = w.interestLevel || 0;
    if (lvl >= 10) return interaction.reply({ content: "Maxed!", ephemeral: true });
    const cost = UPGRADE_COSTS[lvl];
    if (w.balance < cost) return interaction.reply({ content: `Need ${store.formatNumber(cost)}`, ephemeral: true });
    w.balance -= cost; w.interestLevel = lvl + 1; store.saveWallets();
    const { text, rows } = renderUpgradesPage(uid);
    return interaction.update({ content: text + `\n✅ Interest → Lv ${w.interestLevel}`, components: rows });
  }
  if (action === 'cashback') {
    const lvl = w.cashbackLevel || 0;
    if (lvl >= 10) return interaction.reply({ content: "Maxed!", ephemeral: true });
    const cost = UPGRADE_COSTS[lvl];
    if (w.balance < cost) return interaction.reply({ content: `Need ${store.formatNumber(cost)}`, ephemeral: true });
    w.balance -= cost; w.cashbackLevel = lvl + 1; store.saveWallets();
    const { text, rows } = renderUpgradesPage(uid);
    return interaction.update({ content: text + `\n✅ Cashback → Lv ${w.cashbackLevel}`, components: rows });
  }
  if (action === 'spinmult') {
    const lvl = w.spinMultLevel || 0;
    if (lvl >= 10) return interaction.reply({ content: "Maxed!", ephemeral: true });
    const cost = SPIN_MULT_COSTS[lvl];
    if (w.balance < cost) return interaction.reply({ content: `Need ${store.formatNumber(cost)}`, ephemeral: true });
    w.balance -= cost; w.spinMultLevel = lvl + 1; store.saveWallets();
    const { text, rows } = renderUpgradesPage(uid);
    return interaction.update({ content: text + `\n✅ Spin Mult → Lv ${w.spinMultLevel} (${1 + w.spinMultLevel}x)`, components: rows });
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
    if (trade.initiatorConfirmed && trade.targetConfirmed) {
      const iw = store.getWallet(trade.initiatorId), tw = store.getWallet(trade.targetId);
      if (iw.balance < trade.initiatorOffer.coins || tw.balance < trade.targetOffer.coins) {
        activeTrades.delete(tradeKey);
        return interaction.update({ content: "Trade failed, not enough coins.", components: [] });
      }
      // Validate all offered items still exist in inventories
      for (const item of trade.initiatorOffer.items) {
        if (item._idx >= iw.inventory.length || iw.inventory[item._idx].id !== item.id) {
          activeTrades.delete(tradeKey);
          return interaction.update({ content: "Trade failed, inventory changed.", components: [] });
        }
      }
      for (const item of trade.targetOffer.items) {
        if (item._idx >= tw.inventory.length || tw.inventory[item._idx].id !== item.id) {
          activeTrades.delete(tradeKey);
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

      store.saveWallets(); activeTrades.delete(tradeKey);
      return interaction.update({ content: `**Trade Complete!** <@${trade.initiatorId}> ↔ <@${trade.targetId}>`, components: [] });
    }
    return interaction.update({ content: renderTradeView(trade), components: renderTradeButtons(trade) });
  }
  if (action === 'cancel') {
    activeTrades.delete(tradeKey);
    return interaction.update({ content: "Trade cancelled.", components: [] });
  }
}

// Handle the select menu interactions for trades
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
    
    // Find the original trade message in the channel and update it
    try {
      await interaction.deferReply({ ephemeral: true });
      // Send confirmation to user
      await interaction.followUp({ content: `Added **${item.name}** to your offer!`, ephemeral: true });
    } catch (e) {
      // Fallback if message can't be found
      await interaction.reply({ content: `Added **${item.name}** to your offer!`, ephemeral: true });
    }
    return;
  }

  if (action === 'unselectitem') {
    const offerIdx = parseInt(interaction.values[0]);
    if (offerIdx >= offer.items.length) return interaction.reply({ content: "Invalid!", ephemeral: true });
    const removed = offer.items.splice(offerIdx, 1)[0];
    trade.initiatorConfirmed = false; trade.targetConfirmed = false;
    try {
      await interaction.deferReply({ ephemeral: true });
      await interaction.followUp({ content: `Removed **${removed.name}** from your offer!`, ephemeral: true });
    } catch (e) {
      await interaction.reply({ content: `Removed **${removed.name}** from your offer!`, ephemeral: true });
    }
    return;
  }
}

// Handle the modal submission for setting coin amounts
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

  return interaction.update({ content: renderTradeView(trade), components: renderTradeButtons(trade) });
}

// ═══════ GIVEAWAY HANDLERS ═══════

async function handleGiveawayStart(interaction) {
  const userId = interaction.user.id;
  const rawAmount = interaction.options.getString('amount');
  const durationMinutes = interaction.options.getInteger('duration');
  const bal = store.getBalance(userId);
  
  const amount = store.parseAmount(rawAmount, bal);
  if (!amount || amount <= 0) {
    return interaction.reply('Invalid amount. Use a number, "1k", "1m", or "all"');
  }
  
  if (amount > bal) {
    return interaction.reply(`You only have **${store.formatNumber(bal)}**`);
  }
  
  if (durationMinutes < 1 || durationMinutes > 1440) {
    return interaction.reply('Duration must be between 1 and 1440 minutes (1 day)');
  }
  
  // Deduct the amount from user balance
  store.setBalance(userId, bal - amount);
  
  // Create the giveaway
  const durationMs = durationMinutes * 60 * 1000;
  const giveaway = store.createGiveaway(userId, amount, durationMs);
  
  const endTime = Math.floor((Date.now() + durationMs) / 1000);
  const rows = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`giveaway_join_${giveaway.id}`).setLabel('Join Giveaway').setStyle(ButtonStyle.Success),
  );
  
  return interaction.reply({
    content: `🎉 **GIVEAWAY STARTED!**\n\nHost: <@${userId}>\nPrize Pool: **${store.formatNumber(amount)}** coins\nParticipants: 1\nEnds: <t:${endTime}:R>\n\nUse the button below to join!`,
    components: [rows],
  });
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
  
  store.joinGiveaway(giveawayId, userId);
  return interaction.reply({
    content: `✅ You joined the giveaway! Participants: ${giveaway.participants.length + 1}`,
    ephemeral: true,
  });
}

// ═══════ EVENT BETTING HANDLERS ═══════

async function handleEventBetStart(interaction) {
  const userId = interaction.user.id;
  const description = interaction.options.getString('description');
  const durationMinutes = interaction.options.getInteger('duration');
  
  if (durationMinutes < 1 || durationMinutes > 1440) {
    return interaction.reply('Duration must be between 1 and 1440 minutes (1 day)');
  }
  
  // Create the event
  const durationMs = durationMinutes * 60 * 1000;
  const event = store.createEvent(userId, description, durationMs);
  
  const endTime = Math.floor((Date.now() + durationMs) / 1000);
  const rows = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`eventbet_predict_${event.id}`).setLabel('Make Prediction').setStyle(ButtonStyle.Primary),
  );
  
  return interaction.reply({
    content: `📊 **EVENT BETTING OPENED**\n\n**${description}**\nCreator: <@${userId}>\nEnds: <t:${endTime}:R>\n\nClick to make your prediction!`,
    components: [rows],
  });
}

async function handleEventBetPredict(interaction, eventId) {
  const userId = interaction.user.id;
  const event = store.getEvent(eventId);
  
  if (!event) {
    return interaction.reply({ content: '❌ Event not found or has ended.', ephemeral: true });
  }
  
  if (Date.now() > event.expiresAt) {
    return interaction.reply({ content: '❌ Event betting has ended.', ephemeral: true });
  }
  
  // Create modal for prediction and amount
  const modal = new ModalBuilder()
    .setCustomId(`eventbet_modal_${eventId}_${userId}`)
    .setTitle('Make Prediction')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('prediction')
          .setLabel('Your Prediction (e.g., "Yes", "Option A")')
          .setPlaceholder('Enter your prediction')
          .setStyle(TextInputStyle.Short)
          .setRequired(true),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('amount')
          .setLabel('Bet Amount (e.g., 1000, 1k, all)')
          .setPlaceholder('5000')
          .setStyle(TextInputStyle.Short)
          .setRequired(true),
      ),
    );
  
  return interaction.showModal(modal);
}

async function handleEventBetModal(interaction, eventId, userId) {
  const event = store.getEvent(eventId);
  if (!event) {
    return interaction.reply({ content: '❌ Event not found.', ephemeral: true });
  }
  
  const prediction = interaction.fields.getTextInputValue('prediction').trim();
  const rawAmount = interaction.fields.getTextInputValue('amount').trim();
  const bal = store.getBalance(userId);
  
  const amount = store.parseAmount(rawAmount, bal);
  if (!amount || amount <= 0) {
    return interaction.reply({ content: 'Invalid amount.', ephemeral: true });
  }
  
  if (amount > bal) {
    return interaction.reply({ content: `You only have **${store.formatNumber(bal)}**`, ephemeral: true });
  }
  
  // Deduct amount from user balance (they're betting)
  store.setBalance(userId, bal - amount);
  store.joinEvent(eventId, userId, prediction, amount);
  
  return interaction.reply({
    content: `✅ Placed **${store.formatNumber(amount)}** on: **${prediction}**\n\nHope you're right about the outcome!`,
    ephemeral: true,
  });
}

module.exports = {
  activeTrades,
  handleBalance, handleDaily, handleDeposit, handleWithdraw, handleBank,
  handleGive, handleTrade, handleLeaderboard, handleUpgrades,
  handleMysteryBox, handleInventory, handleCollection, handlePool,
  handleUpgradeButton, handleTradeButton,
  handleTradeSelectMenu, handleTradeModal,
  handleGiveawayStart, handleGiveawayJoin,
  handleEventBetStart, handleEventBetPredict, handleEventBetModal,
};
