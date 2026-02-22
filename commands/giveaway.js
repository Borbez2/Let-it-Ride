const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { CONFIG } = require('../config');
const store = require('../data/store');

const GIVEAWAY_CHANNEL_ID = CONFIG.bot.channels.giveaway;
const pendingGiveawayMessages = new Map();

let _scheduleGiveawayTimer = null;
function setGiveawayTimerScheduler(fn) { _scheduleGiveawayTimer = fn; }

// ── Handlers ──

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

  if (bal <= 0) return interaction.reply({ content: `Not enough coins. You only have **${store.formatNumber(bal)}**`, ephemeral: true });

  const amount = store.parseAmount(rawAmount, bal);
  if (!amount || amount <= 0) return interaction.reply({ content: `${CONFIG.commands.invalidAmountText}.`, ephemeral: true });
  if (amount > bal) return interaction.reply({ content: `You only have **${store.formatNumber(bal)}**`, ephemeral: true });

  const seconds = parseDurationPart(rawSeconds, 'Seconds', 0, 60);
  if (!seconds.ok) return interaction.reply({ content: seconds.error, ephemeral: true });

  const minutes = parseDurationPart(rawMinutes, 'Minutes', 0, 60);
  if (!minutes.ok) return interaction.reply({ content: minutes.error, ephemeral: true });

  const hours = parseDurationPart(rawHours, 'Hours', 0, 24);
  if (!hours.ok) return interaction.reply({ content: hours.error, ephemeral: true });

  const days = parseDurationPart(rawDays, 'Days', 0, 365);
  if (!days.ok) return interaction.reply({ content: days.error, ephemeral: true });

  const durationSeconds = seconds.value + (minutes.value * 60) + (hours.value * 3600) + (days.value * 86400);
  if (durationSeconds <= 0) return interaction.reply({ content: 'Duration must be greater than 0 seconds.', ephemeral: true });

  const giveawayChannel = await interaction.client.channels.fetch(GIVEAWAY_CHANNEL_ID).catch(() => null);
  if (!giveawayChannel) return interaction.reply({ content: 'Could not find the giveaway channel.', ephemeral: true });

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
  if (_scheduleGiveawayTimer) _scheduleGiveawayTimer(giveaway.id);

  return interaction.reply({ content: `Giveaway posted in <#${GIVEAWAY_CHANNEL_ID}>.`, ephemeral: true });
}

async function handleGiveawayJoin(interaction, giveawayId) {
  const userId = interaction.user.id;
  const giveaway = store.getGiveaway(giveawayId);

  if (!giveaway) return interaction.reply({ content: 'Giveaway not found or has already ended.', ephemeral: true });
  if (Date.now() > giveaway.expiresAt) return interaction.reply({ content: 'Giveaway has ended.', ephemeral: true });
  if (giveaway.participants.includes(userId)) return interaction.reply({ content: 'You already joined this giveaway!', ephemeral: true });
  if (userId === giveaway.initiatorId) return interaction.reply({ content: 'You cannot join your own giveaway!', ephemeral: true });

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
    content: `You joined the giveaway! Participants: ${giveaway.participants.length}`,
    ephemeral: true,
  });
}

module.exports = {
  handleGiveawayStart, handleGiveawayModal, handleGiveawayJoin,
  setGiveawayTimerScheduler,
};
