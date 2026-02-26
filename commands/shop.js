const { ActionRowBuilder, ButtonBuilder, ButtonStyle, UserSelectMenuBuilder } = require('discord.js');
const { CONFIG, RARITIES } = require('../config');
const store = require('../data/store');

const RARITY_ORDER = CONFIG.ui.rarityOrder;

// ── Page Navigation ──

function getPageNavRow(userId, activePage) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`shop_upgrades_${userId}`)
      .setLabel('⬆️ Upgrades')
      .setStyle(activePage === 'upgrades' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`shop_potions_${userId}`)
      .setLabel('🧪 Potions')
      .setStyle(activePage === 'potions' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`shop_mysterybox_${userId}`)
      .setLabel('🎁 Mystery Box')
      .setStyle(activePage === 'mysterybox' ? ButtonStyle.Primary : ButtonStyle.Secondary),
  );
  if (activePage === 'upgrades') {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`upgrade_refresh_${userId}`)
        .setLabel('🔄')
        .setStyle(ButtonStyle.Secondary),
    );
  }
  return row;
}

// ── Upgrades Page ──

function renderUpgradesEmbed(userId, successMessage) {
  const w = store.getWallet(userId);
  const maxLevel = CONFIG.economy.upgrades.maxLevel;
  const interestCosts = CONFIG.economy.upgrades.costs.interest;
  const cashbackCosts = CONFIG.economy.upgrades.costs.cashback;
  const spinCosts = CONFIG.economy.upgrades.costs.spinMult;
  const universalIncomeCosts = CONFIG.economy.upgrades.costs.universalIncome;
  const iLvl = w.interestLevel || 0, cLvl = w.cashbackLevel || 0, sLvl = w.spinMultLevel || 0, uLvl = w.universalIncomeMultLevel || 0;
  const bonuses = store.getUserBonuses(userId);
  const iRate = store.getInterestRate(userId), cRatePct = store.getCashbackRate(userId) * 100, sMult = (1 + sLvl * CONFIG.economy.upgrades.spinMultPerLevel), uChance = bonuses.universalIncomeDoubleChance * 100;
  const iBaseRate = CONFIG.economy.bank.baseInvestRate + (iLvl * CONFIG.economy.upgrades.interestPerLevel);
  const cBaseRatePct = cLvl * CONFIG.economy.upgrades.cashbackPerLevel * 100;
  const iCost = iLvl < maxLevel ? interestCosts[iLvl] : null;
  const cCost = cLvl < maxLevel ? cashbackCosts[cLvl] : null;
  const sCost = sLvl < maxLevel ? spinCosts[sLvl] : null;
  const uCost = uLvl < maxLevel ? universalIncomeCosts[uLvl] : null;
  const totalFunds = (w.balance || 0) + (w.bank || 0);

  // 10 parallelograms; one fills every 10 levels
  const bar = (lvl, max) => {
    const segments = Math.floor(max / 10);
    const filled = Math.floor(lvl / 10);
    return '▰'.repeat(filled) + '▱'.repeat(segments - filled);
  };

  const sMultFull = sMult + bonuses.spinWeightBonus;
  const iGain = CONFIG.economy.upgrades.interestPerLevel * 100;
  const uGain = CONFIG.economy.upgrades.universalIncomePerLevelChance * 100;
  const spinGain = CONFIG.economy.upgrades.spinMultPerLevel;

  const fields = [
    {
      name: '∑ Bank Interest',
      value: `> ${bar(iLvl, maxLevel)} **Lv ${iLvl}/${maxLevel}**\n> Rate: **${(iRate * 100).toFixed(3)}%**/day (hourly)\n> ${iCost ? `Next: **${((iRate + CONFIG.economy.upgrades.interestPerLevel) * 100).toFixed(3)}%** (+${iGain.toFixed(3)}%) for **${store.formatNumber(iCost)}**` : '✨ **MAXED**'}`,
      inline: true,
    },
    {
      name: '↩ Loss Cashback',
      value: `> ${bar(cLvl, maxLevel)} **Lv ${cLvl}/${maxLevel}**\n> Rate: **${cRatePct.toFixed(3)}%** back\n> ${cCost ? `Next: **${(cRatePct + CONFIG.economy.upgrades.cashbackPerLevel * 100).toFixed(3)}%** (+${(CONFIG.economy.upgrades.cashbackPerLevel * 100).toFixed(3)}%) for **${store.formatNumber(cCost)}**` : '✨ **MAXED**'}`,
      inline: true,
    },
    { name: '\u200b', value: '\u200b', inline: false },
    {
      name: '⟳× Spin Payout Mult',
      value: `> ${bar(sLvl, maxLevel)} **Lv ${sLvl}/${maxLevel}**\n> Multiplier: **${sMultFull.toFixed(2)}x** payout\n> ${sCost ? `Next: **${(sMultFull + spinGain).toFixed(2)}x** (+${spinGain.toFixed(2)}x) for **${store.formatNumber(sCost)}**` : '✨ **MAXED**'}`,
      inline: true,
    },
    {
      name: '∀× Universal Income Chance',
      value: `> ${bar(uLvl, maxLevel)} **Lv ${uLvl}/${maxLevel}**\n> Chance: **${uChance.toFixed(2)}%** to double\n> ${uCost ? `Next: **${(uChance + uGain).toFixed(2)}%** (+${uGain.toFixed(1)}%) for **${store.formatNumber(uCost)}**` : '✨ **MAXED**'}`,
      inline: true,
    },
    { name: '\u200b', value: '\u200b', inline: false },
  ];

  const embed = {
    title: '⬆️ Upgrades',
    color: 0x2b2d31,
    description: `> 💰 Purse: **${store.formatNumber(w.balance)}** coins\n> 🏦 Bank: **${store.formatNumber(w.bank)}** coins\n> 💳 Total Available: **${store.formatNumber(totalFunds)}** coins`,
    fields,
  };

  if (successMessage) {
    embed.footer = { text: `✅ ${successMessage}` };
  }

  return embed;
}

