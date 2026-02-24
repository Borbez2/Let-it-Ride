const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  UserSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { CONFIG } = require('../config');
const store = require('../data/store');

// ── Runtime Tuning Keys (existing) ──

const TUNING_KEYS = {
  lifeStatsIntervalMs: { ...CONFIG.runtime.bounds.lifeStatsIntervalMs, description: 'Live stats refresh (ms)' },
  globalEvScalar: { ...CONFIG.runtime.bounds.globalEvScalar, description: 'Global EV scalar' },
  binomialPityThreshold: { ...CONFIG.runtime.bounds.binomialPityThreshold, description: 'Pity threshold' },
  binomialPityBoostRate: { ...CONFIG.runtime.bounds.binomialPityBoostRate, description: 'Pity boost rate' },
  binomialPityDurationMinutes: { ...CONFIG.runtime.bounds.binomialPityDurationMinutes, description: 'Pity duration (min)' },
  binomialPityCooldownMinutes: { ...CONFIG.runtime.bounds.binomialPityCooldownMinutes, description: 'Pity cooldown (min)' },
};

// ── Economy Override System ──
// Modifiable economy values stored in runtime state so they persist across restarts.

const ECONOMY_KEYS = {
  mysteryBoxCost:    { path: ['collectibles', 'mysteryBox', 'cost'],        label: 'Mystery Box Cost',    type: 'int',   min: 1,    max: 100000000 },
  universalTaxRate:  { path: ['economy', 'pools', 'universalTaxRate'],      label: 'Universal Tax Rate',  type: 'float', min: 0,    max: 1 },
  lossTaxRate:       { path: ['economy', 'pools', 'lossTaxRate'],           label: 'Loss Tax Rate',       type: 'float', min: 0,    max: 1 },
  dailyBaseReward:   { path: ['economy', 'daily', 'baseReward'],            label: 'Daily Base Reward',   type: 'int',   min: 0,    max: 10000000 },
  dailyStreakBonus:  { path: ['economy', 'daily', 'streakBonusPerDay'],     label: 'Daily Streak Bonus',  type: 'int',   min: 0,    max: 1000000 },
  startingCoins:     { path: ['economy', 'startingCoins'],                  label: 'Starting Coins',      type: 'int',   min: 0,    max: 10000000 },
};

const UPGRADE_COST_KEYS = {
  interest:        { path: ['economy', 'upgrades', 'costs', 'interest'],        label: 'Interest Costs' },
  cashback:        { path: ['economy', 'upgrades', 'costs', 'cashback'],        label: 'Cashback Costs' },
  spinMult:        { path: ['economy', 'upgrades', 'costs', 'spinMult'],        label: 'Spin Mult Costs' },
  universalIncome: { path: ['economy', 'upgrades', 'costs', 'universalIncome'], label: 'Universal Income Costs' },
};

function getConfigValue(pathArr) {
  let obj = CONFIG;
  for (let i = 0; i < pathArr.length - 1; i++) obj = obj[pathArr[i]];
  return obj[pathArr[pathArr.length - 1]];
}

function setConfigValue(pathArr, value) {
  let obj = CONFIG;
  for (let i = 0; i < pathArr.length - 1; i++) obj = obj[pathArr[i]];
  obj[pathArr[pathArr.length - 1]] = value;
}

// Snapshot original defaults before any overrides
const ECONOMY_DEFAULTS = {};
for (const [key, meta] of Object.entries(ECONOMY_KEYS)) {
  ECONOMY_DEFAULTS[key] = getConfigValue(meta.path);
}
const UPGRADE_COST_DEFAULTS = {};
for (const [key, meta] of Object.entries(UPGRADE_COST_KEYS)) {
  UPGRADE_COST_DEFAULTS[key] = [...getConfigValue(meta.path)];
}

function getEconomyOverrides() {
  return store.getRuntimeState('admin:economyOverrides', {}) || {};
}

function saveEconomyOverrides(overrides) {
  store.setRuntimeState('admin:economyOverrides', overrides);
}

function applyEconomyOverrides() {
  const overrides = getEconomyOverrides();
  for (const [key, value] of Object.entries(overrides)) {
    if (ECONOMY_KEYS[key]) {
      setConfigValue(ECONOMY_KEYS[key].path, value);
    }
    if (UPGRADE_COST_KEYS[key]) {
      setConfigValue(UPGRADE_COST_KEYS[key].path, value);
    }
  }
}

