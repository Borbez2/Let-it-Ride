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
          { threshold: 1000000,             scale: 1 },       // Slab 1: 0 → 1M, base rate r
          { threshold: 10000000,            scale: 0.9 },     // Slab 2: 1M → 10M, slight drop
          { threshold: 100000000,           scale: 0.8 },    // Slab 3: 10M → 100M, modest drop
          { threshold: 1000000000,          scale: 0.6 },    // Slab 4: 100M → 1B, noticeable drop
          { threshold: 1000000000000,       scale: 0.4 },  // Slab 5: 1B → 1T, steeper drop
          { threshold: 1000000000000000,    scale: 0.2 }, // Slab 6: 1T → 1Q, much lower rate
          // above 1Q will use finalScale
        ],
        finalScale: 0.1,
      },
    },
    pools: {
      universalTaxRate: 0.005,
      universalTaxMinNetWorth: 0, // Win tax always applies
      lossTaxRate: 0.005,
      hourlyPayoutMs: 60 * 60 * 1000,
      giveawayExpiryCheckMs: 30 * 1000,
      // Tiered contribution tax: larger wins are taxed at progressively lower
      // rates (mirrors bank interest slab design). Base rate = universalTaxRate.
      // Tiered contribution tax: larger wins are taxed at progressively lower
      // rates (mirrors bank interest slab design). Base rate = universalTaxRate.
      // Buffed so tiny wins funnel much more back into the pool while high-roll
      // jackpots contribute only a sliver.
      contributionSlabs: [
        { threshold: 100000,      scale: 10 },     // Slab 1: 0 → 100K, 10× base rate
        { threshold: 1000000,     scale: 1 },      // Slab 2: 100K → 1M, base rate
        { threshold: 10000000,    scale: 0.5 },    // Slab 3: 1M → 10M, half rate
        { threshold: 100000000,   scale: 0.2 },    // Slab 4: 10M → 100M, 20% rate
        { threshold: 1000000000,  scale: 0.1 },    // Slab 5: 100M → 1B, 10% rate
      ],
      contributionFinalScale: 0.005,               // Slab 6: above 1B, 0.5% of base
    },
    upgrades: {
      maxLevel: 100,
      interestPerLevel: 0.001,        // 1/10th of old: 100 levels × 0.001 = 0.10 total (same as old 10 × 0.01)
      cashbackPerLevel: 0.00005,      // 1/10th of old: 100 levels × 0.00005 = 0.005 total
      spinMultPerLevel: 0.01,         // 1/10th of old: 100 levels × 0.01 = 1.0 total (spin = 1 + lvl*0.01, max 2.0)
      universalIncomePerLevelChance: 0.01,  // 1/10th of old: 100 levels × 0.01 = 1.0 total
      universalIncomeChanceCap: 20,
      // Cost generation parameters (exponential curve, shared for all upgrades).
      // Cost formula: floor(baseCost * growthRate^level)
      // Tuned so level 100 costs approximately 1 billion coins instead of 1 trillion.
      // baseCost=1000 (level 1 start), growthRate≈1.15: 1000*1.15^99 ≈ 1e9
      costParams: {
        baseCost: 1000,       // cost of level 1
        growthRate: 1.15,     // exponential growth; level 100 ≈ 1B
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
    // order matters -- earlier rarities are treated as "lower" than later
    // ones for display and sorting purposes. we append the two new exotic tiers
    // at the very end so they appear most prominently in UIs.
    rarityOrder: ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'divine', 'special', 'godly'],
    rarities: {
      common:     { emoji: '⬜', color: null },
      uncommon:   { emoji: '🟩', color: null },
      rare:       { emoji: '🟦', color: null },
      legendary:  { emoji: '🟨', color: null },
      epic:       { emoji: '🟪', color: null },
      mythic:     { emoji: '🩷', color: null },
      divine:     { emoji: '🩵', color: null },
      special:    { emoji: '🔴', color: null },   // obscenely rare red-tier items
      godly:      { emoji: '🟡', color: null },   // single golden item
    },
  },

  // -------------------------------
  // Mystery box / collectibles
  // -------------------------------
  collectibles: {
    // total items across every rarity. we no longer use a flat perRarity count
    // because rarities are highly imbalanced: commons dominate while high-end
    // tiers are extremely scarce. totalPlaceholders MUST equal the sum of the
    // numbers below, otherwise the generated arrays will be wrong.
    totalPlaceholders: 1000,
    perRarity: null,          // kept for legacy code but no longer used; see help text
    // explicit count for each rarity (must add to totalPlaceholders).
    // values are intentionally descending; higher rarities have fewer items.
    countByRarity: {
      common:    400,
      uncommon:  300,
      rare:      150,
      epic:       80,
      legendary:  40,
      mythic:     20,
      divine:      5,
      special:     3,
      godly:       2,
    },
    mysteryBox: {
      cost: 5000,
      duplicateCompensationByRarity: {
        common:    1600,
        uncommon:  3500,
        rare:      12000,
        epic:      30000,
        legendary: 100000,
        mythic:    300000,
        divine:    1250000,
        special:   5000000,
        godly:     10000000,
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
        common:    80,
        uncommon:  18.29,
        rare:       1,
        epic:       0.5,
        legendary:  0.15,
        mythic:     0.05,
        divine:     0.01,
        special:   0.0005,   // extremely low drop rate
        godly:     0.0001,   // single-item godly tier
      },
      // Per-item stat boosts are now active.  For the first three rarity tiers
      // (common/uncommon/rare) each collectible provides tiny passive bonuses to
      // the standard economy stats (interest, cashback, income, spin weight).
      // rarities **legendary and above no longer have a uniform effect** –
      // instead, individual collectibles may carry their own bespoke game
      // triggers (see CUSTOM_COLLECTIBLES above for examples). this lets us
      // give each item a little personality rather than a flat buff.
      statBoostPerItem: {
        // base buffs - no mines save
        common:    { interestRate: 0.000003, cashbackRate: 0.0000005, minesRevealChance: 0, universalDoubleChance: 0.000013, spinWeight: 0.000065 },
        uncommon:  { interestRate: 0.000009, cashbackRate: 0.0000015, minesRevealChance: 0, universalDoubleChance: 0.000033, spinWeight: 0.0002   },
        rare:      { interestRate: 0.00003,  cashbackRate: 0.000005,  minesRevealChance: 0, universalDoubleChance: 0.00013,  spinWeight: 0.00065  },
        legendary: { interestRate: 0, cashbackRate: 0, minesRevealChance: 0, universalDoubleChance: 0, spinWeight: 0 },
        epic:      { interestRate: 0, cashbackRate: 0, minesRevealChance: 0, universalDoubleChance: 0, spinWeight: 0 },
        mythic:    { interestRate: 0, cashbackRate: 0, minesRevealChance: 0, universalDoubleChance: 0, spinWeight: 0 },
        divine:    { interestRate: 0, cashbackRate: 0, minesRevealChance: 0, universalDoubleChance: 0, spinWeight: 0 },
        special:   { interestRate: 0, cashbackRate: 0, minesRevealChance: 0, universalDoubleChance: 0, spinWeight: 0 },
        godly:     { interestRate: 0, cashbackRate: 0, minesRevealChance: 0, universalDoubleChance: 0, spinWeight: 0 },
      },
      // Displayed buff per individual item (purely informational - unlocked only when full set is complete).
      // Each item shows ONE buff type cycling: interest → cashback → mines → income → spin.
      // Nerfed: cashback/interest kept tight; payout mult and income chance slightly more generous.
      perItemDisplayBuff: {
        // keep mines zero for clarity (actual buffs no longer include it for base tiers)
        common:    { interestRate: 0.000003, cashbackRate: 0.0000005, minesRevealChance: 0, universalDoubleChance: 0.000013, spinWeight: 0.000065 },
        uncommon:  { interestRate: 0.000009, cashbackRate: 0.0000015, minesRevealChance: 0, universalDoubleChance: 0.000033, spinWeight: 0.0002   },
        rare:      { interestRate: 0.00003,  cashbackRate: 0.000005,  minesRevealChance: 0, universalDoubleChance: 0.00013,  spinWeight: 0.00065  },
        // beyond rare the per-item display no longer reflects active bonuses
        epic:      { interestRate: 0, cashbackRate: 0, minesRevealChance: 0, universalDoubleChance: 0, spinWeight: 0 },
        legendary: { interestRate: 0, cashbackRate: 0, minesRevealChance: 0, universalDoubleChance: 0, spinWeight: 0 },
        mythic:    { interestRate: 0, cashbackRate: 0, minesRevealChance: 0, universalDoubleChance: 0, spinWeight: 0 },
        divine:    { interestRate: 0, cashbackRate: 0, minesRevealChance: 0, universalDoubleChance: 0, spinWeight: 0 },
        special:   { interestRate: 0, cashbackRate: 0, minesRevealChance: 0, universalDoubleChance: 0, spinWeight: 0 },
        godly:     { interestRate: 0, cashbackRate: 0, minesRevealChance: 0, universalDoubleChance: 0, spinWeight: 0 },
      },
      // Bonus granted when ALL items of a rarity are collected (the only real economy effect).
      // Nerfed: cashback/interest kept in check; payout mult and income chance more generous.
      collectionCompleteBonus: {
        common:    { interestRate: 0.00015,  cashbackRate: 0.00002,  minesRevealChance: 0.00025, universalDoubleChance: 0.0006,  spinWeight: 0.003  },
        uncommon:  { interestRate: 0.0003,   cashbackRate: 0.00005,  minesRevealChance: 0.0005,  universalDoubleChance: 0.0013,  spinWeight: 0.007  },
        rare:      { interestRate: 0.0006,   cashbackRate: 0.0001,   minesRevealChance: 0.001,   universalDoubleChance: 0.003,   spinWeight: 0.013  },
        epic:      { interestRate: 0.0015,   cashbackRate: 0.0003,   minesRevealChance: 0.002,   universalDoubleChance: 0.006,   spinWeight: 0.03   },
        legendary: { interestRate: 0.004,    cashbackRate: 0.0008,   minesRevealChance: 0.005,   universalDoubleChance: 0.013,   spinWeight: 0.065  },
        mythic:    { interestRate: 0.009,    cashbackRate: 0.0018,   minesRevealChance: 0.012,   universalDoubleChance: 0.032,   spinWeight: 0.16   },
        divine:    { interestRate: 0.015,    cashbackRate: 0.003,    minesRevealChance: 0.025,   universalDoubleChance: 0.065,   spinWeight: 0.32   },
        special:   { interestRate: 0.03,     cashbackRate: 0.006,    minesRevealChance: 0.05,   universalDoubleChance: 0.15,   spinWeight: 0.7    },
        godly:     { interestRate: 0.06,     cashbackRate: 0.012,    minesRevealChance: 0.1,    universalDoubleChance: 0.3,   spinWeight: 1.5    },
      },
    },

    // Premium mystery box - no common tier, proportional odds
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
        uncommon:   18.29,
        rare:        1,
        epic:        0.5,
        legendary:   0.15,
        mythic:      0.05,
        divine:      0.01,
        special:     0.0005,
        godly:       0.0001,
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
  // XP system
  // -------------------------------
  xp: {
    perGame: 25,           // flat XP per completed game, not scaled by bet
    levelCostParams: {
      baseCost: 100,       // XP required to go from level 0→1
      growthRate: 1.08,    // exponential growth; creates an exponential curve
    },
    maxLevel: 500,
    // Ranks unlocked at milestone levels; later entries override earlier ones.
    // Added more steps and more evocative titles for long-term progression.
    titles: [
      { minLevel: 0,   title: 'Newbie' },
      { minLevel: 5,   title: 'Trainee' },
      { minLevel: 10,  title: 'Novice Gambler' },
      { minLevel: 25,  title: 'Regular' },
      { minLevel: 50,  title: 'High Roller' },
      { minLevel: 75,  title: 'Maverick' },
      { minLevel: 100, title: 'Veteran' },
      { minLevel: 150, title: 'Pro' },
      { minLevel: 200, title: 'Sharpshooter' },
      { minLevel: 250, title: 'Ace' },
      { minLevel: 300, title: 'Legend' },
      { minLevel: 350, title: 'Mythic' },
      { minLevel: 400, title: 'Divine' },
      { minLevel: 450, title: 'Transcendent' },
      { minLevel: 500, title: 'Immortal' },
    ],
    // Tiny cumulative stat bonuses awarded every 10 XP levels
    bonusPerTenLevels: {
      interestRate: 0.0002,         // +0.02% bank interest per 10 levels
      cashbackRate: 0.00003,        // +0.003% loss cashback per 10 levels
      universalDoubleChance: 0.002, // +0.2% income double chance per 10 levels
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
      { name: 'XP, Ranks & Boosts', value: 'xpranks' },
      { name: 'Command Reference', value: 'commands' },
    ],
  },
};

