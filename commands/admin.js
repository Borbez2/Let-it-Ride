const { SlashCommandBuilder } = require('discord.js');
const store = require('../data/store');

const ADMIN_ACTIONS = [
  {
    name: 'give',
    description: 'Give coins',
    needsUser: true,
    needsAmount: true,
    execute: async ({ interaction }) => {
      const target = interaction.options.getUser('user');
      const amount = interaction.options.getInteger('amount');
      store.setBalance(target.id, store.getBalance(target.id) + amount);
      return interaction.reply(`[ADMIN] +${store.formatNumber(amount)} to ${target.username}`);
    },
  },
  {
    name: 'set',
    description: 'Set balance',
    needsUser: true,
    needsAmount: true,
    execute: async ({ interaction }) => {
      const target = interaction.options.getUser('user');
      const amount = interaction.options.getInteger('amount');
      store.setBalance(target.id, amount);
      return interaction.reply(`[ADMIN] ${target.username} set to ${store.formatNumber(amount)}`);
    },
  },
  {
    name: 'reset',
    description: 'Reset a user',
    needsUser: true,
    needsAmount: false,
    execute: async ({ interaction }) => {
      const target = interaction.options.getUser('user');
      store.deleteWallet(target.id);
      return interaction.reply(`[ADMIN] Reset ${target.username}`);
    },
  },
  {
    name: 'resetupgrades',
    description: 'Reset upgrades',
    needsUser: true,
    needsAmount: false,
    execute: async ({ interaction }) => {
      const target = interaction.options.getUser('user');
      store.processBank(target.id);
      const wallet = store.getWallet(target.id);
      wallet.interestLevel = 0;
      wallet.cashbackLevel = 0;
      wallet.spinMultLevel = 0;
      wallet.universalIncomeMultLevel = 0;
      store.saveWallets();
      return interaction.reply(`[ADMIN] Upgrades reset for ${target.username}`);
    },
  },
  {
    name: 'forcespin',
    description: 'Force the daily spin now',
    needsUser: false,
    needsAmount: false,
    execute: async ({ interaction, runDailySpin }) => {
      await interaction.deferReply({ ephemeral: true });
      await runDailySpin();
      return interaction.editReply('[ADMIN] Daily spin forced.');
    },
  },
  {
    name: 'forcepoolpayout',
    description: 'Force hourly pool payout',
    needsUser: false,
    needsAmount: false,
    execute: async ({ interaction, distributeUniversalPool }) => {
      await interaction.deferReply({ ephemeral: true });
      await distributeUniversalPool();
      return interaction.editReply('[ADMIN] Pool distributed.');
    },
  },
  {
    name: 'testannounce',
    description: 'Send a test announcement message',
    needsUser: false,
    needsAmount: false,
    execute: async ({ interaction, client, announceChannelId, hourlyChannelId }) => {
      const targets = [];
      if (announceChannelId) targets.push(announceChannelId);
      if (hourlyChannelId && hourlyChannelId !== announceChannelId) targets.push(hourlyChannelId);
      if (!targets.length) {
        return interaction.reply({ content: '[ADMIN] No test announce target channels configured.', ephemeral: true });
      }

      const now = new Date();
      const sent = [];
      const failed = [];
      for (const channelId of targets) {
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel) {
          failed.push(channelId);
          continue;
        }
        const ok = await channel.send(
          `📢 **Announcement Channel Test**\nTriggered by <@${interaction.user.id}> at **${now.toISOString()}**.`
        ).then(() => true).catch(() => false);
        if (ok) sent.push(channelId);
        else failed.push(channelId);
      }

      const sentText = sent.length ? sent.map(id => `<#${id}>`).join(', ') : 'none';
      const failedText = failed.length ? failed.map(id => `<#${id}>`).join(', ') : 'none';
      return interaction.reply({ content: `[ADMIN] Test message sent: ${sentText}\nFailed: ${failedText}`, ephemeral: true });
    },
  },
  {
    name: 'start',
    description: 'Start the bot for everyone',
    needsUser: false,
    needsAmount: false,
    execute: async ({ interaction, getBotActive, setBotActive }) => {
      if (getBotActive()) return interaction.reply('[ADMIN] Bot is already started.');
      setBotActive(true);
      return interaction.reply('[ADMIN] Bot started. Everyone can use commands again.');
    },
  },
  {
    name: 'stop',
    description: 'Stop the bot',
    needsUser: false,
    needsAmount: false,
    execute: async ({ interaction, getBotActive, setBotActive }) => {
      if (!getBotActive()) return interaction.reply('[ADMIN] Bot is already stopped.');
      setBotActive(false);
      return interaction.reply('[ADMIN] Bot stopped. Non-admin users are blocked until /admin start.');
    },
  },
  {
    name: 'resetstats',
    description: 'Reset a user\'s stats',
    needsUser: true,
    needsAmount: false,
    execute: async ({ interaction, userId, STATS_RESET_ADMIN_IDS }) => {
      if (!STATS_RESET_ADMIN_IDS.includes(userId)) {
        return interaction.reply({ content: 'Only configured stats-reset admins can use this subcommand.', ephemeral: true });
      }
      const target = interaction.options.getUser('user');
      store.resetStats(target.id);
      const wallet = store.getWallet(target.id);
      const total = (wallet.balance || 0) + (wallet.bank || 0);
      return interaction.reply(`[ADMIN] Stats reset for ${target.username}. Lifetime earnings set to current balance: ${store.formatNumber(total)}`);
    },
  },
];

const ACTION_MAP = Object.fromEntries(ADMIN_ACTIONS.map(action => [action.name, action]));

function buildAdminCommand() {
  return new SlashCommandBuilder().setName('admin').setDescription('[ADMIN] Admin commands')
    .addStringOption(o => o
      .setName('action')
      .setDescription('Admin action')
      .setRequired(true)
      .addChoices(...ADMIN_ACTIONS.map(action => ({ name: action.name, value: action.name }))))
    .addUserOption(o => o
      .setName('user')
      .setDescription('Target user (needed for user actions)')
      .setRequired(false))
    .addIntegerOption(o => o
      .setName('amount')
      .setDescription('Amount (needed for give/set)')
      .setRequired(false));
}

async function handleAdmin(interaction, client, ADMIN_IDS, STATS_RESET_ADMIN_IDS, runDailySpin, distributeUniversalPool, announceChannelId, hourlyChannelId, getBotActive, setBotActive) {
  const userId = interaction.user.id;
  if (!ADMIN_IDS.includes(userId)) return interaction.reply({ content: "Not authorized", ephemeral: true });

  const actionName = interaction.options.getString('action', true);
  const action = ACTION_MAP[actionName];
  if (!action) {
    return interaction.reply({ content: '[ADMIN] Unknown action.', ephemeral: true });
  }

  if (action.needsUser && !interaction.options.getUser('user')) {
    return interaction.reply({ content: '[ADMIN] This action requires the `user` option.', ephemeral: true });
  }
  if (action.needsAmount && interaction.options.getInteger('amount') === null) {
    return interaction.reply({ content: '[ADMIN] This action requires the `amount` option.', ephemeral: true });
  }

  return action.execute({
    interaction,
    client,
    userId,
    STATS_RESET_ADMIN_IDS,
    runDailySpin,
    distributeUniversalPool,
    announceChannelId,
    hourlyChannelId,
    getBotActive,
    setBotActive,
  });
}

module.exports = { buildAdminCommand, handleAdmin };