function buildUpgradeButtons(userId) {
  const w = store.getWallet(userId);
  const maxLevel = CONFIG.economy.upgrades.maxLevel;
  const interestCosts = CONFIG.economy.upgrades.costs.interest;
  const cashbackCosts = CONFIG.economy.upgrades.costs.cashback;
  const spinCosts = CONFIG.economy.upgrades.costs.spinMult;
  const universalIncomeCosts = CONFIG.economy.upgrades.costs.universalIncome;
  const iLvl = w.interestLevel || 0, cLvl = w.cashbackLevel || 0;
  const sLvl = w.spinMultLevel || 0, uLvl = w.universalIncomeMultLevel || 0;
  const iCost = iLvl < maxLevel ? interestCosts[iLvl] : null;
  const cCost = cLvl < maxLevel ? cashbackCosts[cLvl] : null;
  const sCost = sLvl < maxLevel ? spinCosts[sLvl] : null;
  const uCost = uLvl < maxLevel ? universalIncomeCosts[uLvl] : null;
  const totalFunds = (w.balance || 0) + (w.bank || 0);

  const rows = [];
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`upgrade_interest_${userId}`)
      .setLabel(iCost ? `∑ Interest (${store.formatNumberShort(iCost)})` : '∑ MAXED')
      .setStyle(iCost ? ButtonStyle.Success : ButtonStyle.Secondary).setDisabled(!iCost || totalFunds < iCost),
    new ButtonBuilder().setCustomId(`upgrade_cashback_${userId}`)
      .setLabel(cCost ? `↩ Cashback (${store.formatNumberShort(cCost)})` : '↩ MAXED')
      .setStyle(cCost ? ButtonStyle.Success : ButtonStyle.Secondary).setDisabled(!cCost || totalFunds < cCost),
    new ButtonBuilder().setCustomId(`upgrade_spinmult_${userId}`)
      .setLabel(sCost ? `⟳ Spin (${store.formatNumberShort(sCost)})` : '⟳ MAXED')
      .setStyle(sCost ? ButtonStyle.Success : ButtonStyle.Secondary).setDisabled(!sCost || totalFunds < sCost),
    new ButtonBuilder().setCustomId(`upgrade_universalmult_${userId}`)
      .setLabel(uCost ? `∀ Income (${store.formatNumberShort(uCost)})` : '∀ MAXED')
      .setStyle(uCost ? ButtonStyle.Success : ButtonStyle.Secondary).setDisabled(!uCost || totalFunds < uCost),
  ));
  return rows;
}

// ── Potions Page ──