// Apply overrides on module load
applyEconomyOverrides();

// ── Admin Session State ──

const adminSessions = new Map();

function getSession(adminId) {
  if (!adminSessions.has(adminId)) {
    adminSessions.set(adminId, { selectedUserId: null, selectedUserName: null });
  }
  return adminSessions.get(adminId);
}

// ── Formatting Helpers ──

function fmtNum(n) { return store.formatNumber(n); }
function fmtPct(n) { return (n * 100).toFixed(2) + '%'; }

function formatEconomySnapshot() {
  const lines = [];
  lines.push('**Economy Settings**\n');
  for (const [key, meta] of Object.entries(ECONOMY_KEYS)) {
    const val = getConfigValue(meta.path);
    const display = meta.type === 'float' ? fmtPct(val) : fmtNum(val);
    lines.push(`• **${meta.label}**: ${display}`);
  }
  lines.push('');
  lines.push('**Upgrade Costs** (Lv1 → Lv10)');
  for (const [key, meta] of Object.entries(UPGRADE_COST_KEYS)) {
    const arr = getConfigValue(meta.path);
    lines.push(`• **${meta.label}**: ${arr.map(v => store.formatNumberShort(v)).join(', ')}`);
  }
  return lines.join('\n');
}

function formatRuntimeSnapshot() {
  const cfg = store.getRuntimeTuning();
  const lines = ['**Runtime Tuning**\n'];
  for (const [key, meta] of Object.entries(TUNING_KEYS)) {
    lines.push(`• **${meta.description}**: ${cfg[key]}`);
  }
  return lines.join('\n');
}

// ── Page Renderers ──

function renderDashboard(adminId, getBotActive, statusMsg) {
  const poolData = store.getPoolData();
  const wallets = store.getAllWallets();
  const playerCount = Object.keys(wallets).length;
  const active = getBotActive();

  const embed = {
    title: '🛡️ Admin Panel',
    color: active ? 0x57f287 : 0xed4245,
    description: [
      `**Bot Status**: ${active ? '🟢 Active' : '🔴 Stopped'}`,
      `**Players**: ${playerCount}`,
      '',
      `**Universal Pool**: ${fmtNum(poolData.universalPool)}`,
      `**Loss/Spin Pool**: ${fmtNum(poolData.lossPool)}`,
    ].join('\n'),
  };
  if (statusMsg) embed.footer = { text: statusMsg };

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`adm_start_${adminId}`).setLabel('▶ Start').setStyle(ButtonStyle.Success).setDisabled(active),
    new ButtonBuilder().setCustomId(`adm_stop_${adminId}`).setLabel('⏹ Stop').setStyle(ButtonStyle.Danger).setDisabled(!active),
    new ButtonBuilder().setCustomId(`adm_forcespin_${adminId}`).setLabel('🎰 Force Spin').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`adm_forcepayout_${adminId}`).setLabel('💰 Force Payout').setStyle(ButtonStyle.Primary),
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`adm_page_users_${adminId}`).setLabel('👤 Users').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`adm_page_economy_${adminId}`).setLabel('💵 Economy').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`adm_page_runtime_${adminId}`).setLabel('⚙️ Runtime').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`adm_page_system_${adminId}`).setLabel('🔧 System').setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [row1, row2] };
}

