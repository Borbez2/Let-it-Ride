const { ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const { CONFIG } = require('../config');
const store = require('../data/store');

// ─── Tab definitions ──────────────────────────────────────────────────────────
const TABS = [
  { value: 'gameplay',  label: '📊 Gameplay',      description: 'Win chance, cashback, mines save' },
  { value: 'passive',   label: '📈 Passive',        description: 'Bank interest, spin & income multipliers' },
  { value: 'flip',      label: '🪙 Coin Flip',      description: 'Flip-specific effects' },
  { value: 'duel',      label: '⚔️ Duel',           description: 'Duel-specific effects' },
  { value: 'letitride', label: '🏇 Let It Ride',    description: 'Let It Ride-specific effects' },
  { value: 'blackjack', label: '🃏 Blackjack',      description: 'Blackjack rules & effects' },
  { value: 'mines',     label: '💣 Mines',          description: 'Mines-specific effects' },
  { value: 'roulette',  label: '🎡 Roulette',       description: 'Roulette payouts & effects' },
];

function buildNavRow(viewerId, targetId, activePage) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`effects_tab_${viewerId}_${targetId}`)
      .setPlaceholder('Select a page...')
      .addOptions(TABS.map(t => ({
        label: t.label,
        value: t.value,
        description: t.description,
        default: t.value === activePage,
      })))
  );
}

// ─── Discord embed limits ─────────────────────────────────────────────────────
const FIELD_VALUE_LIMIT = 1024;
const EMBED_TOTAL_LIMIT = 6000;

/** Truncate a string to fit Discord's field value limit (1024 chars). */
function truncateField(text, limit = FIELD_VALUE_LIMIT) {
  if (text.length <= limit) return text;
  const suffix = '\n> *… truncated*';
  return text.slice(0, limit - suffix.length) + suffix;
}

