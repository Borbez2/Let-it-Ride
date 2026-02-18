const { SlashCommandBuilder } = require('discord.js');
const store = require('../data/store');

const TUNING_KEYS = {
  lifeStatsIntervalMs: { min: 10000, max: 600000, description: 'Live stats refresh interval in milliseconds' },
  globalEvScalar: { min: 0, max: 5, description: 'Global EV scalar multiplier for all EV-based boosts' },
  binomialPityThreshold: { min: 50, max: 99.999, description: 'Probability threshold used by pity tuning' },
  binomialPityBoostRate: { min: 0, max: 0.5, description: 'Temporary all-game EV boost rate when pity triggers' },
  binomialPityDurationMinutes: { min: 1, max: 1440, description: 'Pity boost duration in minutes' },
  binomialPityCooldownMinutes: { min: 0, max: 1440, description: 'Reserved pity cooldown minutes' },
};

function formatAdminHelp() {
  const lines = [];
  lines.push('**Admin Command Help**');
  lines.push('');
  lines.push('**Wallet and User**');
  lines.push('• give user amount: add coins');
  lines.push('• set user amount: set exact purse balance');
  lines.push('• reset user: wipe wallet');
  lines.push('• resetupgrades user: set all upgrade levels to 0');
  lines.push('• resetstats user: reset stat history (restricted list)');
  lines.push('');
  lines.push('**System Controls**');
  lines.push('• start: allow non-admin users to use commands');
  lines.push('• stop: block non-admin users');
  lines.push('• forcespin: run daily spin now');
  lines.push('• forcepoolpayout: run hourly pool payout now');
  lines.push('• resetpityall: clear active pity boosts for all users');
  lines.push('• testannounce: test configured announce channels');
  lines.push('');
  lines.push('**Runtime Tuning**');
  lines.push('• configget: view active values');
  lines.push('• configset key value: update one runtime setting');
  lines.push('• configreset [key optional]: reset one key or all runtime settings');
  lines.push('');
  lines.push('**Config Keys**');
  for (const [key, meta] of Object.entries(TUNING_KEYS)) {
    lines.push(`• ${key}: ${meta.description} (${meta.min} to ${meta.max})`);
  }
  return lines.join('\n');
}

function formatTuningSnapshot() {
  const cfg = store.getRuntimeTuning();
  return [
    '**Runtime Config**',
    `• lifeStatsIntervalMs: ${cfg.lifeStatsIntervalMs}`,
    `• globalEvScalar: ${cfg.globalEvScalar}`,
    `• binomialPityThreshold: ${cfg.binomialPityThreshold}`,
    `• binomialPityBoostRate: ${cfg.binomialPityBoostRate}`,
    `• binomialPityDurationMinutes: ${cfg.binomialPityDurationMinutes}`,
    `• binomialPityCooldownMinutes: ${cfg.binomialPityCooldownMinutes}`,
  ].join('\n');
}

const ADMIN_ACTIONS = [
  {
    name: 'help',
    description: 'Show admin command help',
    needsUser: false,
    needsAmount: false,
    execute: async ({ interaction }) => {
      return interaction.reply({ content: formatAdminHelp(), ephemeral: true });
    },
  },
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
    name: 'resetpityall',
    description: 'Reset all active pity boosts for all users',
    needsUser: false,
    needsAmount: false,
    execute: async ({ interaction }) => {
      const result = store.resetAllActivePity();
      return interaction.reply(`[ADMIN] Active pity reset complete. Users cleared: ${result.usersCleared}, stacks cleared: ${result.stacksCleared}.`);
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
    name: 'configget',
    description: 'View runtime config values',
    needsUser: false,
    needsAmount: false,
    execute: async ({ interaction }) => {
      return interaction.reply({ content: formatTuningSnapshot(), ephemeral: true });
    },
  },
  {
    name: 'configset',
    description: 'Set one runtime config value',
    needsUser: false,
    needsAmount: false,
    execute: async ({ interaction, onRuntimeConfigUpdated }) => {
      const key = interaction.options.getString('key');
      const valueRaw = interaction.options.getString('value');
      if (!key || !valueRaw) {
        return interaction.reply({ content: '[ADMIN] configset requires both `key` and `value`.', ephemeral: true });
      }
      if (!TUNING_KEYS[key]) {
        return interaction.reply({ content: `[ADMIN] Unknown config key: ${key}`, ephemeral: true });
      }

      const parsed = Number(valueRaw);
      if (!Number.isFinite(parsed)) {
        return interaction.reply({ content: `[ADMIN] Invalid numeric value: ${valueRaw}`, ephemeral: true });
      }

      const next = store.updateRuntimeTuning({ [key]: parsed });
      if (typeof onRuntimeConfigUpdated === 'function') {
        await onRuntimeConfigUpdated(next);
      }
      return interaction.reply({ content: `[ADMIN] Updated ${key} to ${next[key]}\n\n${formatTuningSnapshot()}`, ephemeral: true });
    },
  },
  {
    name: 'configreset',
    description: 'Reset runtime config (one key or all)',
    needsUser: false,
    needsAmount: false,
    execute: async ({ interaction, onRuntimeConfigUpdated }) => {
      const key = interaction.options.getString('key');
      let next;

      if (key) {
        if (!TUNING_KEYS[key]) {
          return interaction.reply({ content: `[ADMIN] Unknown config key: ${key}`, ephemeral: true });
        }
        const defaults = store.getDefaultRuntimeTuning();
        next = store.updateRuntimeTuning({ [key]: defaults[key] });
      } else {
        next = store.resetRuntimeTuning();
      }

      if (typeof onRuntimeConfigUpdated === 'function') {
        await onRuntimeConfigUpdated(next);
      }
      return interaction.reply({ content: `[ADMIN] Runtime config reset${key ? ` for ${key}` : ''}.\n\n${formatTuningSnapshot()}`, ephemeral: true });
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
      .setRequired(false))
    .addStringOption(o => o
      .setName('key')
      .setDescription('Config key (for configset/configreset)')
      .setRequired(false)
      .addChoices(...Object.keys(TUNING_KEYS).map((key) => ({ name: key, value: key }))))
    .addStringOption(o => o
      .setName('value')
      .setDescription('Config value (for configset)')
      .setRequired(false));
}

async function handleAdmin(interaction, client, ADMIN_IDS, STATS_RESET_ADMIN_IDS, runDailySpin, distributeUniversalPool, announceChannelId, hourlyChannelId, getBotActive, setBotActive, onRuntimeConfigUpdated) {
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
    onRuntimeConfigUpdated,
  });
}

module.exports = { buildAdminCommand, handleAdmin };