function renderUsersPage(adminId, statusMsg) {
  const session = getSession(adminId);
  const selectedText = session.selectedUserId
    ? `**Selected**: <@${session.selectedUserId}> (${session.selectedUserName})\nBalance: **${fmtNum(store.getBalance(session.selectedUserId))}**`
    : '**No user selected**  - use the menu below';

  const embed = {
    title: '🛡️ Admin  - User Management',
    color: 0x5865f2,
    description: selectedText,
  };
  if (statusMsg) embed.footer = { text: statusMsg };

  const hasUser = !!session.selectedUserId;

  const selectRow = new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId(`adm_userselect_${adminId}`)
      .setPlaceholder('Select a user...')
      .setMinValues(1).setMaxValues(1),
  );
  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`adm_give_${adminId}`).setLabel('💰 Give').setStyle(ButtonStyle.Success).setDisabled(!hasUser),
    new ButtonBuilder().setCustomId(`adm_setbal_${adminId}`).setLabel('✏️ Set Balance').setStyle(ButtonStyle.Primary).setDisabled(!hasUser),
    new ButtonBuilder().setCustomId(`adm_resetwallet_${adminId}`).setLabel('🗑️ Reset Wallet').setStyle(ButtonStyle.Danger).setDisabled(!hasUser),
    new ButtonBuilder().setCustomId(`adm_resetupgrades_${adminId}`).setLabel('↩ Reset Upgrades').setStyle(ButtonStyle.Danger).setDisabled(!hasUser),
    new ButtonBuilder().setCustomId(`adm_resetstats_${adminId}`).setLabel('📊 Reset Stats').setStyle(ButtonStyle.Danger).setDisabled(!hasUser),
  );
  const actionRow2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`adm_removecurse_${adminId}`).setLabel('⚱✕ Remove Unlucky Pot').setStyle(ButtonStyle.Danger).setDisabled(!hasUser),
  );
  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`adm_page_dashboard_${adminId}`).setLabel('◂ Back').setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [selectRow, actionRow, actionRow2, navRow] };
}

function renderEconomyPage(adminId, statusMsg) {
  const embed = {
    title: '🛡️ Admin  - Economy Settings',
    color: 0xfee75c,
    description: formatEconomySnapshot(),
  };
  if (statusMsg) embed.footer = { text: statusMsg };

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`adm_editeconomy_${adminId}`).setLabel('✏️ Edit Values').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`adm_editupgrades_${adminId}`).setLabel('✏️ Upgrade Costs').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`adm_reseteconomy_${adminId}`).setLabel('↩ Reset All').setStyle(ButtonStyle.Danger),
  );
  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`adm_page_dashboard_${adminId}`).setLabel('◂ Back').setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [row1, navRow] };
}

function renderRuntimePage(adminId, statusMsg) {
  const embed = {
    title: '🛡️ Admin  - Runtime Tuning',
    color: 0xeb459e,
    description: formatRuntimeSnapshot(),
  };
  if (statusMsg) embed.footer = { text: statusMsg };

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`adm_editruntime_${adminId}`).setLabel('✏️ Edit Values').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`adm_resetruntime_${adminId}`).setLabel('↩ Reset All').setStyle(ButtonStyle.Danger),
  );
  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`adm_page_dashboard_${adminId}`).setLabel('◂ Back').setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [row1, navRow] };
}

function renderSystemPage(adminId, statusMsg) {
  const embed = {
    title: '🛡️ Admin  - System Actions',
    color: 0xe67e22,
    description: 'Trigger system actions manually.',
  };
  if (statusMsg) embed.footer = { text: statusMsg };

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`adm_forcespin_${adminId}`).setLabel('🎰 Force Daily Spin').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`adm_forcepayout_${adminId}`).setLabel('💰 Force Pool Payout').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`adm_resetpity_${adminId}`).setLabel('🍀 Reset All Pity').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`adm_testannounce_${adminId}`).setLabel('📢 Test Announce').setStyle(ButtonStyle.Secondary),
  );
  const row2sys = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`adm_clearhourlypool_${adminId}`).setLabel('🗑️ Clear Hourly Pool').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`adm_cleardailyspinpool_${adminId}`).setLabel('🗑️ Clear Spin Pool').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`adm_resetallpurses_${adminId}`).setLabel('💸 Reset All Purses').setStyle(ButtonStyle.Danger),
  );
  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`adm_page_dashboard_${adminId}`).setLabel('◂ Back').setStyle(ButtonStyle.Secondary),
  );

  return { embeds: [embed], components: [row1, row2sys, navRow] };
}

// ── Modals ──

function buildEconomyModal(adminId) {
  const modal = new ModalBuilder()
    .setCustomId(`adm_modal_economy_${adminId}`)
    .setTitle('Edit Economy Values');

  const fields = Object.entries(ECONOMY_KEYS).slice(0, 5);
  for (const [key, meta] of fields) {
    const current = getConfigValue(meta.path);
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(key)
          .setLabel(`${meta.label} (${meta.min}-${meta.max})`)
          .setStyle(TextInputStyle.Short)
          .setValue(String(current))
          .setRequired(false),
      ),
    );
  }

  return modal;
}