function renderPotionsEmbed(userId, successMessage) {
  const w = store.getWallet(userId);
  const potions = store.getActivePotions(userId);
  const potionCfg = store.getPotionConfig();
  const totalFunds = (w.balance || 0) + (w.bank || 0);

  const fields = [];

  // Lucky Pot
  let luckyStatus;
  if (potions.lucky) {
    const minsLeft = Math.max(0, Math.ceil((potions.lucky.expiresAt - Date.now()) / 60000));
    luckyStatus = `> 🟢 **Active** - ${minsLeft}m remaining`;
  } else {
    luckyStatus = `> Available for **${store.formatNumber(potionCfg.luckyPotCost)}** coins`;
  }
  fields.push({
    name: '☘⚱ Lucky Pot',
    value: `${luckyStatus}\n> Boosts your win chance by **+0.5%** for **30 mins**\n> Affects: Flip, Duel, Let It Ride`,
    inline: false,
  });

  // Unlucky Pot
  fields.push({
    name: '✕⚱ Unlucky Pot',
    value: `> Price: **${store.formatNumber(potionCfg.unluckyPotCost)}** coins\n> Reduces another player's win chance by **-25%** for **30 mins**\n> Select a target below to apply this curse`,
    inline: false,
  });

  const embed = {
    title: '🧪 Potions Shop',
    color: 0x2b2d31,
    description: `> 💰 Purse: **${store.formatNumber(w.balance)}** coins\n> 🏦 Bank: **${store.formatNumber(w.bank)}** coins\n> 💳 Total Available: **${store.formatNumber(totalFunds)}** coins`,
    fields,
  };

  if (successMessage) {
    embed.footer = { text: `✅ ${successMessage}` };
  }

  return embed;
}

function buildPotionButtons(userId) {
  const potions = store.getActivePotions(userId);
  const w = store.getWallet(userId);
  const potionCfg = store.getPotionConfig();
  const totalFunds = (w.balance || 0) + (w.bank || 0);

  const rows = [];

  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`shop_buylucky_${userId}`)
      .setLabel(potions.lucky ? '☘⚱ Lucky Pot (Active)' : `☘⚱ Buy Lucky Pot (${store.formatNumberShort(potionCfg.luckyPotCost)})`)
      .setStyle(potions.lucky ? ButtonStyle.Secondary : ButtonStyle.Success)
      .setDisabled(!!potions.lucky || totalFunds < potionCfg.luckyPotCost),
    new ButtonBuilder()
      .setCustomId(`shop_unluckymenu_${userId}`)
      .setLabel(`✕⚱ Unlucky Pot (${store.formatNumberShort(potionCfg.unluckyPotCost)})`)
      .setStyle(ButtonStyle.Danger)
      .setDisabled(totalFunds < potionCfg.unluckyPotCost),
  ));

  return rows;
}

// ── Page Rendering ──

function renderMysteryBoxEmbed(userId, successMessage) {
  const w = store.getWallet(userId);
  const cost = CONFIG.collectibles.mysteryBox.cost;
  const premiumCost = CONFIG.collectibles.premiumMysteryBox.cost;
  const maxQty = CONFIG.commands.limits.mysteryBoxQuantity.max;
  const totalFunds = (w.balance || 0) + (w.bank || 0);

  const fields = [
    {
      name: '🎁 Mystery Box',
      value: `> **${store.formatNumber(cost)}** coins each • Random collectible item • Up to **${maxQty}** at once\n> Duplicates give coin compensation. ${CONFIG.ui.rarityOrder.length} rarity tiers (includes 🔴 special & 🟡 godly).`,
      inline: false,
    },
    {
      name: '💎 Premium Mystery Box',
      value: `> **${store.formatNumber(premiumCost)}** coins each • No common tier • Starts at **uncommon**\n> Improved odds for rare+ tiers • Up to **${maxQty}** at once`,
      inline: false,
    },
  ];

  // show duplicate summary if any
  const dupeSummary = store.getDuplicateSummary(userId);
  if (dupeSummary.total > 0) {
    const parts = [];
    for (const [rarity, cnt] of Object.entries(dupeSummary.byRarity)) {
      parts.push(`${RARITIES[rarity].emoji} ${cnt}`);
    }
    const breakdown = parts.join(', ');
    fields.push({
      name: '📦 Duplicates',
      value: `You have **${dupeSummary.total}** duplicate item(s) in inventory (${breakdown}).\nSell them with the button below or via \`/inventory\`.`,
      inline: false,
    });
  }

  const boxesOpened = (w.stats && w.stats.mysteryBox && w.stats.mysteryBox.opened) || 0;

  const embed = {
    title: '🎁 Mystery Box Shop',
    color: 0x2b2d31,
    description: `> 💰 Purse: **${store.formatNumber(w.balance)}** | 🏦 Bank: **${store.formatNumber(w.bank)}** | 💳 Total: **${store.formatNumber(totalFunds)}**\n> 📦 Boxes Opened: **${store.formatNumber(boxesOpened)}**`,
    fields,
  };

  if (successMessage) {
    if (successMessage.includes('\n')) {
      embed.fields.push({ name: '📦 Results', value: successMessage, inline: false });
    } else {
      embed.footer = { text: successMessage };
    }
  }

  return embed;
}

