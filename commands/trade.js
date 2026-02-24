const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { CONFIG, RARITIES, RARITY_ORDER } = require('../config');
const store = require('../data/store');

const activeTrades = new Map();

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

// ── Render helpers ──

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

// ── Item pickers ──

function buildTradeRarityPicker(userId, trade, isInit) {
  const inv = store.getWallet(userId).inventory;
  const offer = isInit ? trade.initiatorOffer : trade.targetOffer;
  const usedIndices = new Set(offer.items.map(i => i._idx));

  const rarityCounts = {};
  for (let i = 0; i < inv.length; i++) {
    if (usedIndices.has(i)) continue;
    const r = inv[i].rarity;
    rarityCounts[r] = (rarityCounts[r] || 0) + 1;
  }

  const options = (CONFIG.ui?.rarityOrder || Object.keys(RARITIES))
    .filter(r => rarityCounts[r] > 0)
    .map(r => ({
      label: `${r.charAt(0).toUpperCase() + r.slice(1)} (${rarityCounts[r]})`,
      value: r,
      emoji: RARITIES[r] ? RARITIES[r].emoji : undefined,
    }));

  if (options.length <= 1) return null;

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`trade_pickrarity_${trade.initiatorId}_${userId}`)
    .setPlaceholder('Select a rarity to browse')
    .addOptions(options);

  return new ActionRowBuilder().addComponents(menu);
}

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
    .slice(0, 25);

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

// ── Handlers ──

async function handleTrade(interaction) {
  const userId = interaction.user.id;
  const target = interaction.options.getUser('user');
  if (target.id === userId) return interaction.reply({ embeds: [{ color: 0xed4245, description: "Can't trade with yourself." }] });
  if (target.bot) return interaction.reply({ embeds: [{ color: 0xed4245, description: "Can't trade with a bot." }] });
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
}

async function handleTradeButton(interaction, parts) {
  const action = parts[1], tradeKey = parts[2];
  const trade = activeTrades.get(tradeKey);
  if (!trade) return interaction.reply({ content: 'Trade expired!', ephemeral: true });
  const isInit = interaction.user.id === trade.initiatorId;
  const isTgt = interaction.user.id === trade.targetId;
  if (!isInit && !isTgt) return interaction.reply({ content: 'Not your trade!', ephemeral: true });

  if (action === 'setcoins') {
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
    const rarityPicker = buildTradeRarityPicker(interaction.user.id, trade, isInit);
    if (rarityPicker) {
      return interaction.reply({ content: 'Pick a rarity to browse:', components: [rarityPicker], ephemeral: true });
    }
    const menu = buildItemSelectMenu(interaction.user.id, trade, isInit, null);
    if (!menu) return interaction.reply({ content: 'No items available to add!', ephemeral: true });
    return interaction.reply({ content: 'Select an item to add to your offer:', components: [menu], ephemeral: true });
  }

  if (action === 'removeitem') {
    const menu = buildRemoveSelectMenu(interaction.user.id, trade, isInit);
    if (!menu) return interaction.reply({ content: 'No items in your offer to remove!', ephemeral: true });
    return interaction.reply({ content: 'Select an item to remove from your offer:', components: [menu], ephemeral: true });
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
        return interaction.update({ content: '', embeds: [{ title: '❌ Trade Failed', color: 0xed4245, description: 'Not enough coins.' }], components: [] });
      }
      for (const item of trade.initiatorOffer.items) {
        if (item._idx >= iw.inventory.length || iw.inventory[item._idx].id !== item.id) {
          activeTrades.delete(tradeKey);
          persistTradeSessions();
          return interaction.update({ content: '', embeds: [{ title: '❌ Trade Failed', color: 0xed4245, description: 'Inventory changed.' }], components: [] });
        }
      }
      for (const item of trade.targetOffer.items) {
        if (item._idx >= tw.inventory.length || tw.inventory[item._idx].id !== item.id) {
          activeTrades.delete(tradeKey);
          persistTradeSessions();
          return interaction.update({ content: '', embeds: [{ title: '❌ Trade Failed', color: 0xed4245, description: 'Inventory changed.' }], components: [] });
        }
      }

      iw.balance -= trade.initiatorOffer.coins; iw.balance += trade.targetOffer.coins;
      tw.balance -= trade.targetOffer.coins; tw.balance += trade.initiatorOffer.coins;

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

      for (const item of tgtItemsToGive) iw.inventory.push(item);
      for (const item of initItemsToGive) tw.inventory.push(item);

      // Track collectible history after trade
      store.ensureWalletStatsShape(iw);
      store.ensureWalletStatsShape(tw);
      if (typeof store.maybeTrackCollectibleSnapshot === 'function') {
        store.maybeTrackCollectibleSnapshot(iw, Date.now(), 'trade');
        store.maybeTrackCollectibleSnapshot(tw, Date.now(), 'trade');
      }

      store.saveWallets(); activeTrades.delete(tradeKey); persistTradeSessions();
      const initGave = [
        trade.initiatorOffer.coins ? `💰 ${store.formatNumber(trade.initiatorOffer.coins)} coins` : null,
        ...initItemsToGive.map(i => `${i.emoji} ${i.name}`),
      ].filter(Boolean);
      const tgtGave = [
        trade.targetOffer.coins ? `💰 ${store.formatNumber(trade.targetOffer.coins)} coins` : null,
        ...tgtItemsToGive.map(i => `${i.emoji} ${i.name}`),
      ].filter(Boolean);
      return interaction.update({
        content: '',
        embeds: [{
          title: '✅ Trade Complete',
          color: 0x57f287,
          fields: [
            { name: `${trade.initiatorUsername} gave`, value: initGave.length ? initGave.join('\n') : '*Nothing*', inline: true },
            { name: `${trade.targetUsername} gave`, value: tgtGave.length ? tgtGave.join('\n') : '*Nothing*', inline: true },
          ],
        }],
        components: [],
      });
    }
    return interaction.update({ embeds: [renderTradeView(trade)], content: '', components: renderTradeButtons(trade) });
  }

  if (action === 'cancel') {
    activeTrades.delete(tradeKey);
    persistTradeSessions();
    return interaction.update({
      content: '',
      embeds: [{ title: '❌ Trade Cancelled', color: 0xed4245, description: `Cancelled by **${interaction.user.username}**.` }],
      components: [],
    });
  }
}