function buildUpgradeCostsModal(adminId) {
  const modal = new ModalBuilder()
    .setCustomId(`adm_modal_upgrades_${adminId}`)
    .setTitle('Edit Upgrade Costs');

  for (const [key, meta] of Object.entries(UPGRADE_COST_KEYS)) {
    const arr = getConfigValue(meta.path);
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(key)
          .setLabel(meta.label)
          .setStyle(TextInputStyle.Short)
          .setValue(arr.join(', '))
          .setRequired(false),
      ),
    );
  }

  return modal;
}

function buildRuntimeModal(adminId) {
  const modal = new ModalBuilder()
    .setCustomId(`adm_modal_runtime_${adminId}`)
    .setTitle('Edit Runtime Tuning');

  const cfg = store.getRuntimeTuning();
  const entries = Object.entries(TUNING_KEYS).slice(0, 5);
  for (const [key, meta] of entries) {
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(key)
          .setLabel(`${meta.description} (${meta.min}-${meta.max})`)
          .setStyle(TextInputStyle.Short)
          .setValue(String(cfg[key]))
          .setRequired(false),
      ),
    );
  }

  return modal;
}

function buildGiveModal(adminId) {
  const session = getSession(adminId);
  const modal = new ModalBuilder()
    .setCustomId(`adm_modal_give_${adminId}`)
    .setTitle(`Give coins to ${(session.selectedUserName || 'user').slice(0, 30)}`);

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('amount')
        .setLabel('Amount (e.g. 1000, 5k, 1.2m)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true),
    ),
  );

  return modal;
}

function buildSetBalanceModal(adminId) {
  const session = getSession(adminId);
  const currentBal = session.selectedUserId ? store.getBalance(session.selectedUserId) : 0;
  const modal = new ModalBuilder()
    .setCustomId(`adm_modal_setbal_${adminId}`)
    .setTitle(`Set balance: ${(session.selectedUserName || 'user').slice(0, 32)}`);

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('amount')
        .setLabel('New balance amount')
        .setStyle(TextInputStyle.Short)
        .setValue(String(currentBal))
        .setRequired(true),
    ),
  );

  return modal;
}

// ── Slash Command Builder ──

function buildAdminCommand() {
  return new SlashCommandBuilder()
    .setName('admin')
    .setDescription('[ADMIN] Open the admin control panel');
}

// ── Main Handler ──

async function handleAdmin(interaction, client, ADMIN_IDS, STATS_RESET_ADMIN_IDS, runDailySpin, distributeUniversalPool, announceChannelId, hourlyChannelId, getBotActive, setBotActive, onRuntimeConfigUpdated) {
  const userId = interaction.user.id;
  if (!ADMIN_IDS.includes(userId)) return interaction.reply({ content: 'Not authorized.', ephemeral: true });

  const page = renderDashboard(userId, getBotActive);
  return interaction.reply({ ...page, ephemeral: true });
}

// ── Button Handler ──

