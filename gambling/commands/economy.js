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
  text += `**Mystery Box** — ${store.formatNumber(MYSTERY_BOX_COST)} coins each\n`;

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
    new ButtonBuilder().setCustomId(`upgrade_mysterybox_${userId}`)
      .setLabel(`Mystery Box (${store.formatNumberShort(MYSTERY_BOX_COST)})`)
      .setStyle(ButtonStyle.Primary).setDisabled(w.balance < MYSTERY_BOX_COST),
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
  const amount = interaction.options.getInteger('amount');
  const bal = store.getBalance(userId);
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
  const amount = interaction.options.getInteger('amount');
  const w = store.getWallet(userId);
  if (amount > w.bank) return interaction.reply(`Only **${store.formatNumber(w.bank)}** in bank`);
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
  const target = interaction.options.getUser('user'), amount = interaction.options.getInteger('amount');
  const bal = store.getBalance(userId);
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
  const w = store.getWallet(userId);
  if (w.balance < MYSTERY_BOX_COST) return interaction.reply(`Need **${store.formatNumber(MYSTERY_BOX_COST)}** coins (you have ${store.formatNumber(w.balance)})`);
  w.balance -= MYSTERY_BOX_COST;
  const item = store.rollMysteryBox();
  w.inventory.push({ id: item.id, name: item.name, rarity: item.rarity, emoji: item.emoji, obtainedAt: Date.now() });
  store.saveWallets();
  return interaction.reply(`${item.emoji} **Mystery Box**\n\nYou got: **${item.name}** (${item.rarity})\nBalance: **${store.formatNumber(w.balance)}**`);
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
  const counts = { common: 0, uncommon: 0, rare: 0, legendary: 0, mythic: 0, divine: 0 };
  w.inventory.forEach(i => { if (counts[i.rarity] !== undefined) counts[i.rarity]++; });
  text += `⬜ ${counts.common} common | 🟩 ${counts.uncommon} uncommon | 🟦 ${counts.rare} rare | 🟨 ${counts.legendary} legendary | 🟪 ${counts.mythic} mythic | 🩵 ${counts.divine} divine\n\n`;
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
  if (action === 'mysterybox') {
    if (w.balance < MYSTERY_BOX_COST) return interaction.reply({ content: `Need ${store.formatNumber(MYSTERY_BOX_COST)}`, ephemeral: true });
    w.balance -= MYSTERY_BOX_COST;
    const item = store.rollMysteryBox();
    w.inventory.push({ id: item.id, name: item.name, rarity: item.rarity, emoji: item.emoji, obtainedAt: Date.now() });
    store.saveWallets();
    const { text, rows } = renderUpgradesPage(uid);
    return interaction.update({ content: text + `\n${item.emoji} Mystery Box: **${item.name}** (${item.rarity})!`, components: rows });
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
    // Update the main trade message and dismiss the ephemeral
    await interaction.update({ content: `Added **${item.name}** to your offer!`, components: [] });
    // We can't edit the original from here easily, so the next button press will refresh it
    return;
  }

  if (action === 'unselectitem') {
    const offerIdx = parseInt(interaction.values[0]);
    if (offerIdx >= offer.items.length) return interaction.reply({ content: "Invalid!", ephemeral: true });
    const removed = offer.items.splice(offerIdx, 1)[0];
    trade.initiatorConfirmed = false; trade.targetConfirmed = false;
    await interaction.update({ content: `Removed **${removed.name}** from your offer!`, components: [] });
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

module.exports = {
  activeTrades,
  handleBalance, handleDaily, handleDeposit, handleWithdraw, handleBank,
  handleGive, handleTrade, handleLeaderboard, handleUpgrades,
  handleMysteryBox, handleInventory, handleCollection, handlePool,
  handleUpgradeButton, handleTradeButton,
  handleTradeSelectMenu, handleTradeModal,
};
