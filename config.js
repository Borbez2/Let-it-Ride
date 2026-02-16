// ─── Constants ───
const STARTING_COINS = 1000;
const DAILY_BASE = 500;
const DAILY_STREAK_BONUS = 50;
const BASE_INVEST_RATE = 0.01;
const POOL_TAX_RATE = 0.05;
const LOSS_POOL_RATE = 0.05 ;
const MYSTERY_BOX_COST = 5000;

const UPGRADE_COSTS = [
  1000, 5000, 25000, 100000, 500000,
  2000000, 10000000, 50000000, 200000000, 750000000
];
const SPIN_MULT_COSTS = [
  2000, 10000, 50000, 200000, 1000000,
  5000000, 20000000, 100000000, 500000000, 2000000000
];

// ─── Mines grid ───
const MINES_ROWS = 4;
const MINES_COLS = 5;
const MINES_TOTAL = MINES_ROWS * MINES_COLS;

// ─── Collectibles ───
const RARITIES = {
  common:    { emoji: '⬜', color: null },
  uncommon:  { emoji: '🟩', color: null },
  rare:      { emoji: '🟦', color: null },
  legendary: { emoji: '🟨', color: null },
  epic:      { emoji: '🟪', color: null },
  mythic:    { emoji: '🩷', color: null },
  divine:    { emoji: '🩵', color: null },
};

const COLLECTIBLES = [];
for (let i = 1; i <= 120; i++) {
  let rarity;
  if (i <= 40)       rarity = 'common';
  else if (i <= 65)  rarity = 'uncommon';
  else if (i <= 85)  rarity = 'rare';
  else if (i <= 100) rarity = 'legendary';
  else if (i <= 110) rarity = 'epic';
  else if (i <= 115) rarity = 'mythic';
  else               rarity = 'divine';

  COLLECTIBLES.push({
    id: `placeholder_${i}`,
    name: `Placeholder ${i}/120`,
    rarity,
    emoji: RARITIES[rarity].emoji,
  });
}

const MYSTERY_BOX_POOLS = {
  common:    { weight: 50, items: COLLECTIBLES.filter(c => c.rarity === 'common') },
  uncommon:  { weight: 30, items: COLLECTIBLES.filter(c => c.rarity === 'uncommon') },
  rare:      { weight: 12, items: COLLECTIBLES.filter(c => c.rarity === 'rare') },
  legendary: { weight: 5,  items: COLLECTIBLES.filter(c => c.rarity === 'legendary') },
  epic:      { weight: 2,  items: COLLECTIBLES.filter(c => c.rarity === 'epic') },
  mythic:    { weight: 0.8, items: COLLECTIBLES.filter(c => c.rarity === 'mythic') },
  divine:    { weight: 0.2, items: COLLECTIBLES.filter(c => c.rarity === 'divine') },
};

module.exports = {
  STARTING_COINS, DAILY_BASE, DAILY_STREAK_BONUS,
  BASE_INVEST_RATE, POOL_TAX_RATE, LOSS_POOL_RATE,
  MYSTERY_BOX_COST, UPGRADE_COSTS, SPIN_MULT_COSTS,
  MINES_ROWS, MINES_COLS, MINES_TOTAL,
  RARITIES, COLLECTIBLES, MYSTERY_BOX_POOLS,
};