function buildMysteryBoxButtons(userId) {
  const w = store.getWallet(userId);
  const cost = CONFIG.collectibles.mysteryBox.cost;
  const premiumCost = CONFIG.collectibles.premiumMysteryBox.cost;
  const totalFunds = (w.balance || 0) + (w.bank || 0);
  const rows = [];

  // Normal box row: x1, x5, x10, x25 on one row
  const quantities = [1, 5, 10, 25];
  const normalButtons = quantities.map(qty => {
    const totalCost = cost * qty;
    return new ButtonBuilder()
      .setCustomId(`shop_buybox_${userId}_${qty}`)
      .setLabel(`🎁 x${qty} (${store.formatNumberShort(totalCost)})`)
      .setStyle(ButtonStyle.Success)
      .setDisabled(totalFunds < totalCost);
  });

  // Premium box row: x1, x5, x10 on one row (x25 would be very expensive, skip)
  const premiumQtys = [1, 5, 10];
  const premiumButtons = premiumQtys.map(qty => {
    const totalCost = premiumCost * qty;
    return new ButtonBuilder()
      .setCustomId(`shop_buyboxp_${userId}_${qty}`)
      .setLabel(`💎 x${qty} (${store.formatNumberShort(totalCost)})`)
      .setStyle(ButtonStyle.Primary)
      .setDisabled(totalFunds < totalCost);
  });

  rows.push(new ActionRowBuilder().addComponents(normalButtons));
  rows.push(new ActionRowBuilder().addComponents(premiumButtons));

  // Show sell duplicates button if user has any
  const dupeCount = store.countDuplicates(userId);
  if (dupeCount > 0) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`shop_selldups_${userId}`)
          .setLabel(`💰 Sell Duplicates (${dupeCount})`)
          .setStyle(ButtonStyle.Danger)
      )
    );
  }

  return rows;
}

function renderShopPage(userId, page, successMessage) {
  if (page === 'potions') {
    const embed = renderPotionsEmbed(userId, successMessage);
    const components = [getPageNavRow(userId, 'potions'), ...buildPotionButtons(userId)];
    return { embed, components };
  }
  if (page === 'mysterybox') {
    const embed = renderMysteryBoxEmbed(userId, successMessage);
    const components = [getPageNavRow(userId, 'mysterybox'), ...buildMysteryBoxButtons(userId)];
    return { embed, components };
  }
  // Default: upgrades
  const embed = renderUpgradesEmbed(userId, successMessage);
  const components = [getPageNavRow(userId, 'upgrades'), ...buildUpgradeButtons(userId)];
  return { embed, components };
}

// Helper: deduct coins from wallet, falling back to bank if wallet is short.
// Returns true if the payment succeeded, false if total funds are insufficient.
function deductWithBankFallback(w, cost) {
  if (w.balance >= cost) {
    w.balance -= cost;
    return true;
  }
  const total = (w.balance || 0) + (w.bank || 0);
  if (total < cost) return false;
  const needed = cost - w.balance;
  w.bank -= needed;
  w.balance = 0;
  return true;
}

// ── Slash Command Handler ──

async function handleShop(interaction) {
  const { embed, components } = renderShopPage(interaction.user.id, 'upgrades');
  return interaction.reply({ content: '', embeds: [embed], components });
}

// ── Button Handlers ──

