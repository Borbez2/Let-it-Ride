const { ActionRowBuilder, ButtonBuilder, ButtonStyle, UserSelectMenuBuilder } = require('discord.js');
const { CONFIG, RARITIES } = require('../config');
const store = require('../data/store');

const RARITY_ORDER = CONFIG.ui.rarityOrder;

// ── Page Navigation ──

function getPageNavRow(userId, activePage) {
  return new ActionRowBuilder().addComponents(
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
  const iRate = store.getInterestRate(userId), cRatePct = store.getCashbackRate(userId) * 100, sMult = (1 + sLvl * 0.1), uChance = bonuses.universalIncomeDoubleChance * 100;
  const iBaseRate = CONFIG.economy.bank.baseInvestRate + (iLvl * CONFIG.economy.upgrades.interestPerLevel);
  const cBaseRatePct = cLvl * 0.1;
  const iCost = iLvl < maxLevel ? interestCosts[iLvl] : null;
  const cCost = cLvl < maxLevel ? cashbackCosts[cLvl] : null;
  const sCost = sLvl < maxLevel ? spinCosts[sLvl] : null;
  const uCost = uLvl < maxLevel ? universalIncomeCosts[uLvl] : null;

  const bar = (lvl, max) => '▰'.repeat(lvl) + '▱'.repeat(max - lvl);

  const sMultFull = sMult + bonuses.spinWeightBonus;
  const iGain = CONFIG.economy.upgrades.interestPerLevel * 100;
  const uGain = CONFIG.economy.upgrades.universalIncomePerLevelChance * 100;

  const fields = [
    {
      name: '∑ Bank Interest',
      value: `> ${bar(iLvl, maxLevel)} **Lv ${iLvl}/${maxLevel}**\n> Rate: **${(iRate * 100).toFixed(2)}%**/day (hourly)\n> ${iCost ? `Next: **${((iRate + CONFIG.economy.upgrades.interestPerLevel) * 100).toFixed(2)}%** (+${iGain.toFixed(2)}%) for **${store.formatNumber(iCost)}**` : '✨ **MAXED**'}`,
      inline: true,
    },
    {
      name: '↩ Loss Cashback',
      value: `> ${bar(cLvl, maxLevel)} **Lv ${cLvl}/${maxLevel}**\n> Rate: **${cRatePct.toFixed(2)}%** back\n> ${cCost ? `Next: **${(cRatePct + 0.1).toFixed(2)}%** (+0.10%) for **${store.formatNumber(cCost)}**` : '✨ **MAXED**'}`,
      inline: true,
    },
    { name: '\u200b', value: '\u200b', inline: false },
    {
      name: '⟳× Spin Payout Mult',
      value: `> ${bar(sLvl, maxLevel)} **Lv ${sLvl}/${maxLevel}**\n> Multiplier: **${sMultFull.toFixed(2)}x** payout\n> ${sCost ? `Next: **${(sMultFull + 0.1).toFixed(2)}x** (+0.10x) for **${store.formatNumber(sCost)}**` : '✨ **MAXED**'}`,
      inline: true,
    },
    {
      name: '∀× Universal Income Chance',
      value: `> ${bar(uLvl, maxLevel)} **Lv ${uLvl}/${maxLevel}**\n> Chance: **${uChance.toFixed(2)}%** to double\n> ${uCost ? `Next: **${(uChance + uGain).toFixed(2)}%** (+${uGain.toFixed(0)}%) for **${store.formatNumber(uCost)}**` : '✨ **MAXED**'}`,
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
  return rows;
}

// ── Potions Page ──

function renderPotionsEmbed(userId, successMessage) {
  const w = store.getWallet(userId);
  const potions = store.getActivePotions(userId);
  const potionCfg = store.getPotionConfig();

  const fields = [];

  // Lucky Pot
  let luckyStatus;
  if (potions.lucky) {
    const minsLeft = Math.max(0, Math.ceil((potions.lucky.expiresAt - Date.now()) / 60000));
    luckyStatus = `> 🟢 **Active** — ${minsLeft}m remaining`;
  } else {
    luckyStatus = `> Available for **${store.formatNumber(potionCfg.luckyPotCost)}** coins`;
  }
  fields.push({
    name: '☘⚱ Lucky Pot',
    value: `${luckyStatus}\n> Boosts your win chance by **+5%** for **1 hour**\n> Affects: Flip, Duel, Let It Ride`,
    inline: false,
  });

  // Unlucky Pot
  fields.push({
    name: '⚱✕ Unlucky Pot',
    value: `> Price: **${store.formatNumber(potionCfg.unluckyPotCost)}** coins\n> Reduces another player's win chance by **-25%** for **1 hour**\n> Select a target below to apply this curse`,
    inline: false,
  });

  const embed = {
    title: '🧪 Potions Shop',
    color: 0x2b2d31,
    description: `> 💰 Purse: **${store.formatNumber(w.balance)}** coins`,
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

  const rows = [];

  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`shop_buylucky_${userId}`)
      .setLabel(potions.lucky ? '☘⚱ Lucky Pot (Active)' : `☘⚱ Buy Lucky Pot (${store.formatNumberShort(potionCfg.luckyPotCost)})`)
      .setStyle(potions.lucky ? ButtonStyle.Secondary : ButtonStyle.Success)
      .setDisabled(!!potions.lucky || w.balance < potionCfg.luckyPotCost),
  ));

  // User select for unlucky pot target
  const userSelect = new UserSelectMenuBuilder()
    .setCustomId(`shop_unluckytarget_${userId}`)
    .setPlaceholder(`⚱✕ Select target for Unlucky Pot (${store.formatNumberShort(potionCfg.unluckyPotCost)})`)
    .setMinValues(1)
    .setMaxValues(1);
  rows.push(new ActionRowBuilder().addComponents(userSelect));

  return rows;
}

// ── Page Rendering ──

function renderMysteryBoxEmbed(userId, successMessage) {
  const w = store.getWallet(userId);
  const cost = CONFIG.collectibles.mysteryBox.cost;
  const maxQty = CONFIG.commands.limits.mysteryBoxQuantity.max;

  const fields = [
    {
      name: '🎁 Mystery Box',
      value: `> Price: **${store.formatNumber(cost)}** coins each\n> Contains a random collectible item\n> Duplicates give coin compensation\n> Buy up to **${maxQty}** at once`,
      inline: false,
    },
  ];

  const embed = {
    title: '🎁 Mystery Box Shop',
    color: 0x2b2d31,
    description: `> 💰 Purse: **${store.formatNumber(w.balance)}** coins`,
    fields,
  };

  if (successMessage) {
    embed.footer = { text: successMessage };
  }

  return embed;
}

function buildMysteryBoxButtons(userId) {
  const w = store.getWallet(userId);
  const cost = CONFIG.collectibles.mysteryBox.cost;
  const rows = [];

  const quantities = [1, 5, 10, 25, 50];
  const buttons = quantities.map(qty => {
    const totalCost = cost * qty;
    return new ButtonBuilder()
      .setCustomId(`shop_buybox_${userId}_${qty}`)
      .setLabel(`x${qty} (${store.formatNumberShort(totalCost)})`)
      .setStyle(ButtonStyle.Success)
      .setDisabled(w.balance < totalCost);
  });

  rows.push(new ActionRowBuilder().addComponents(buttons.slice(0, 5)));
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
    if (interaction.user.id !== uid) return interaction.reply({ content: 'Not your shop!', ephemeral: true });
    const { embed, components } = renderShopPage(uid, action);
    return interaction.update({ content: '', embeds: [embed], components });
  }

  if (action === 'buylucky') {
    if (interaction.user.id !== uid) return interaction.reply({ content: 'Not your shop!', ephemeral: true });
    const potionCfg = store.getPotionConfig();
    const result = store.buyLuckyPot(uid);
    if (!result.success) {
      if (result.reason === 'insufficient_funds') return interaction.reply({ content: `Need **${store.formatNumber(potionCfg.luckyPotCost)}** coins!`, ephemeral: true });
      if (result.reason === 'already_active') return interaction.reply({ content: '\u2618\u26b1 You already have an active Lucky Pot!', ephemeral: true });
    }
    const stackCount = result.stacks || 1;
    const { embed, components } = renderShopPage(uid, 'potions', `\u2618\u26b1 Lucky Pot activated! (+5% win chance for 1 hour)`);
    return interaction.update({ content: '', embeds: [embed], components });
  }

  if (action === 'buybox') {
    const quantity = parseInt(parts[3], 10) || 1;
    if (interaction.user.id !== uid) return interaction.reply({ content: 'Not your shop!', ephemeral: true });
    const w = store.getWallet(uid);
    const cost = CONFIG.collectibles.mysteryBox.cost;
    const totalCost = quantity * cost;

    if (w.balance < totalCost) {
      return interaction.reply({ content: `Need **${store.formatNumber(totalCost)}** coins (you have ${store.formatNumber(w.balance)})`, ephemeral: true });
    }

    w.balance -= totalCost;
    const items = [];
    let totalCompensation = 0;

    for (let i = 0; i < quantity; i++) {
      const item = store.rollMysteryBox(uid);

      if (item.id && item.id.startsWith('placeholder_')) {
        const isDuplicate = w.inventory.some(inv => inv.id === item.id);
        if (isDuplicate) {
          const compensation = store.getDuplicateCompensation(item.id, item._rarity);
          w.balance += compensation;
          store.trackMysteryBoxDuplicateComp(uid, compensation);
          totalCompensation += compensation;
          items.push({ ...item, isDuplicate: true, compensation });
          continue;
        }
      }

      w.inventory.push({ id: item.id, name: item.name, rarity: item.rarity, emoji: item.emoji, obtainedAt: Date.now() });
      items.push(item);
    }

    store.saveWallets();

    let resultMsg;
    if (quantity === 1) {
      const item = items[0];
      if (item.isDuplicate) {
        resultMsg = `${item.emoji} DUPLICATE — **${item.name}** → +${store.formatNumber(item.compensation)} coins`;
      } else {
        resultMsg = `${item.emoji} Got: **${item.name}** (${item.rarity})`;
      }
    } else {
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
      let lines = [`Opened x${quantity}:`];
      for (const rarity of RARITY_ORDER) {
        const rarityItems = byRarity[rarity];
        if (!rarityItems || rarityItems.length === 0) continue;
        lines.push(`${RARITIES[rarity].emoji} ${rarity}: x${rarityItems.length}`);
      }
      if (duplicateCount > 0) {
        lines.push(`⚠️ Dupes: x${duplicateCount} (+${store.formatNumber(totalCompensation)})`);
      }
      resultMsg = lines.join(' | ');
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
    if (w.balance < cost) return interaction.reply({ content: `Need ${store.formatNumber(cost)}`, ephemeral: true });
    w.balance -= cost; w.interestLevel = lvl + 1; store.saveWallets();
    const { embed, components } = renderShopPage(uid, 'upgrades', `Interest → Lv ${w.interestLevel}`);
    return interaction.update({ content: '', embeds: [embed], components });
  }
  if (action === 'cashback') {
    const lvl = w.cashbackLevel || 0;
    if (lvl >= CONFIG.economy.upgrades.maxLevel) return interaction.reply({ content: "Maxed!", ephemeral: true });
    const cost = CONFIG.economy.upgrades.costs.cashback[lvl];
    if (w.balance < cost) return interaction.reply({ content: `Need ${store.formatNumber(cost)}`, ephemeral: true });
    w.balance -= cost; w.cashbackLevel = lvl + 1; store.saveWallets();
    const { embed, components } = renderShopPage(uid, 'upgrades', `Cashback → Lv ${w.cashbackLevel}`);
    return interaction.update({ content: '', embeds: [embed], components });
  }
  if (action === 'spinmult') {
    const lvl = w.spinMultLevel || 0;
    if (lvl >= CONFIG.economy.upgrades.maxLevel) return interaction.reply({ content: "Maxed!", ephemeral: true });
    const cost = CONFIG.economy.upgrades.costs.spinMult[lvl];
    if (w.balance < cost) return interaction.reply({ content: `Need ${store.formatNumber(cost)}`, ephemeral: true });
    w.balance -= cost; w.spinMultLevel = lvl + 1; store.saveWallets();
    const { embed, components } = renderShopPage(uid, 'upgrades', `Spin Payout Mult → Lv ${w.spinMultLevel} (${(1 + w.spinMultLevel * 0.1).toFixed(1)}x)`);
    return interaction.update({ content: '', embeds: [embed], components });
  }
  if (action === 'universalmult') {
    const lvl = w.universalIncomeMultLevel || 0;
    if (lvl >= CONFIG.economy.upgrades.maxLevel) return interaction.reply({ content: "Maxed!", ephemeral: true });
    const cost = CONFIG.economy.upgrades.costs.universalIncome[lvl];
    if (w.balance < cost) return interaction.reply({ content: `Need ${store.formatNumber(cost)}`, ephemeral: true });
    w.balance -= cost; w.universalIncomeMultLevel = lvl + 1; store.saveWallets();
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
    const result = store.buyUnluckyPot(buyerId, targetId);
    if (!result.success) {
      if (result.reason === 'insufficient_funds') return interaction.reply({ content: `Need **${store.formatNumber(potionCfg.unluckyPotCost)}** coins!`, ephemeral: true });
      if (result.reason === 'no_wallet') return interaction.reply({ content: "That user doesn't have a wallet!", ephemeral: true });
      if (result.reason === 'already_active') return interaction.reply({ content: 'That user already has an active Unlucky Pot!', ephemeral: true });
      if (result.reason === 'self_target') return interaction.reply({ content: "You can't curse yourself!", ephemeral: true });
    }

    const targetUser = await interaction.client.users.fetch(targetId).catch(() => null);
    const targetName = targetUser ? targetUser.username : 'Unknown';
    const { embed, components } = renderShopPage(buyerId, 'potions', `Unlucky Pot applied to ${targetName} for 1 hour!`);
    return interaction.update({ content: '', embeds: [embed], components });
  }
}

module.exports = { handleShop, handleShopButton, handleUpgradeButton, handleShopSelectMenu };
