// ===============================
// MASTER CONFIG FILE
// ===============================
// This file is the central source of truth for economy values, game tuning,
// message text fragments, command limits, channel IDs, and runtime bounds.
//
// NOTE:
// - New code should prefer CONFIG.<section> access.
// - Legacy top-level exports are still provided at the bottom for compatibility.

const CONFIG = {
  // -------------------------------
  // Core economy system
  // -------------------------------
  economy: {
    startingCoins: 1000,
    daily: {
      baseReward: 500,
      streakBonusPerDay: 50,
      claimCooldownMs: 24 * 60 * 60 * 1000,
      streakBreakMs: 48 * 60 * 60 * 1000,
    },
    bank: {
      baseInvestRate: 0.01,
      interestAccrualMinuteMs: 60 * 1000,
      payoutIntervalMinutes: 60,
    },
    pools: {
      universalTaxRate: 0.05,
      lossTaxRate: 0.05,
      hourlyPayoutMs: 60 * 60 * 1000,
      giveawayExpiryCheckMs: 30 * 1000,
    },
    upgrades: {
      maxLevel: 10,
      interestPerLevel: 0.01,
      cashbackPerLevel: 0.001,
      universalIncomePerLevelChance: 0.01,
      universalIncomeChanceCap: 0.75,
      costs: {
        standard: [
          1000, 5000, 25000, 100000, 500000,
          2000000, 10000000, 50000000, 200000000, 750000000,
        ],
        spinMult: [
          2000, 10000, 50000, 200000, 1000000,
          5000000, 20000000, 100000000, 500000000, 2000000000,
        ],
      },
    },
  },

  // -------------------------------
  // Bot runtime and channels
  // -------------------------------
  bot: {
    channels: {
      dailyEvents: '1467976012645269676',
      hourlyPayout: '1473595731893027000',
      lifeStats: '1473753550332104746',
      giveaway: '1467976012645269676',
    },
    graph: {
      liveSlotSeconds: 10,
      maxUsers: 20,
      sessionTtlMs: 30 * 60 * 1000,
      defaultTimeframeSec: 7 * 24 * 60 * 60,
      publicRefreshMs: 60 * 1000,
      timeframes: [
        { key: '1min', label: '1min', seconds: 60 },
        { key: '5min', label: '5min', seconds: 300 },
        { key: '10min', label: '10min', seconds: 600 },
        { key: '30min', label: '30min', seconds: 1800 },
        { key: '1h', label: '1h', seconds: 3600 },
        { key: '6h', label: '6h', seconds: 21600 },
        { key: '1d', label: '1d', seconds: 86400 },
        { key: '1w', label: '1w', seconds: 604800 },
        { key: '6m', label: '6m', seconds: 15552000 },
        { key: '1y', label: '1y', seconds: 31536000 },
        { key: 'all', label: 'all', seconds: null },
      ],
    },
    scheduler: {
      dailySpinHourLocal: 11,
      dailySpinMinuteLocal: 15,
    },
  },

  // -------------------------------
  // Shared command UX
  // -------------------------------
  commands: {
    amountExamples: '100, 4.7k, 1.2m, all',
    invalidAmountText: 'Invalid amount. Use examples like "100", "4.7k", "1.2m", or "all"',
    limits: {
      flipQuantity: { min: 1, max: 10 },
      minesCount: { min: 1, max: 15 },
      mysteryBoxQuantity: { min: 1, max: 50 },
      inventoryPerPage: 15,
    },
  },

  // -------------------------------
  // Game design tuning
  // -------------------------------
  games: {
    flip: {
      winChance: 0.5,
      winMarker: 'W',
      lossMarker: 'L',
    },
    roulette: {
      wheelSize: 37,
      greenNumber: 0,
      redNumbers: [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36],
      payoutProfitMultipliers: {
        redOrBlack: 1,
        green: 13,
        allIn17: 35,
      },
      labels: {
        red: 'Red (2x)',
        black: 'Black (2x)',
        green: 'Green 0 (14x)',
      },
      allIn: {
        luckyNumber: 17,
      },
    },
    blackjack: {
      dealerStandValue: 17,
      naturalBlackjackProfitMultiplier: 1.5,
      labels: {
        title: '🃏 **Blackjack**',
        splitTitle: '🃏 **Blackjack (Split)**',
        resultBase: 'Blackjack',
        resultDoubled: 'Blackjack - Doubled',
      },
    },
    mines: {
      rows: 4,
      cols: 5,
      symbols: {
        hidden: '·',
        revealedSafe: 'O',
        mine: 'X',
        explodedMine: '!',
      },
    },
    letItRide: {
      winChancePerRide: 0.5,
    },
    duel: {
      winChance: 0.5,
    },
  },

  // -------------------------------
  // Shared emojis and rarity model
  // -------------------------------
  ui: {
    rarityOrder: ['common', 'uncommon', 'rare', 'legendary', 'epic', 'mythic', 'divine'],
    rarities: {
      common: { emoji: '⬜', color: null },
      uncommon: { emoji: '🟩', color: null },
      rare: { emoji: '🟦', color: null },
      legendary: { emoji: '🟨', color: null },
      epic: { emoji: '🟪', color: null },
      mythic: { emoji: '🩷', color: null },
      divine: { emoji: '🩵', color: null },
    },
  },

  // -------------------------------
  // Mystery box / collectibles
  // -------------------------------
  collectibles: {
    totalPlaceholders: 120,
    mysteryBox: {
      cost: 5000,
      duplicateCompensationByRarity: {
        common: 2000,
        uncommon: 3500,
        rare: 6000,
        epic: 12000,
        legendary: 20000,
        mythic: 60000,
        divine: 150000,
      },
      pity: {
        luckPerStreakStep: 0.02,
        maxLuckBonus: 0.5,
      },
      luckWeightMultipliers: {
        common: { slope: -0.6, floor: 0.25 },
        uncommon: { slope: -0.35, floor: 0.35 },
        rare: { slope: 0.8, floor: null },
        legendary: { slope: 1.4, floor: null },
        epic: { slope: 1.8, floor: null },
        mythic: { slope: 2.6, floor: null },
        divine: { slope: 3.2, floor: null },
      },
      highRarityThreshold: 'legendary',
      weightsByRarity: {
        common: 50,
        uncommon: 30,
        rare: 12,
        legendary: 2,
        epic: 5,
        mythic: 0.8,
        divine: 0.2,
      },
    },
  },

  // -------------------------------
  // Stats / analytics pages
  // -------------------------------
  stats: {
    defaultTimeframeKey: '1w',
    timeframes: [
      { key: '1min', label: '1min', seconds: 60 },
      { key: '5min', label: '5min', seconds: 300 },
      { key: '10min', label: '10min', seconds: 600 },
      { key: '30min', label: '30min', seconds: 1800 },
      { key: '1h', label: '1h', seconds: 3600 },
      { key: '6h', label: '6h', seconds: 21600 },
      { key: '1d', label: '1d', seconds: 86400 },
      { key: '1w', label: '1w', seconds: 604800 },
      { key: '6m', label: '6m', seconds: 15552000 },
      { key: '1y', label: '1y', seconds: 31536000 },
      { key: 'all', label: 'all', seconds: null },
    ],
    games: ['flip', 'roulette', 'blackjack', 'mines', 'letitride', 'duel'],
    theoreticalWinChance: {
      flip: 0.5,
      roulette: 18 / 37,
      blackjack: 0.48,
      mines: null,
      letitride: 0.5,
      duel: 0.5,
    },
  },

  // -------------------------------
  // Runtime tuning / admin controls
  // -------------------------------
  runtime: {
    defaults: {
      lifeStatsIntervalMs: 10000,
      globalEvScalar: 1,
      binomialPityThreshold: 97,
      binomialPityBoostRate: 0.01,
      binomialPityDurationMinutes: 30,
      binomialPityCooldownMinutes: 15,
    },
    bounds: {
      lifeStatsIntervalMs: { min: 10000, max: 600000 },
      globalEvScalar: { min: 0, max: 5 },
      binomialPityThreshold: { min: 50, max: 99.999 },
      binomialPityBoostRate: { min: 0, max: 0.5 },
      binomialPityDurationMinutes: { min: 1, max: 1440 },
      binomialPityCooldownMinutes: { min: 0, max: 1440 },
    },
    pity: {
      maxBoostRate: 0.1,
      thresholds: [60, 70, 80, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99],
    },
    networthHistory: {
      defaultMinWriteMs: 15 * 60 * 1000,
      heartbeatMinWriteMs: 10 * 1000,
      minDelta: 1000,
      maxEntries: 240,
    },
  },

  // -------------------------------
  // Help / docs content knobs
  // -------------------------------
  help: {
    topics: [
      { name: 'General Economy', value: 'general' },
      { name: 'Universal Income', value: 'universalincome' },
      { name: 'Collectibles', value: 'collectibles' },
      { name: 'Games and EV', value: 'games' },
      { name: 'Luck, Pity, and Modifiers', value: 'modifiers' },
      { name: 'Mystery Boxes', value: 'mysteryboxes' },
      { name: 'Command Reference', value: 'commands' },
    ],
  },
};