CONFIG.games.mines.total = CONFIG.games.mines.rows * CONFIG.games.mines.cols;

// ── Generate upgrade cost arrays from costParams ──
// All 4 upgrades share the same exponential cost curve.
// To tune costs, only modify costParams.baseCost and costParams.growthRate above.
(() => {
  const { baseCost, growthRate } = CONFIG.economy.upgrades.costParams;
  const maxLevel = CONFIG.economy.upgrades.maxLevel;
  const costs = [];
  for (let i = 0; i < maxLevel; i++) {
    costs.push(Math.floor(baseCost * Math.pow(growthRate, i)));
  }
  CONFIG.economy.upgrades.costs = {
    interest: [...costs],
    cashback: [...costs],
    spinMult: [...costs],
    universalIncome: [...costs],
  };
})();

// ── Generate XP level thresholds array from XP levelCostParams ──
// xpLevelThresholds[i] = XP required to advance FROM level i TO level i+1.
// Grows exponentially so each level step demands more XP than the previous.
(() => {
  const { baseCost, growthRate } = CONFIG.xp.levelCostParams;
  const maxLevel = CONFIG.xp.maxLevel;
  const thresholds = [];
  for (let i = 0; i < maxLevel; i++) {
    thresholds.push(Math.floor(baseCost * Math.pow(growthRate, i)));
  }
  CONFIG.xp.levelThresholds = thresholds;
})();