async function handleShopButton(interaction, parts) {
  const action = parts[1];
  const uid = parts[2];

  if (action === 'upgrades' || action === 'potions' || action === 'mysterybox') {
    // page navigation is viewable by anyone; show the shop belonging to uid but do not enforce ownership
    const { embed, components } = renderShopPage(uid, action);
    return interaction.update({ content: '', embeds: [embed], components });
  }

  if (action === 'buylucky') {
    if (interaction.user.id !== uid) return interaction.reply({ content: 'Not your shop!', ephemeral: true });
    const potionCfg = store.getPotionConfig();    const w = store.getWallet(uid);
    const totalFunds = (w.balance || 0) + (w.bank || 0);
    if (totalFunds < potionCfg.luckyPotCost) {
      return interaction.reply({ content: `Need **${store.formatNumber(potionCfg.luckyPotCost)}** coins! (Wallet + Bank combined)`, ephemeral: true });
    }
    // Ensure wallet has enough (withdraw from bank if needed)
    if (w.balance < potionCfg.luckyPotCost) {
      const needed = potionCfg.luckyPotCost - w.balance;
      w.bank -= needed;
      w.balance = potionCfg.luckyPotCost;
    }    const result = store.buyLuckyPot(uid);
    if (!result.success) {
      if (result.reason === 'insufficient_funds') return interaction.reply({ content: `Need **${store.formatNumber(potionCfg.luckyPotCost)}** coins!`, ephemeral: true });
      if (result.reason === 'already_active') return interaction.reply({ content: '\u2618\u26b1 You already have an active Lucky Pot!', ephemeral: true });
    }
    const stackCount = result.stacks || 1;
    const { embed, components } = renderShopPage(uid, 'potions', `\u2618\u26b1 Lucky Pot activated! (+0.5% win chance for 30 mins)`);
    return interaction.update({ content: '', embeds: [embed], components });
  }

  if (action === 'unluckymenu') {
    if (interaction.user.id !== uid) return interaction.reply({ content: 'Not your shop!', ephemeral: true });
    const potionCfg = store.getPotionConfig();
    const menuEmbed = {
      title: '✕⚱ Unlucky Pot',
      color: 0x2b2d31,
      description: `> Select a player to curse with **-25%** win chance for **30 mins**\n> Cost: **${store.formatNumber(potionCfg.unluckyPotCost)}** coins`,
    };
    const userSelect = new UserSelectMenuBuilder()
      .setCustomId(`shop_unluckytarget_${uid}`)
      .setPlaceholder('Select target player...')
      .setMinValues(1)
      .setMaxValues(1);
    const backBtn = new ButtonBuilder()
      .setCustomId(`shop_potions_${uid}`)
      .setLabel('← Back')
      .setStyle(ButtonStyle.Secondary);
    return interaction.update({
      content: '',
      embeds: [menuEmbed],
      components: [
        new ActionRowBuilder().addComponents(userSelect),
        new ActionRowBuilder().addComponents(backBtn),
      ],
    });
  }

  if (action === 'unluckyconfirm') {
    const targetId = parts[3];
    if (interaction.user.id !== uid) return interaction.reply({ content: 'Not your shop!', ephemeral: true });

    const potionCfg = store.getPotionConfig();
    const result = store.buyUnluckyPot(uid, targetId);
    if (!result.success) {
      if (result.reason === 'insufficient_funds') return interaction.reply({ content: `Need **${store.formatNumber(potionCfg.unluckyPotCost)}** coins!`, ephemeral: true });
      if (result.reason === 'no_wallet') return interaction.reply({ content: "That user doesn't have a wallet!", ephemeral: true });
      if (result.reason === 'already_active') return interaction.reply({ content: 'That user already has an active Unlucky Pot!', ephemeral: true });
      if (result.reason === 'self_target') return interaction.reply({ content: "You can't curse yourself!", ephemeral: true });
      return interaction.reply({ content: 'Something went wrong!', ephemeral: true });
    }

    const targetUser = await interaction.client.users.fetch(targetId).catch(() => null);
    const targetName = targetUser ? targetUser.username : 'Unknown';
    const { embed, components } = renderShopPage(uid, 'potions', `✕⚱ Unlucky Pot applied to ${targetName} for 30 mins!`);
    await interaction.update({ content: '', embeds: [embed], components });
    await interaction.channel.send({ content: `<@${targetId}> ✕⚱ you've been hit with an **Unlucky Pot** by <@${uid}>! Your win chance is reduced by **-25%** for **30 mins**.` });
    return;
  }

  if (action === 'unluckycancel') {
    if (interaction.user.id !== uid) return interaction.reply({ content: 'Not your shop!', ephemeral: true });
    const { embed, components } = renderShopPage(uid, 'potions');
    return interaction.update({ content: '', embeds: [embed], components });
  }

  if (action === 'selldups') {
    if (interaction.user.id !== uid) return interaction.reply({ content: 'Not your shop!', ephemeral: true });
    const result = store.sellAllDuplicates(uid);
    if (result.totalItemsSold === 0) {
      return interaction.reply({ content: 'No duplicates to sell!', ephemeral: true });
    }
    const lines = [`**Sold ${result.totalItemsSold} duplicate(s) for ${store.formatNumber(result.totalCoins)} coins:**`];
    for (const entry of result.breakdown) {
      lines.push(`> ${entry.emoji} ${entry.name} x${entry.sold} → +${store.formatNumber(entry.sold * entry.refundEach)}`);
    }
    const { embed, components } = renderShopPage(uid, 'mysterybox', lines.join('\n'));
    return interaction.update({ content: '', embeds: [embed], components });
  }

  if (action === 'buybox') {
    const quantity = parseInt(parts[3], 10) || 1;
    if (interaction.user.id !== uid) return interaction.reply({ content: 'Not your shop!', ephemeral: true });
    const w = store.getWallet(uid);
    const cost = CONFIG.collectibles.mysteryBox.cost;
    const totalCost = quantity * cost;
    const totalFunds = (w.balance || 0) + (w.bank || 0);

    if (totalFunds < totalCost) {
      return interaction.reply({ content: `Need **${store.formatNumber(totalCost)}** coins — you have **${store.formatNumber(totalFunds)}** (wallet + bank)`, ephemeral: true });
    }
    // Auto-draw from bank if wallet alone is short
    if (!deductWithBankFallback(w, totalCost)) {
      return interaction.reply({ content: `Need **${store.formatNumber(totalCost)}** coins!`, ephemeral: true });
    }
    store.ensureWalletStatsShape(w);
    const items = [];

    for (let i = 0; i < quantity; i++) {
      const item = store.rollMysteryBox(uid);

      const existing = w.inventory.find(inv => inv.id === item.id);
      if (existing) {
        existing.count = (existing.count || 1) + 1;
        items.push({ ...item, isDuplicate: true, count: existing.count });
      } else {
        w.inventory.push({ id: item.id, name: item.name, rarity: item.rarity, emoji: item.emoji, obtainedAt: Date.now(), count: 1 });
        items.push(item);
      }
    }

    w.stats.mysteryBox.spent = (w.stats.mysteryBox.spent || 0) + totalCost;
    store.applyMysteryBoxStats(uid, items);
    store.saveWallets();

    let resultMsg;
    if (quantity === 1) {
      const item = items[0];
      if (item.isDuplicate) {
        resultMsg = `**Opened x1:**\n> ⚠️ ${item.emoji} **${item.name}** *(duplicate - now x${item.count})*`;
      } else {
        resultMsg = `**Opened x1:**\n> ${item.emoji} **${item.name}** *(${item.rarity})*`;
      }
    } else {
      // Group items by id, tracking new and duplicate counts separately
      const itemCounts = {};
      let duplicateCount = 0;
      for (const item of items) {
        const key = item.id;
        if (!itemCounts[key]) itemCounts[key] = { name: item.name, emoji: item.emoji, rarity: item.rarity, newCount: 0, dupCount: 0 };
        if (item.isDuplicate) {
          duplicateCount++;
          itemCounts[key].dupCount++;
        } else {
          itemCounts[key].newCount++;
        }
      }
      // Sort items by rarity order, then by name
      const sorted = Object.values(itemCounts).sort((a, b) => {
        const ra = RARITY_ORDER.indexOf(a.rarity), rb = RARITY_ORDER.indexOf(b.rarity);
        if (ra !== rb) return rb - ra; // higher rarity first
        return a.name.localeCompare(b.name);
      });
      let lines = [`**Opened x${quantity}:**`];
      for (const entry of sorted) {
        const total = entry.newCount + entry.dupCount;
        const countStr = total > 1 ? ` x${total}` : '';
        if (entry.dupCount === 0) {
          lines.push(`> ${entry.emoji} **${entry.name}**${countStr} *(${entry.rarity})*`);
        } else if (entry.newCount === 0) {
          lines.push(`> ⚠️ ${entry.emoji} **${entry.name}**${countStr} *(duplicate)*`);
        } else {
          lines.push(`> ⚠️ ${entry.emoji} **${entry.name}**${countStr} *(${entry.newCount} new, ${entry.dupCount} dupe)*`);
        }
      }
      if (duplicateCount > 0) {
        lines.push(`> � ${duplicateCount} duplicate(s) stacked in inventory - sell via /inventory`);
      }
      resultMsg = lines.join('\n');
    }

    const { embed, components } = renderShopPage(uid, 'mysterybox', resultMsg);
    return interaction.update({ content: '', embeds: [embed], components });
  }

  if (action === 'buyboxp') {
    const quantity = parseInt(parts[3], 10) || 1;
    if (interaction.user.id !== uid) return interaction.reply({ content: 'Not your shop!', ephemeral: true });
    const w = store.getWallet(uid);
    const cost = CONFIG.collectibles.premiumMysteryBox.cost;
    const totalCost = quantity * cost;
    const totalFunds = (w.balance || 0) + (w.bank || 0);

    if (totalFunds < totalCost) {
      return interaction.reply({ content: `Need **${store.formatNumber(totalCost)}** coins — you have **${store.formatNumber(totalFunds)}** (wallet + bank)`, ephemeral: true });
    }
    if (!deductWithBankFallback(w, totalCost)) {
      return interaction.reply({ content: `Need **${store.formatNumber(totalCost)}** coins!`, ephemeral: true });
    }
    store.ensureWalletStatsShape(w);
    const items = [];

    for (let i = 0; i < quantity; i++) {
      const item = store.rollPremiumMysteryBox(uid);

      const existing = w.inventory.find(inv => inv.id === item.id);
      if (existing) {
        existing.count = (existing.count || 1) + 1;
        items.push({ ...item, isDuplicate: true, count: existing.count });
      } else {
        w.inventory.push({ id: item.id, name: item.name, rarity: item.rarity, emoji: item.emoji, obtainedAt: Date.now(), count: 1 });
        items.push(item);
      }
    }

    w.stats.mysteryBox.spent = (w.stats.mysteryBox.spent || 0) + totalCost;
    store.applyMysteryBoxStats(uid, items);
    store.saveWallets();

    let resultMsg;
    if (quantity === 1) {
      const item = items[0];
      if (item.isDuplicate) {
        resultMsg = `**💎 Opened x1 (Premium):**\n> ⚠️ ${item.emoji} **${item.name}** *(duplicate - now x${item.count})*`;
      } else {
        resultMsg = `**💎 Opened x1 (Premium):**\n> ${item.emoji} **${item.name}** *(${item.rarity})*`;
      }
    } else {
      const itemCounts = {};
      let duplicateCount = 0;
      for (const item of items) {
        const key = item.id;
        if (!itemCounts[key]) itemCounts[key] = { name: item.name, emoji: item.emoji, rarity: item.rarity, newCount: 0, dupCount: 0 };
        if (item.isDuplicate) {
          duplicateCount++;
          itemCounts[key].dupCount++;
        } else {
          itemCounts[key].newCount++;
        }
      }
      const sorted = Object.values(itemCounts).sort((a, b) => {
        const ra = RARITY_ORDER.indexOf(a.rarity), rb = RARITY_ORDER.indexOf(b.rarity);
        if (ra !== rb) return rb - ra;
        return a.name.localeCompare(b.name);
      });
      let lines = [`**💎 Opened x${quantity} (Premium):**`];
      for (const entry of sorted) {
        const total = entry.newCount + entry.dupCount;
        const countStr = total > 1 ? ` x${total}` : '';
        if (entry.dupCount === 0) {
          lines.push(`> ${entry.emoji} **${entry.name}**${countStr} *(${entry.rarity})*`);
        } else if (entry.newCount === 0) {
          lines.push(`> ⚠️ ${entry.emoji} **${entry.name}**${countStr} *(duplicate)*`);
        } else {
          lines.push(`> ⚠️ ${entry.emoji} **${entry.name}**${countStr} *(${entry.newCount} new, ${entry.dupCount} dupe)*`);
        }
      }
      if (duplicateCount > 0) {
        lines.push(`> 📦 ${duplicateCount} duplicate(s) stacked in inventory - sell via /inventory`);
      }
      resultMsg = lines.join('\n');
    }

    const { embed, components } = renderShopPage(uid, 'mysterybox', resultMsg);
    return interaction.update({ content: '', embeds: [embed], components });
  }
}