async function handleAdminButton(interaction, ADMIN_IDS, STATS_RESET_ADMIN_IDS, client, runDailySpin, distributeUniversalPool, announceChannelId, hourlyChannelId, getBotActive, setBotActive, onRuntimeConfigUpdated) {
  const userId = interaction.user.id;
  if (!ADMIN_IDS.includes(userId)) return interaction.reply({ content: 'Not authorized.', ephemeral: true });

  const parts = interaction.customId.split('_');
  const adminId = parts[parts.length - 1];
  if (adminId !== userId) return interaction.reply({ content: 'Not your panel.', ephemeral: true });

  const action = parts[1];

  // ── Navigation ──
  if (action === 'page') {
    const page = parts[2];
    if (page === 'dashboard') return interaction.update(renderDashboard(adminId, getBotActive));
    if (page === 'users') return interaction.update(renderUsersPage(adminId));
    if (page === 'economy') return interaction.update(renderEconomyPage(adminId));
    if (page === 'runtime') return interaction.update(renderRuntimePage(adminId));
    if (page === 'system') return interaction.update(renderSystemPage(adminId));
    return;
  }

  // ── Dashboard Quick Actions ──
  if (action === 'start') {
    setBotActive(true);
    return interaction.update(renderDashboard(adminId, getBotActive, '✅ Bot started.'));
  }
  if (action === 'stop') {
    setBotActive(false);
    return interaction.update(renderDashboard(adminId, getBotActive, '🔴 Bot stopped.'));
  }
  if (action === 'forcespin') {
    await interaction.deferUpdate();
    await runDailySpin();
    const onSystem = interaction.message?.embeds?.[0]?.title?.includes('System');
    const page = onSystem ? renderSystemPage(adminId, '✅ Daily spin forced.') : renderDashboard(adminId, getBotActive, '✅ Daily spin forced.');
    return interaction.editReply(page);
  }
  if (action === 'forcepayout') {
    await interaction.deferUpdate();
    await distributeUniversalPool();
    const onSystem = interaction.message?.embeds?.[0]?.title?.includes('System');
    const page = onSystem ? renderSystemPage(adminId, '✅ Pool payout forced.') : renderDashboard(adminId, getBotActive, '✅ Pool payout forced.');
    return interaction.editReply(page);
  }

  // ── System Page Actions ──
  if (action === 'resetpity') {
    const result = store.resetAllActivePity();
    return interaction.update(renderSystemPage(adminId, `✅ Pity reset: ${result.usersCleared} users, ${result.stacksCleared} stacks`));
  }
  if (action === 'clearhourlypool') {
    store.clearHourlyPool();
    return interaction.update(renderSystemPage(adminId, '✅ Hourly (universal) pool cleared.'));
  }
  if (action === 'cleardailyspinpool') {
    store.clearDailySpinPool();
    return interaction.update(renderSystemPage(adminId, '✅ Daily spin (loss) pool cleared.'));
  }
  if (action === 'resetallpurses') {
    const count = store.resetAllPursesAndBanks();
    return interaction.update(renderSystemPage(adminId, `✅ Reset purse & bank for ${count} players.`));
  }
  if (action === 'testannounce') {
    await interaction.deferUpdate();
    const targets = [];
    if (announceChannelId) targets.push(announceChannelId);
    if (hourlyChannelId && hourlyChannelId !== announceChannelId) targets.push(hourlyChannelId);
    if (!targets.length) return interaction.editReply(renderSystemPage(adminId, '⚠ No announce channels configured.'));
    let sent = 0;
    for (const channelId of targets) {
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (!channel) continue;
      const ok = await channel.send(`📢 **Test** from <@${adminId}> at ${new Date().toISOString()}`).then(() => true).catch(() => false);
      if (ok) sent++;
    }
    return interaction.editReply(renderSystemPage(adminId, `✅ Test sent to ${sent}/${targets.length} channels.`));
  }

  // ── User Management Actions ──
  if (action === 'give') {
    const session = getSession(adminId);
    if (!session.selectedUserId) return interaction.reply({ content: 'Select a user first.', ephemeral: true });
    return interaction.showModal(buildGiveModal(adminId));
  }
  if (action === 'setbal') {
    const session = getSession(adminId);
    if (!session.selectedUserId) return interaction.reply({ content: 'Select a user first.', ephemeral: true });
    return interaction.showModal(buildSetBalanceModal(adminId));
  }
  if (action === 'resetwallet') {
    const session = getSession(adminId);
    if (!session.selectedUserId) return interaction.reply({ content: 'Select a user first.', ephemeral: true });
    store.resetPurse(session.selectedUserId);
    return interaction.update(renderUsersPage(adminId, `✅ Purse reset for ${session.selectedUserName}`));
  }
  if (action === 'resetupgrades') {
    const session = getSession(adminId);
    if (!session.selectedUserId) return interaction.reply({ content: 'Select a user first.', ephemeral: true });
    store.processBank(session.selectedUserId);
    const wallet = store.getWallet(session.selectedUserId);
    wallet.interestLevel = 0;
    wallet.cashbackLevel = 0;
    wallet.spinMultLevel = 0;
    wallet.universalIncomeMultLevel = 0;
    store.saveWallets();
    return interaction.update(renderUsersPage(adminId, `✅ Upgrades reset for ${session.selectedUserName}`));
  }
  if (action === 'resetstats') {
    const session = getSession(adminId);
    if (!session.selectedUserId) return interaction.reply({ content: 'Select a user first.', ephemeral: true });
    if (!STATS_RESET_ADMIN_IDS.includes(userId)) {
      return interaction.reply({ content: 'Only stats-reset admins can use this.', ephemeral: true });
    }
    store.resetStats(session.selectedUserId);
    const wallet = store.getWallet(session.selectedUserId);
    const total = (wallet.balance || 0) + (wallet.bank || 0);
    return interaction.update(renderUsersPage(adminId, `✅ Stats reset for ${session.selectedUserName}. Lifetime → ${fmtNum(total)}`));
  }
  if (action === 'removecurse') {
    const session = getSession(adminId);
    if (!session.selectedUserId) return interaction.reply({ content: 'Select a user first.', ephemeral: true });
    const result = store.removeUnluckyPot(session.selectedUserId);
    if (!result.success) {
      const reason = result.reason === 'no_wallet' ? 'That user has no wallet.' : 'No active Unlucky Pot on that user.';
      return interaction.update(renderUsersPage(adminId, `⚠️ ${reason}`));
    }
    return interaction.update(renderUsersPage(adminId, `✅ Removed Unlucky Pot from ${session.selectedUserName}`));
  }

  // ── Economy Actions ──
  if (action === 'editeconomy') {
    return interaction.showModal(buildEconomyModal(adminId));
  }
  if (action === 'editupgrades') {
    return interaction.showModal(buildUpgradeCostsModal(adminId));
  }
  if (action === 'reseteconomy') {
    for (const [key] of Object.entries(ECONOMY_KEYS)) {
      if (ECONOMY_DEFAULTS[key] !== undefined) setConfigValue(ECONOMY_KEYS[key].path, ECONOMY_DEFAULTS[key]);
    }
    for (const [key] of Object.entries(UPGRADE_COST_KEYS)) {
      if (UPGRADE_COST_DEFAULTS[key]) setConfigValue(UPGRADE_COST_KEYS[key].path, [...UPGRADE_COST_DEFAULTS[key]]);
    }
    saveEconomyOverrides({});
    return interaction.update(renderEconomyPage(adminId, '✅ All economy values reset to defaults.'));
  }

  // ── Runtime Actions ──
  if (action === 'editruntime') {
    return interaction.showModal(buildRuntimeModal(adminId));
  }
  if (action === 'resetruntime') {
    const next = store.resetRuntimeTuning();
    if (typeof onRuntimeConfigUpdated === 'function') await onRuntimeConfigUpdated(next);
    return interaction.update(renderRuntimePage(adminId, '✅ Runtime config reset to defaults.'));
  }
}