// ---------- Custom / unique items ----------
// higher‑rarity collectibles can carry small, game‑specific effects instead
// of the boring stat boosts that common/uncommon/rare items use. we only
// define a handful here as examples; future items can be added to
// `CUSTOM_COLLECTIBLES` and will automatically be slotted into whatever
// rarity quota remains.
const CUSTOM_COLLECTIBLES = [
  {
    id: 'legendary_scary_mask',
    name: 'Scary Mask',
    rarity: 'legendary',
    emoji: '🎭',
    description: '1% extra chance to win duels.',
    effect: { type: 'duelWinBoost', value: 0.01, label: '🎭 Duel +1% win chance' },
  },
  {
    id: 'legendary_quantum_coin',
    name: 'Quantum Coin',
    rarity: 'legendary',
    emoji: '🪙',
    description: '2% chance to triple coin flip payout.',
    effect: { type: 'flipTripleChance', value: 0.02, label: '🪙 2% flip 3x payout' },
  },
  // additional examples below – no logic is wired up for them yet, but
  // they demonstrate the structure and will show up in the UI.
  {
    id: 'epic_blazing_dice',
    name: 'Blazing Dice',
    rarity: 'epic',
    emoji: '🎲',
    description: 'Mildly lucky on the roulette wheel.',
    effect: { type: 'rouletteEdge', value: 0.01, label: '🎲 Roulette edge +1%' },
  },
  {
    id: 'mythic_star_amulet',
    name: 'Star Amulet',
    rarity: 'mythic',
    emoji: '✨',
    description: 'Subtle bonus on all games.',
    effect: { type: 'genericBonus', value: 0.005, label: '✨ Generic bonus +0.5%' },
  },
];