/** Clamp all field values in an embed so the total stays under 6000 chars. */
function clampEmbed(embed) {
  // Truncate individual field values first
  for (const f of embed.fields || []) {
    f.value = truncateField(f.value);
  }
  // Check total and trim last long field if overflowing
  const total = () =>
    (embed.title || '').length +
    (embed.description || '').length +
    (embed.fields || []).reduce((s, f) => s + f.name.length + f.value.length, 0);
  while (total() > EMBED_TOTAL_LIMIT && embed.fields.length > 1) {
    // drop the second-to-last field (keep Legend)
    embed.fields.splice(-2, 1);
  }
  return embed;
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

/** Gather all win-chance modifier components for a user. */
function buildWinChanceSummary(userId) {
  const potions = store.getActivePotions(userId);
  const potionConfig = store.getPotionConfig();
  const luckyStacks = potions.lucky ? (potions.lucky.stacks ? potions.lucky.stacks.length : 1) : 0;
  const luckyPotBoost = Math.min(luckyStacks, 1) * potionConfig.luckyPotBoost;
  const unluckyPotPenalty = potions.unlucky ? potionConfig.unluckyPotPenalty : 0;
  const pityStatus = store.getUserPityStatus(userId);
  const streakBoost = pityStatus.active ? (pityStatus.winChanceBoost || 0) : 0;
  const totalBoost = luckyPotBoost - unluckyPotPenalty + streakBoost;
  const modifier = 1 + totalBoost;
  return { luckyStacks, luckyPotBoost, unluckyPotPenalty, streakBoost, totalBoost, modifier, potions, potionConfig, pityStatus };
}

// ─── Page renderers ───────────────────────────────────────────────────────────

function renderGameplayPage(username, userId) {
  const bonuses = store.getUserBonuses(userId);
  const base = bonuses.base;
  const items = bonuses.items;
  const xpBonuses = store.getXpInfo(userId).xpBonuses;

  // Win Chance modifier block
  const { luckyStacks, luckyPotBoost, unluckyPotPenalty, streakBoost, totalBoost, potions, pityStatus } = buildWinChanceSummary(userId);
  const sign = totalBoost >= 0 ? '+' : '';
  let winText = `> **Total modifier: ${sign}${(totalBoost * 100).toFixed(1)}%** *(applied multiplicatively to each game's base win chance)*\n`;
  if (luckyPotBoost > 0) {
    const mins = Math.max(0, Math.ceil((potions.lucky.expiresAt - Date.now()) / 60000));
    winText += `> ⏳ Lucky Pot (${luckyStacks} stack${luckyStacks !== 1 ? 's' : ''}, ${mins}m left): **+${(luckyPotBoost * 100).toFixed(1)}%**\n`;
  }
  if (unluckyPotPenalty > 0) {
    const mins = Math.max(0, Math.ceil((potions.unlucky.expiresAt - Date.now()) / 60000));
    winText += `> ⏳ Unlucky Pot (${mins}m left): **-${(unluckyPotPenalty * 100).toFixed(1)}%**\n`;
  }
  if (streakBoost > 0) {
    const mins = Math.max(0, Math.ceil(pityStatus.expiresInMs / 60000));
    winText += `> ⏳ Losing Streak buff (${mins}m left): **+${(streakBoost * 100).toFixed(1)}%**\n`;
  }
  if (luckyPotBoost === 0 && unluckyPotPenalty === 0 && streakBoost === 0) {
    winText += `> *No active win chance effects*\n`;
  }

  // Losing Streak luck block
  const maxStacks = pityStatus.tier2Cap - pityStatus.activationThreshold + 1;
  const activeStacks = pityStatus.active
    ? Math.max(0, pityStatus.buffStreak - pityStatus.activationThreshold + 1)
    : 0;
  const stackBar = '▰'.repeat(activeStacks) + '▱'.repeat(Math.max(0, maxStacks - activeStacks));
  const boostPct = ((pityStatus.winChanceBoost || 0) * 100).toFixed(1);
  const maxPct = (pityStatus.maxWinChanceBoost * 100).toFixed(1);

  let luckText;
  if (pityStatus.active) {
    const minsLeft = Math.max(0, Math.ceil(pityStatus.expiresInMs / 60000));
    luckText = `> ● ${stackBar} **${boostPct}%/${maxPct}%** (🔥 ${minsLeft}m left)\n`;
    luckText += `> Triggered at streak: **${pityStatus.buffStreak}** losses\n`;
    luckText += `> *Keep losing in a row to upgrade  - a higher streak replaces the buff.*\n`;
    luckText += `> *Any win **clears** this buff and resets your streak to 0.*`;
  } else {
    const lossesNeeded = Math.max(1, pityStatus.activationThreshold - pityStatus.lossStreak);
    luckText = `> ○ ${stackBar} **0%/${maxPct}%** *(not active)*\n`;
    luckText += `> Lose **${lossesNeeded}** more in a row to trigger (streak: ${pityStatus.lossStreak})\n`;
    luckText += `> *Stacks are counted only from your current unbroken losing run.*\n`;
    luckText += `> *A win clears the buff and resets the streak  - no carryover.*`;
  }
  const luckFooter = `\n> Current loss streak: **${pityStatus.lossStreak}** · Best: **${pityStatus.bestLossStreak}** · Total triggers: **${pityStatus.triggers}**`;

  // Cashback
  const cashTotal = (base.cashbackRate + items.cashbackRate + (xpBonuses.cashbackRate || 0)) * 100;
  let cbText = `> **${cashTotal.toFixed(2)}%** of losses returned as coins\n`;
  if (base.cashbackRate > 0) cbText += `> 🔧 Upgrades: **${(base.cashbackRate * 100).toFixed(2)}%**\n`;
  if (items.cashbackRate > 0) cbText += `> 🎒 Items: **+${(items.cashbackRate * 100).toFixed(2)}%**\n`;
  if (xpBonuses.cashbackRate) cbText += `> ⭐ XP Level: **+${(xpBonuses.cashbackRate * 100).toFixed(2)}%**\n`;
  if (cashTotal === 0) cbText += `> *No cashback active*`;

  // Mines Save
  const revealTotal = (base.minesRevealChance + items.minesRevealChance) * 100;
  let minesText = `> **${revealTotal.toFixed(2)}%** chance to reveal & survive a mine\n`;
  if (items.minesRevealChance > 0) minesText += `> 🎒 Items: **+${(items.minesRevealChance * 100).toFixed(2)}%**\n`;
  if (revealTotal === 0) minesText += `> *0%  - upgrades don't affect mines; items only*`;

  const additionalEffects = bonuses.inventoryEffects || [];

  const TITLE          = `✦ ${username}'s Effects  - Gameplay`;
  const LEGEND_FIELD   = { name: 'Legend', value: '> 🔧 Upgrades · 🎒 Items · ⭐ XP · ⏳ Temp', inline: false };
  const ITEM_EFF_NAME  = '🎒 Item Effects';

  // Pre-truncate every fixed field to the per-field limit first.
  const fixedFields = [
    { name: '🎯 Win Chance (Flip·Duel·LIR)', value: truncateField(winText.trimEnd()),         inline: false },
    { name: '☘ Losing Streak Luck',           value: truncateField(luckText + luckFooter),     inline: false },
    { name: '↩ Cashback',                      value: truncateField(cbText.trimEnd()),          inline: true  },
    { name: '⛁⌖ Mines Save',                  value: truncateField(minesText.trimEnd()),       inline: true  },
  ];

  // Calculate embed chars already consumed by the fixed content.
  const fixedChars =
    TITLE.length +
    fixedFields.reduce((s, f) => s + f.name.length + f.value.length, 0) +
    LEGEND_FIELD.name.length + LEGEND_FIELD.value.length;

  const fields = [...fixedFields];

  if (additionalEffects.length > 0) {
    // Budget: remaining chars under the 6 000 embed limit, minus the field name and a small safety margin.
    const valueBudget = Math.min(
      FIELD_VALUE_LIMIT,
      Math.max(50, EMBED_TOTAL_LIMIT - fixedChars - ITEM_EFF_NAME.length - 10),
    );

    let itemText = additionalEffects.join('\n');
    if (itemText.length > valueBudget) {
      // Show as many lines as fit within the budget, then summarise the rest.
      const lines = additionalEffects;
      let built   = '';
      let shown   = 0;
      for (const line of lines) {
        const next   = built ? built + '\n' + line : line;
        const suffix = `\n> *… and ${lines.length - shown - 1} more effect${lines.length - shown - 1 !== 1 ? 's' : ''}*`;
        if (next.length + suffix.length > valueBudget) break;
        built = next;
        shown++;
      }
      if (built) {
        const remaining = lines.length - shown;
        itemText = built + `\n> *… and ${remaining} more effect${remaining !== 1 ? 's' : ''}*`;
      } else {
        // Even a single line doesn't fit in the budget — just summarise.
        itemText = `> *${lines.length} item effect${lines.length !== 1 ? 's' : ''} active — see individual game tabs for details*`;
      }
    }
    fields.push({ name: ITEM_EFF_NAME, value: itemText, inline: false });
  }

  fields.push(LEGEND_FIELD);

  return clampEmbed({
    title: TITLE,
    color: 0x2b2d31,
    fields,
  });
}

function renderPassivePage(username, userId) {
  const bonuses = store.getUserBonuses(userId);
  const base = bonuses.base;
  const items = bonuses.items;
  const xpBonuses = store.getXpInfo(userId).xpBonuses;

  // Bank Interest
  const baseIntPct = base.interestRate * 100;
  const itemIntPct = items.interestRate * 100;
  const xpIntPct = (xpBonuses.interestRate || 0) * 100;
  const totalIntPct = baseIntPct + itemIntPct + xpIntPct;
  let intText = `> **${totalIntPct.toFixed(3)}%/day** applied to your bank balance\n`;
  intText += `> 🔧 Upgrades: **${baseIntPct.toFixed(3)}%/day**\n`;
  if (itemIntPct > 0) intText += `> 🎒 Items: **+${itemIntPct.toFixed(3)}%/day**\n`;
  if (xpIntPct) intText += `> ⭐ XP Level: **+${xpIntPct.toFixed(3)}%/day**\n`;
  intText += `> *(Tiered slabs: full rate on first 1 M, ×0.5 on 1-10 M, ×0.1 above 10 M)*`;

  // Daily Spin Multiplier
  const totalSpin = base.spinWeight + items.spinWeight;
  let spinText = `> **${totalSpin.toFixed(2)}x** spin weight\n`;
  spinText += `> 🔧 Upgrades: **${base.spinWeight.toFixed(2)}x** (each upgrade level adds +${CONFIG.economy.upgrades.spinMultPerLevel.toFixed(2)}x)\n`;
  if (items.spinWeight > 0) spinText += `> 🎒 Items: **+${items.spinWeight.toFixed(2)}x**\n`;
  spinText += `> *(Your weight relative to other players  - a 2.0x weight doubles your lottery odds vs a 1.0x player.)*`;

  // Hourly Universal Income Double Chance
  const baseDoublePct = base.universalDoubleChance * 100;
  const itemDoublePct = items.universalDoubleChance * 100;
  const xpDoublePct = (xpBonuses.universalDoubleChance || 0) * 100;
  const totalDoublePct = baseDoublePct + itemDoublePct + xpDoublePct;
  let incomeText = `> **${totalDoublePct.toFixed(1)}%** chance each hourly payout is ×2\n`;
  incomeText += `> 🔧 Upgrades: **${baseDoublePct.toFixed(1)}%** (each upgrade level adds +${(CONFIG.economy.upgrades.universalIncomePerLevelChance * 100).toFixed(1)}%)\n`;
  if (itemDoublePct > 0) incomeText += `> 🎒 Items: **+${itemDoublePct.toFixed(1)}%**\n`;
  if (xpDoublePct) incomeText += `> ⭐ XP Level: **+${xpDoublePct.toFixed(1)}%**\n`;
  incomeText += `> *(If triggered, your share of the hourly universal pool is doubled for that payout.)*`;

  return clampEmbed({
    title: `✦ ${username}'s Effects  - Passive`,
    color: 0x2b2d31,
    fields: [
      { name: '∑ Bank Interest', value: intText, inline: false },
      { name: '⟳× Spin Multiplier', value: spinText, inline: false },
      { name: '∀× Income Double Chance', value: incomeText, inline: false },
      { name: 'Legend', value: '> 🔧 Upgrades · 🎒 Items · ⭐ XP · ⏳ Temp', inline: false },
    ],
  });
}

function renderFlipPage(username, userId) {
  const baseChance = CONFIG.games.flip.winChance;
  const { totalBoost, modifier } = buildWinChanceSummary(userId);
  const effectiveChance = baseChance * modifier;
  const sign = totalBoost >= 0 ? '+' : '';
  const cashbackRate = store.getCashbackRate(userId);

  let text = `> Base win chance: **${(baseChance * 100).toFixed(1)}%**\n`;
  text += `> Win chance modifier: **${sign}${(totalBoost * 100).toFixed(1)}%** → multiplier **${modifier.toFixed(4)}x**\n`;
  text += `> Effective win chance: **${(effectiveChance * 100).toFixed(2)}%**\n`;
  text += `> Payout on win: **2x** bet (net +1x profit)\n`;
  text += `> Cashback on loss: **${(cashbackRate * 100).toFixed(2)}%** of bet returned`;

  return clampEmbed({
    title: `✦ ${username}'s Effects  - Coin Flip`,
    color: 0x2b2d31,
    fields: [
      { name: '🪙 Coin Flip', value: text, inline: false },
      { name: 'Legend', value: '> 🔧 Upgrades · 🎒 Items · ⭐ XP · ⏳ Temp', inline: false },
    ],
  });
}

function renderDuelPage(username, userId) {
  const baseChance = CONFIG.games.duel.winChance;
  const { totalBoost, modifier } = buildWinChanceSummary(userId);
  const effectiveChance = baseChance * modifier;
  const sign = totalBoost >= 0 ? '+' : '';
  const cashbackRate = store.getCashbackRate(userId);

  let text = `> Base win chance: **${(baseChance * 100).toFixed(1)}%**\n`;
  text += `> Win chance modifier: **${sign}${(totalBoost * 100).toFixed(1)}%** → multiplier **${modifier.toFixed(4)}x**\n`;
  text += `> Effective win chance: **${(effectiveChance * 100).toFixed(2)}%**\n`;
  text += `> Payout on win: **2x** stake (winner takes all)\n`;
  text += `> Cashback on loss: **${(cashbackRate * 100).toFixed(2)}%** of stake returned\n`;
  text += `> *Each player's modifier is computed from their own active effects.*`;

  return clampEmbed({
    title: `✦ ${username}'s Effects  - Duel`,
    color: 0x2b2d31,
    fields: [
      { name: '⚔️ Duel', value: text, inline: false },
      { name: 'Legend', value: '> 🔧 Upgrades · 🎒 Items · ⭐ XP · ⏳ Temp', inline: false },
    ],
  });
}

function renderLetItRidePage(username, userId) {
  const baseChance = CONFIG.games.letItRide.winChancePerRide;
  const { totalBoost, modifier } = buildWinChanceSummary(userId);
  const effectiveChance = baseChance * modifier;
  const sign = totalBoost >= 0 ? '+' : '';
  const cashbackRate = store.getCashbackRate(userId);

  let text = `> Base win chance per ride: **${(baseChance * 100).toFixed(1)}%**\n`;
  text += `> Win chance modifier: **${sign}${(totalBoost * 100).toFixed(1)}%** → multiplier **${modifier.toFixed(4)}x**\n`;
  text += `> Effective win chance per ride: **${(effectiveChance * 100).toFixed(2)}%**\n`;
  text += `> Each successful ride doubles your pot; a fail loses the original bet\n`;
  text += `> Cashback on loss: **${(cashbackRate * 100).toFixed(2)}%** of original bet returned`;

  return clampEmbed({
    title: `✦ ${username}'s Effects  - Let It Ride`,
    color: 0x2b2d31,
    fields: [
      { name: '🏇 Let It Ride', value: text, inline: false },
      { name: 'Legend', value: '> 🔧 Upgrades · 🎒 Items · ⭐ XP · ⏳ Temp', inline: false },
    ],
  });
}

function renderBlackjackPage(username, userId) {
  const cashbackRate = store.getCashbackRate(userId);
  const bjCfg = CONFIG.games.blackjack;

  let text = `> Dealer stands at: **${bjCfg.dealerStandValue}**\n`;
  text += `> Natural blackjack: **+${bjCfg.naturalBlackjackProfitMultiplier}x** profit (${1 + bjCfg.naturalBlackjackProfitMultiplier}x total payout)\n`;
  text += `> Regular win: **2x** bet (+1x profit)\n`;
  text += `> Push (tie): bet returned · Bust/loss: bet lost\n`;
  text += `> Double/Split available under standard rules\n`;
  text += `> Win chance modifier: **not applied**  - outcome is card-based\n`;
  text += `> Cashback on loss: **${(cashbackRate * 100).toFixed(2)}%** of bet returned`;

  return clampEmbed({
    title: `✦ ${username}'s Effects  - Blackjack`,
    color: 0x2b2d31,
    fields: [
      { name: '🃏 Blackjack', value: text, inline: false },
      { name: 'Legend', value: '> 🔧 Upgrades · 🎒 Items · ⭐ XP · ⏳ Temp', inline: false },
    ],
  });
}

function renderMinesPage(username, userId) {
  const bonuses = store.getUserBonuses(userId);
  const base = bonuses.base;
  const items = bonuses.items;
  const cashbackRate = store.getCashbackRate(userId);

  const rows = CONFIG.games.mines.rows;
  const cols = CONFIG.games.mines.cols;
  const total = rows * cols;
  const revealPct = ((base.minesRevealChance + items.minesRevealChance) * 100).toFixed(2);

  let text = `> Grid: **${rows}×${cols}** (${total} tiles total), mines: 1-15\n`;
  text += `> Each safe tile found multiplies the pot; hit a mine and you lose\n`;
  text += `> Mine save/reveal chance: **${revealPct}%**  - survives a mine hit\n`;
  if (items.minesRevealChance > 0) text += `> 🎒 Items: **+${(items.minesRevealChance * 100).toFixed(2)}%** (base is 0%)\n`;
  if (parseFloat(revealPct) === 0) text += `> *No mine save chance  - items only, upgrades don't affect mines*\n`;
  text += `> Win chance modifier: **not applied**  - tile picks are pure RNG\n`;
  text += `> Cashback on loss: **${(cashbackRate * 100).toFixed(2)}%** of bet returned`;

  return clampEmbed({
    title: `✦ ${username}'s Effects  - Mines`,
    color: 0x2b2d31,
    fields: [
      { name: '💣 Mines', value: text, inline: false },
      { name: 'Legend', value: '> 🔧 Upgrades · 🎒 Items · ⭐ XP · ⏳ Temp', inline: false },
    ],
  });
}

function renderRoulettePage(username, userId) {
  const cashbackRate = store.getCashbackRate(userId);
  const cfg = CONFIG.games.roulette;
  const wheelSize = cfg.wheelSize;
  const redCount = cfg.redNumbers.length;
  const blackCount = wheelSize - 1 - redCount;
  const redChance   = (redCount   / wheelSize * 100).toFixed(2);
  const blackChance = (blackCount / wheelSize * 100).toFixed(2);
  const greenChance = (1          / wheelSize * 100).toFixed(2);

  let text = `> Wheel: **${wheelSize}** numbers (includes 0)\n`;
  text += `> 🔴 Red (${redCount} numbers): **${redChance}%** → **2x** payout (+1x profit)\n`;
  text += `> ⚫ Black (${blackCount} numbers): **${blackChance}%** → **2x** payout (+1x profit)\n`;
  text += `> 🟩 Green (0): **${greenChance}%** → **${cfg.payoutProfitMultipliers.green + 1}x** payout (+${cfg.payoutProfitMultipliers.green}x profit)\n`;
  text += `> 🎲 All-In #${cfg.allIn.luckyNumber}: **${greenChance}%** → **${cfg.payoutProfitMultipliers.allIn17 + 1}x** payout (+${cfg.payoutProfitMultipliers.allIn17}x profit)\n`;
  text += `> Win chance modifier: **not applied**  - outcome is wheel-based\n`;
  text += `> Cashback on loss: **${(cashbackRate * 100).toFixed(2)}%** of bet returned`;

  return clampEmbed({
    title: `✦ ${username}'s Effects  - Roulette`,
    color: 0x2b2d31,
    fields: [
      { name: '🎡 Roulette', value: text, inline: false },
      { name: 'Legend', value: '> 🔧 Upgrades · 🎒 Items · ⭐ XP · ⏳ Temp', inline: false },
    ],
  });
}

function renderPage(username, userId, page) {
  switch (page) {
    case 'gameplay':  return renderGameplayPage(username, userId);
    case 'passive':   return renderPassivePage(username, userId);
    case 'flip':      return renderFlipPage(username, userId);
    case 'duel':      return renderDuelPage(username, userId);
    case 'letitride': return renderLetItRidePage(username, userId);
    case 'blackjack': return renderBlackjackPage(username, userId);
    case 'mines':     return renderMinesPage(username, userId);
    case 'roulette':  return renderRoulettePage(username, userId);
    default:          return renderGameplayPage(username, userId);
  }
}

// ─── Interaction handlers ─────────────────────────────────────────────────────

async function handleEffects(interaction) {
  const targetUser = interaction.options.getUser('user');
  const userId   = targetUser ? targetUser.id   : interaction.user.id;
  const username = targetUser ? targetUser.username : interaction.user.username;

  if (!store.hasWallet(userId)) {
    return interaction.reply({ content: `No data found for **${username}**.`, ephemeral: true });
  }

  const embed  = renderPage(username, userId, 'gameplay');
  const navRow = buildNavRow(interaction.user.id, userId, 'gameplay');
  return interaction.reply({ embeds: [embed], components: [navRow] });
}

async function handleEffectsSelectMenu(interaction) {
  // customId format: effects_tab_<viewerId>_<targetId>
  const parts    = interaction.customId.split('_');
  const viewerId = parts[2];
  const targetId = parts[3];
  const page     = interaction.values[0];

  if (interaction.user.id !== viewerId) {
    return interaction.reply({ content: 'This menu is not yours to use.', ephemeral: true });
  }

  let username = targetId;
  try {
    const member = await interaction.guild?.members.fetch(targetId);
    if (member?.user?.username) username = member.user.username;
  } catch { /* not in guild, fall back to id */ }

  if (!store.hasWallet(targetId)) {
    return interaction.reply({ content: 'No data found for that user.', ephemeral: true });
  }

  const embed  = renderPage(username, targetId, page);
  const navRow = buildNavRow(viewerId, targetId, page);
  return interaction.update({ embeds: [embed], components: [navRow] });
}

module.exports = { handleEffects, handleEffectsSelectMenu };