CONFIG.games.mines.total = CONFIG.games.mines.rows * CONFIG.games.mines.cols;

const COLLECTIBLES = [];
for (let i = 1; i <= CONFIG.collectibles.totalPlaceholders; i++) {
  let rarity;
  if (i <= 40) rarity = 'common';
  else if (i <= 65) rarity = 'uncommon';
  else if (i <= 85) rarity = 'rare';
  else if (i <= 100) rarity = 'legendary';
  else if (i <= 110) rarity = 'epic';
  else if (i <= 115) rarity = 'mythic';
  else rarity = 'divine';

  COLLECTIBLES.push({
    id: `placeholder_${i}`,
    name: `Placeholder ${i}/${CONFIG.collectibles.totalPlaceholders}`,
    rarity,
    emoji: CONFIG.ui.rarities[rarity].emoji,
  });
}

const MYSTERY_BOX_POOLS = Object.fromEntries(
  Object.entries(CONFIG.collectibles.mysteryBox.weightsByRarity).map(([rarity, weight]) => [
    rarity,
    { weight, items: COLLECTIBLES.filter((item) => item.rarity === rarity) },
  ])
);

// ---------------------------------------
// Backward-compat aliases (legacy imports)
// ---------------------------------------
const STARTING_COINS = CONFIG.economy.startingCoins;
const DAILY_BASE = CONFIG.economy.daily.baseReward;
const DAILY_STREAK_BONUS = CONFIG.economy.daily.streakBonusPerDay;
const BASE_INVEST_RATE = CONFIG.economy.bank.baseInvestRate;
const POOL_TAX_RATE = CONFIG.economy.pools.universalTaxRate;
const LOSS_POOL_RATE = CONFIG.economy.pools.lossTaxRate;
const MYSTERY_BOX_COST = CONFIG.collectibles.mysteryBox.cost;
const UPGRADE_COSTS = CONFIG.economy.upgrades.costs.standard;
const SPIN_MULT_COSTS = CONFIG.economy.upgrades.costs.spinMult;
const MINES_ROWS = CONFIG.games.mines.rows;
const MINES_COLS = CONFIG.games.mines.cols;
const MINES_TOTAL = CONFIG.games.mines.total;
const RARITIES = CONFIG.ui.rarities;

module.exports = {
  CONFIG,
  STARTING_COINS,
  DAILY_BASE,
  DAILY_STREAK_BONUS,
  BASE_INVEST_RATE,
  POOL_TAX_RATE,
  LOSS_POOL_RATE,
  MYSTERY_BOX_COST,
  UPGRADE_COSTS,
  SPIN_MULT_COSTS,
  MINES_ROWS,
  MINES_COLS,
  MINES_TOTAL,
  RARITIES,
  COLLECTIBLES,
  MYSTERY_BOX_POOLS,
};