async function handleTradeSelectMenu(interaction) {
  const parts = interaction.customId.split('_');
  const action = parts[1];
  const tradeKey = parts[2];
  const forUser = parts[3];

  const trade = activeTrades.get(tradeKey);
  if (!trade) return interaction.reply({ content: 'Trade expired!', ephemeral: true });
  if (interaction.user.id !== forUser) return interaction.reply({ content: 'Not yours!', ephemeral: true });

  const isInit = interaction.user.id === trade.initiatorId;
  const offer = isInit ? trade.initiatorOffer : trade.targetOffer;

  if (action === 'selectitem') {
    const idx = parseInt(interaction.values[0]);
    const inv = store.getWallet(interaction.user.id).inventory;
    if (idx >= inv.length) return interaction.reply({ content: 'Invalid item!', ephemeral: true });
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
    if (!menu) return interaction.update({ content: 'No items of that rarity available!', components: [] });
    return interaction.update({ content: `Select a **${rarity}** item to add:`, components: [menu] });
  }

  if (action === 'unselectitem') {
    const offerIdx = parseInt(interaction.values[0]);
    if (offerIdx >= offer.items.length) return interaction.reply({ content: 'Invalid!', ephemeral: true });
    const removed = offer.items.splice(offerIdx, 1)[0];
    trade.initiatorConfirmed = false; trade.targetConfirmed = false;
    persistTradeSessions();
    await interaction.deferUpdate();
    await updateTradeMessage(interaction, trade);
    return interaction.editReply({ content: `Removed **${removed.name}** from your offer!`, components: [] });
  }
}

async function handleTradeModal(interaction) {
  const parts = interaction.customId.split('_');
  const tradeKey = parts[2];
  const forUser = parts[3];

  const trade = activeTrades.get(tradeKey);
  if (!trade) return interaction.reply({ content: 'Trade expired!', ephemeral: true });
  if (interaction.user.id !== forUser) return interaction.reply({ content: 'Not yours!', ephemeral: true });

  const raw = interaction.fields.getTextInputValue('coin_amount').replace(/,/g, '').trim();
  const amount = parseInt(raw);
  if (isNaN(amount) || amount < 0) return interaction.reply({ content: 'Enter a valid number (0 or more).', ephemeral: true });

  const bal = store.getBalance(interaction.user.id);
  if (amount > bal) return interaction.reply({ content: `You only have **${store.formatNumber(bal)}** coins.`, ephemeral: true });

  const isInit = interaction.user.id === trade.initiatorId;
  if (isInit) trade.initiatorOffer.coins = amount;
  else trade.targetOffer.coins = amount;
  trade.initiatorConfirmed = false; trade.targetConfirmed = false;
  persistTradeSessions();

  await interaction.deferUpdate();
  await updateTradeMessage(interaction, trade);
  return interaction.followUp({ content: `Set your coin offer to **${store.formatNumber(amount)}**.`, ephemeral: true });
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
  handleTrade, handleTradeButton,
  handleTradeSelectMenu, handleTradeModal,
  expireTradeSessions,
};