// ── User Select Menu Handler ──

async function handleAdminUserSelect(interaction, ADMIN_IDS) {
  const userId = interaction.user.id;
  if (!ADMIN_IDS.includes(userId)) return interaction.reply({ content: 'Not authorized.', ephemeral: true });

  const parts = interaction.customId.split('_');
  const adminId = parts[parts.length - 1];
  if (adminId !== userId) return interaction.reply({ content: 'Not your panel.', ephemeral: true });

  const selectedId = interaction.values[0];
  const selectedUser = await interaction.client.users.fetch(selectedId).catch(() => null);
  const session = getSession(adminId);
  session.selectedUserId = selectedId;
  session.selectedUserName = selectedUser?.username || `User ${selectedId.slice(-4)}`;

  return interaction.update(renderUsersPage(adminId, `Selected: ${session.selectedUserName}`));
}

// ── Modal Submit Handler ──

async function handleAdminModal(interaction, ADMIN_IDS, onRuntimeConfigUpdated) {
  const userId = interaction.user.id;
  if (!ADMIN_IDS.includes(userId)) return interaction.reply({ content: 'Not authorized.', ephemeral: true });

  const parts = interaction.customId.split('_');
  const adminId = parts[parts.length - 1];
  const modalType = parts[2]; // economy, upgrades, runtime, give, setbal

  if (modalType === 'economy') {
    const overrides = getEconomyOverrides();
    const changes = [];
    for (const [key, meta] of Object.entries(ECONOMY_KEYS)) {
      let raw;
      try { raw = interaction.fields.getTextInputValue(key); } catch { continue; }
      if (!raw || raw.trim() === '') continue;
      const parsed = meta.type === 'float' ? parseFloat(raw) : parseInt(raw, 10);
      if (!Number.isFinite(parsed)) continue;
      const clamped = Math.max(meta.min, Math.min(meta.max, parsed));
      setConfigValue(meta.path, clamped);
      overrides[key] = clamped;
      changes.push(`${meta.label} → ${meta.type === 'float' ? fmtPct(clamped) : fmtNum(clamped)}`);
    }
    saveEconomyOverrides(overrides);
    const msg = changes.length ? `✅ Updated: ${changes.join(', ')}` : 'No changes made.';
    return interaction.reply({ ...renderEconomyPage(adminId, msg), ephemeral: true });
  }

  if (modalType === 'upgrades') {
    const overrides = getEconomyOverrides();
    const changes = [];
    for (const [key, meta] of Object.entries(UPGRADE_COST_KEYS)) {
      let raw;
      try { raw = interaction.fields.getTextInputValue(key); } catch { continue; }
      if (!raw || raw.trim() === '') continue;
      const values = raw.split(',').map(v => {
        const s = v.trim().toLowerCase();
        if (s.endsWith('m')) return Math.round(parseFloat(s) * 1000000);
        if (s.endsWith('k')) return Math.round(parseFloat(s) * 1000);
        return parseInt(s, 10);
      }).filter(v => Number.isFinite(v) && v >= 0);
      if (values.length !== CONFIG.economy.upgrades.maxLevel) continue;
      setConfigValue(meta.path, values);
      overrides[key] = values;
      changes.push(meta.label);
    }
    saveEconomyOverrides(overrides);
    const msg = changes.length ? `✅ Updated: ${changes.join(', ')}` : 'No changes (ensure exactly 10 comma-separated values).';
    return interaction.reply({ ...renderEconomyPage(adminId, msg), ephemeral: true });
  }

  if (modalType === 'runtime') {
    const updates = {};
    const changes = [];
    for (const [key] of Object.entries(TUNING_KEYS)) {
      let raw;
      try { raw = interaction.fields.getTextInputValue(key); } catch { continue; }
      if (!raw || raw.trim() === '') continue;
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) continue;
      updates[key] = parsed;
      changes.push(`${key} → ${parsed}`);
    }
    if (Object.keys(updates).length) {
      const next = store.updateRuntimeTuning(updates);
      if (typeof onRuntimeConfigUpdated === 'function') await onRuntimeConfigUpdated(next);
    }
    const msg = changes.length ? `✅ Updated: ${changes.join(', ')}` : 'No changes made.';
    return interaction.reply({ ...renderRuntimePage(adminId, msg), ephemeral: true });
  }

  if (modalType === 'give') {
    const session = getSession(adminId);
    if (!session.selectedUserId) return interaction.reply({ content: 'No user selected.', ephemeral: true });
    const raw = interaction.fields.getTextInputValue('amount');
    const amount = store.parseAmount(raw, 999999999999);
    if (!amount || amount <= 0) return interaction.reply({ content: 'Invalid amount.', ephemeral: true });
    store.setBalance(session.selectedUserId, store.getBalance(session.selectedUserId) + amount);
    return interaction.reply({ ...renderUsersPage(adminId, `✅ Gave ${fmtNum(amount)} to ${session.selectedUserName}`), ephemeral: true });
  }

  if (modalType === 'setbal') {
    const session = getSession(adminId);
    if (!session.selectedUserId) return interaction.reply({ content: 'No user selected.', ephemeral: true });
    const raw = interaction.fields.getTextInputValue('amount');
    const amount = store.parseAmount(raw, 999999999999);
    if (amount === null || amount === undefined) return interaction.reply({ content: 'Invalid amount.', ephemeral: true });
    store.setBalance(session.selectedUserId, Math.max(0, amount));
    return interaction.reply({ ...renderUsersPage(adminId, `✅ Set ${session.selectedUserName} balance to ${fmtNum(Math.max(0, amount))}`), ephemeral: true });
  }
}

module.exports = { buildAdminCommand, handleAdmin, handleAdminButton, handleAdminUserSelect, handleAdminModal, applyEconomyOverrides };