async function handleUpgradeButton(interaction, parts) {
  const action = parts[1], uid = parts[2];
  if (interaction.user.id !== uid) return interaction.reply({ content: "Not yours!", ephemeral: true });
  const w = store.getWallet(uid);

  if (action === 'refresh') {
    const { embed, components } = renderShopPage(uid, 'upgrades');
    return interaction.update({ content: '', embeds: [embed], components });
  }
  if (action === 'interest') {
    store.processBank(uid);
    const lvl = w.interestLevel || 0;
    if (lvl >= CONFIG.economy.upgrades.maxLevel) return interaction.reply({ content: "Maxed!", ephemeral: true });
    const cost = CONFIG.economy.upgrades.costs.interest[lvl];
    if (!deductWithBankFallback(w, cost)) return interaction.reply({ content: `Need ${store.formatNumber(cost)} (wallet + bank)`, ephemeral: true });
    w.interestLevel = lvl + 1; store.saveWallets();
    const { embed, components } = renderShopPage(uid, 'upgrades', `Interest → Lv ${w.interestLevel}`);
    return interaction.update({ content: '', embeds: [embed], components });
  }
  if (action === 'cashback') {
    const lvl = w.cashbackLevel || 0;
    if (lvl >= CONFIG.economy.upgrades.maxLevel) return interaction.reply({ content: "Maxed!", ephemeral: true });
    const cost = CONFIG.economy.upgrades.costs.cashback[lvl];
    if (!deductWithBankFallback(w, cost)) return interaction.reply({ content: `Need ${store.formatNumber(cost)} (wallet + bank)`, ephemeral: true });
    w.cashbackLevel = lvl + 1; store.saveWallets();
    const { embed, components } = renderShopPage(uid, 'upgrades', `Cashback → Lv ${w.cashbackLevel}`);
    return interaction.update({ content: '', embeds: [embed], components });
  }
  if (action === 'spinmult') {
    const lvl = w.spinMultLevel || 0;
    if (lvl >= CONFIG.economy.upgrades.maxLevel) return interaction.reply({ content: "Maxed!", ephemeral: true });
    const cost = CONFIG.economy.upgrades.costs.spinMult[lvl];
    if (!deductWithBankFallback(w, cost)) return interaction.reply({ content: `Need ${store.formatNumber(cost)} (wallet + bank)`, ephemeral: true });
    w.spinMultLevel = lvl + 1; store.saveWallets();
    const { embed, components } = renderShopPage(uid, 'upgrades', `Spin Payout Mult → Lv ${w.spinMultLevel} (${(1 + w.spinMultLevel * CONFIG.economy.upgrades.spinMultPerLevel).toFixed(2)}x)`);
    return interaction.update({ content: '', embeds: [embed], components });
  }
  if (action === 'universalmult') {
    const lvl = w.universalIncomeMultLevel || 0;
    if (lvl >= CONFIG.economy.upgrades.maxLevel) return interaction.reply({ content: "Maxed!", ephemeral: true });
    const cost = CONFIG.economy.upgrades.costs.universalIncome[lvl];
    if (!deductWithBankFallback(w, cost)) return interaction.reply({ content: `Need ${store.formatNumber(cost)} (wallet + bank)`, ephemeral: true });
    w.universalIncomeMultLevel = lvl + 1; store.saveWallets();
    const newChancePct = ((w.universalIncomeMultLevel * CONFIG.economy.upgrades.universalIncomePerLevelChance) * 100).toFixed(0);
    const { embed, components } = renderShopPage(uid, 'upgrades', `Income Double → Lv ${w.universalIncomeMultLevel} (${newChancePct}% chance)`);
    return interaction.update({ content: '', embeds: [embed], components });
  }
}

