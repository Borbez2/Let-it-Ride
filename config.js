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
      baseInvestRate: 0,
      interestAccrualMinuteMs: 60 * 1000,
      payoutIntervalMinutes: 60,
      // Tiered interest: interest is calculated in slabs (like tax brackets).
      // baseRate (= getInterestRate) applies fully to the first slab threshold,
      // then scales down progressively for higher balances.
      tieredInterest: {
        slabs: [
          { threshold: 1000000,             scale: 1 },       // Slab 1: 0 → 1M, full rate r
          { threshold: 10000000,            scale: 0.5 },     // Slab 2: 1M → 10M, r × 0.5
          { threshold: 100000000,           scale: 0.05 },    // Slab 3: 10M → 100M, r × 0.05
          { threshold: 1000000000,          scale: 0.01 },    // Slab 4: 100M → 1B, r × 0.01
          { threshold: 1000000000000,       scale: 0.0001 },  // Slab 5: 1B → 1T, r × 0.0001
          { threshold: 1000000000000000,    scale: 0.00005 }, // Slab 6: 1T → 1Q, r × 0.00005
          // Slab 7: above 1Q, r × 0.00001
        ],
        finalScale: 0.00001,
      },
    },
    pools: {
      universalTaxRate: 0.05,
      universalTaxMinNetWorth: 1000000, // Win tax only applies when net worth > 1M
      lossTaxRate: 0.05,
      hourlyPayoutMs: 60 * 60 * 1000,
      giveawayExpiryCheckMs: 30 * 1000,
      // Tiered contribution tax: larger wins are taxed at progressively lower
      // rates (mirrors bank interest slab design). Base rate = universalTaxRate.
      contributionSlabs: [
        { threshold: 100000,      scale: 1 },      // Slab 1: 0 → 100K, full 5%
        { threshold: 1000000,     scale: 0.5 },    // Slab 2: 100K → 1M, 2.5%
        { threshold: 10000000,    scale: 0.1 },    // Slab 3: 1M → 10M, 0.5%
        { threshold: 100000000,   scale: 0.05 },   // Slab 4: 10M → 100M, 0.25%
        { threshold: 1000000000,  scale: 0.01 },   // Slab 5: 100M → 1B, 0.05%
      ],
      contributionFinalScale: 0.005,               // Slab 6: above 1B, 0.025%
    },
    upgrades: {
      maxLevel: 10,
      interestPerLevel: 0.01,
      cashbackPerLevel: 0.001,
      universalIncomePerLevelChance: 0.1,
      universalIncomeChanceCap: 20,
      costs: {
        interest: [
          1000, 5000, 10000, 25000, 50000,
          100000, 250000, 500000, 750000, 1000000,
        ],
        cashback: [
          1000, 5000, 10000, 25000, 50000,
          100000, 250000, 500000, 750000, 1000000,
        ],
        spinMult: [
          1000, 5000, 10000, 25000, 50000,
          100000, 250000, 500000, 750000, 1000000,
        ],
        universalIncome: [
          1000, 5000, 10000, 25000, 50000,
          100000, 250000, 500000, 750000, 1000000,
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
        { key: '12h', label: '12h', seconds: 43200 },
        { key: '1d', label: '1d', seconds: 86400 },
        { key: '1w', label: '1w', seconds: 604800 },
        { key: '2w', label: '2w', seconds: 1209600 },
        { key: '1mo', label: '1mo', seconds: 2592000 },
        { key: '3mo', label: '3mo', seconds: 7776000 },
        { key: '6mo', label: '6mo', seconds: 15552000 },
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
    amountExamples: '100, 4.7k, 1.2m, 2b, 500t, all',
    invalidAmountText: 'Invalid amount. Use examples like "100", "4.7k", "1.2m", "2b", "500t", or "all"',
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
    rarityOrder: ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'divine'],
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
        common: 1600,
        uncommon: 3500,
        rare: 12000,
        epic: 30000,
        legendary: 100000,
        mythic: 300000,
        divine: 1250000,
      },
      pity: {
        luckPerStreakStep: 0.02,
        maxLuckBonus: 0.5,
      },
      luckWeightMultipliers: {
        common: { slope: -0.6, floor: 0.25 },
        uncommon: { slope: -0.35, floor: 0.35 },
        rare: { slope: 0.8, floor: null },
        epic: { slope: 1.4, floor: null },
        legendary: { slope: 1.8, floor: null },
        mythic: { slope: 2.6, floor: null },
        divine: { slope: 3.2, floor: null },
      },
      highRarityThreshold: 'epic',
      weightsByRarity: {
        common: 80,
        uncommon: 18.29,
        rare: 1,
        epic: 0.5,
        legendary: 0.15,
        mythic: 0.05,
        divine: 0.01,
      },
      // Per-item stat boosts: zeroed out — bonuses only come from completing a full set.
      // perItemDisplayBuff below defines the DISPLAYED value per item (informational only).
      statBoostPerItem: {
        common:    { interestRate: 0, cashbackRate: 0, minesRevealChance: 0, universalDoubleChance: 0, spinWeight: 0 },
        uncommon:  { interestRate: 0, cashbackRate: 0, minesRevealChance: 0, universalDoubleChance: 0, spinWeight: 0 },
        rare:      { interestRate: 0, cashbackRate: 0, minesRevealChance: 0, universalDoubleChance: 0, spinWeight: 0 },
        legendary: { interestRate: 0, cashbackRate: 0, minesRevealChance: 0, universalDoubleChance: 0, spinWeight: 0 },
        epic:      { interestRate: 0, cashbackRate: 0, minesRevealChance: 0, universalDoubleChance: 0, spinWeight: 0 },
        mythic:    { interestRate: 0, cashbackRate: 0, minesRevealChance: 0, universalDoubleChance: 0, spinWeight: 0 },
        divine:    { interestRate: 0, cashbackRate: 0, minesRevealChance: 0, universalDoubleChance: 0, spinWeight: 0 },
      },
      // Displayed buff per individual item (purely informational — unlocked only when full set is complete).
      // Each item shows ONE buff type cycling: interest → cashback → mines → income → spin.
      perItemDisplayBuff: {
        common:    { interestRate: 0.00001, cashbackRate: 0.000005, minesRevealChance: 0.00001, universalDoubleChance: 0.00002, spinWeight: 0.0001  },
        uncommon:  { interestRate: 0.00003, cashbackRate: 0.000015, minesRevealChance: 0.00003, universalDoubleChance: 0.00005, spinWeight: 0.0003  },
        rare:      { interestRate: 0.0001,  cashbackRate: 0.00005,  minesRevealChance: 0.0001,  universalDoubleChance: 0.0002,  spinWeight: 0.001   },
        epic:      { interestRate: 0.0003,  cashbackRate: 0.00015,  minesRevealChance: 0.0003,  universalDoubleChance: 0.0006,  spinWeight: 0.003   },
        legendary: { interestRate: 0.001,   cashbackRate: 0.0005,   minesRevealChance: 0.001,   universalDoubleChance: 0.002,   spinWeight: 0.01    },
        mythic:    { interestRate: 0.005,   cashbackRate: 0.0025,   minesRevealChance: 0.005,   universalDoubleChance: 0.01,    spinWeight: 0.05    },
        divine:    { interestRate: 0.02,    cashbackRate: 0.01,     minesRevealChance: 0.02,    universalDoubleChance: 0.04,    spinWeight: 0.2     },
      },
      // Bonus granted when ALL items of a rarity are collected (the only real economy effect).
      collectionCompleteBonus: {
        common:    { interestRate: 0.0005,  cashbackRate: 0.00025, minesRevealChance: 0.0005,  universalDoubleChance: 0.001,  spinWeight: 0.005  },
        uncommon:  { interestRate: 0.001,   cashbackRate: 0.0005,  minesRevealChance: 0.001,   universalDoubleChance: 0.002,  spinWeight: 0.01   },
        rare:      { interestRate: 0.002,   cashbackRate: 0.001,   minesRevealChance: 0.002,   universalDoubleChance: 0.005,  spinWeight: 0.02   },
        epic:      { interestRate: 0.005,   cashbackRate: 0.0025,  minesRevealChance: 0.005,   universalDoubleChance: 0.01,   spinWeight: 0.05   },
        legendary: { interestRate: 0.01,    cashbackRate: 0.005,   minesRevealChance: 0.01,    universalDoubleChance: 0.02,   spinWeight: 0.1    },
        mythic:    { interestRate: 0.02,    cashbackRate: 0.01,    minesRevealChance: 0.02,    universalDoubleChance: 0.05,   spinWeight: 0.25   },
        divine:    { interestRate: 0.05,    cashbackRate: 0.025,   minesRevealChance: 0.05,    universalDoubleChance: 0.1,    spinWeight: 0.5    },
      },
    },

    // Premium mystery box — no common tier, proportional odds
    premiumMysteryBox: {
      cost: 500000,
      duplicateCompensationByRarity: {
        uncommon: 3500,
        rare: 12000,
        epic: 30000,
        legendary: 100000,
        mythic: 300000,
        divine: 1250000,
      },
      pity: {
        luckPerStreakStep: 0.02,
        maxLuckBonus: 0.5,
      },
      luckWeightMultipliers: {
        uncommon:  { slope: -0.35, floor: 0.35 },
        rare:      { slope: 0.8,   floor: null  },
        epic:      { slope: 1.4,   floor: null  },
        legendary: { slope: 1.8,   floor: null  },
        mythic:    { slope: 2.6,   floor: null  },
        divine:    { slope: 3.2,   floor: null  },
      },
      highRarityThreshold: 'epic',
      // Proportional redistribution of non-common weights from the base box (sum ~20)
      weightsByRarity: {
        uncommon:  18.29,
        rare:       1,
        epic:       0.5,
        legendary:  0.15,
        mythic:     0.05,
        divine:     0.01,
      },
    },
  },

  // -------------------------------
  // Stats / analytics pages
  // -------------------------------
  stats: {
    defaultTimeframeKey: '1d',
    timeframes: [
      { key: '1min', label: '1min', seconds: 60 },
      { key: '5min', label: '5min', seconds: 300 },
      { key: '10min', label: '10min', seconds: 600 },
      { key: '30min', label: '30min', seconds: 1800 },
      { key: '1h', label: '1h', seconds: 3600 },
      { key: '6h', label: '6h', seconds: 21600 },
      { key: '12h', label: '12h', seconds: 43200 },
      { key: '1d', label: '1d', seconds: 86400 },
      { key: '1w', label: '1w', seconds: 604800 },
      { key: '2w', label: '2w', seconds: 1209600 },
      { key: '1mo', label: '1mo', seconds: 2592000 },
      { key: '3mo', label: '3mo', seconds: 7776000 },
      { key: '6mo', label: '6mo', seconds: 15552000 },
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
      // Tiered retention: older data is compacted to coarser resolution.
      // Each tier keeps at most 1 point per bucketMs (0 = keep all raw).
      // Tiers are evaluated oldest-first; the first tier whose maxAgeMs
      // exceeds the point's age determines its bucket size.
      retentionTiers: [
        { maxAgeMs: 1 * 60 * 60 * 1000,       bucketMs: 0 },                     // < 1h:   raw
        { maxAgeMs: 6 * 60 * 60 * 1000,       bucketMs: 2 * 60 * 1000 },         // 1h-6h:  1 per 2 min
        { maxAgeMs: 24 * 60 * 60 * 1000,      bucketMs: 10 * 60 * 1000 },        // 6h-1d:  1 per 10 min
        { maxAgeMs: 7 * 24 * 60 * 60 * 1000,  bucketMs: 30 * 60 * 1000 },        // 1d-7d:  1 per 30 min
        { maxAgeMs: 30 * 24 * 60 * 60 * 1000, bucketMs: 3 * 60 * 60 * 1000 },    // 7d-30d: 1 per 3 h
        { maxAgeMs: Infinity,                  bucketMs: 24 * 60 * 60 * 1000 },   // >30d:   1 per day
      ],
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
  else if (i <= 100) rarity = 'epic';
  else if (i <= 110) rarity = 'legendary';
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

const PREMIUM_MYSTERY_BOX_POOLS = Object.fromEntries(
  Object.entries(CONFIG.collectibles.premiumMysteryBox.weightsByRarity).map(([rarity, weight]) => [
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
const UPGRADE_COSTS = CONFIG.economy.upgrades.costs.interest;
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
  PREMIUM_MYSTERY_BOX_POOLS,
};