const COLLECTIBLES = [];
const RARITY_ORDER_KEYS = CONFIG.ui.rarityOrder;
const COUNT_BY_RARITY = CONFIG.collectibles.countByRarity || {};
let collectibleIdx = 0;

for (const rarity of RARITY_ORDER_KEYS) {
  const count = COUNT_BY_RARITY[rarity] || 0;
  // first insert any custom items for this rarity, decrementing the
  // placeholder quota so the overall totals remain consistent
  const customs = CUSTOM_COLLECTIBLES.filter(item => item.rarity === rarity);
  for (const item of customs) {
    collectibleIdx++;
    COLLECTIBLES.push({
      id: item.id,
      name: item.name,
      rarity: item.rarity,
      emoji: item.emoji,
      description: item.description,
      customEffect: item.effect,
      // store the original slot index for informational purposes
      _placeholderIndex: collectibleIdx,
    });
  }

  for (let j = 1; j <= count - customs.length; j++) {
    collectibleIdx++;
    COLLECTIBLES.push({
      id: `placeholder_${collectibleIdx}`,
      name: `Placeholder ${collectibleIdx}/${CONFIG.collectibles.totalPlaceholders}`,
      rarity,
      emoji: CONFIG.ui.rarities[rarity].emoji,
    });
  }
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