// ── Select Menu Handler ──

async function handleShopSelectMenu(interaction) {
  if (interaction.customId.startsWith('shop_unluckytarget_')) {
    const buyerId = interaction.customId.split('_')[2];
    if (interaction.user.id !== buyerId) return interaction.reply({ content: 'Not your shop!', ephemeral: true });

    const targetId = interaction.values[0];
    if (targetId === buyerId) return interaction.reply({ content: "You can't curse yourself!", ephemeral: true });

    const potionCfg = store.getPotionConfig();
    const targetUser = await interaction.client.users.fetch(targetId).catch(() => null);
    const targetName = targetUser ? targetUser.username : 'Unknown';

    const confirmEmbed = {
      title: '✕⚱ Confirm Unlucky Pot',
      color: 0x2b2d31,
      description: `Are you sure you want to curse <@${targetId}>?\n\n> Cost: **${store.formatNumber(potionCfg.unluckyPotCost)}** coins\n> Effect: **-25%** win chance for **30 mins**`,
    };

    const confirmRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`shop_unluckyconfirm_${buyerId}_${targetId}`)
        .setLabel(`Curse ${targetName}`)
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`shop_unluckycancel_${buyerId}`)
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary),
    );

    return interaction.update({ content: '', embeds: [confirmEmbed], components: [confirmRow] });
  }
}

module.exports = { handleShop, handleShopButton, handleUpgradeButton, handleShopSelectMenu };
