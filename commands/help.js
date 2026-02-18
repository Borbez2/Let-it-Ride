const { MYSTERY_BOX_COST, MYSTERY_BOX_POOLS, POOL_TAX_RATE, LOSS_POOL_RATE, RARITIES } = require('../config');
const store = require('../data/store');

async function handleHelp(interaction) {
  const topic = interaction.options.getString('topic') || 'general';

  if (topic === 'general' || topic === 'universalincome' || topic === 'collectibles') {
    const taxPct = (POOL_TAX_RATE * 100).toFixed(0);
    const lossPct = (LOSS_POOL_RATE * 100).toFixed(0);
    const rarityOrder = ['common', 'uncommon', 'rare', 'legendary', 'epic', 'mythic', 'divine'];
    const poolEntries = rarityOrder
      .map((rarity) => [rarity, MYSTERY_BOX_POOLS[rarity]])
      .filter(([, pool]) => !!pool);
    const totalWeight = poolEntries.reduce((s, [, p]) => s + p.weight, 0);
    const compensationTable = store.getDuplicateCompensationTable();

    let text = `**General Economy Guide**\n\n`;
    text += `Every player starts with coins in their purse. You can move coins between purse and bank, gamble, trade, and collect items.\n\n`;

    text += `**Money Flow**\n`;
    text += `• Purse = spendable coins for bets, trades, and box purchases\n`;
    text += `• Bank = protected coins that earn interest over time\n`;
    text += `• Interest accrues by minute and is paid to your bank each hour\n\n`;

    text += `**Daily and Passive Income**\n`;
    text += `• **/daily** gives a daily claim with a streak bonus\n`;
    text += `• Wins add ${taxPct}% of win profit to the Universal Pool\n`;
    text += `• Losses add ${lossPct}% of losses to the Daily Spin Pool\n`;
    text += `• Universal Pool pays all registered players hourly (to bank)\n`;
    text += `• Daily Spin Pool is paid to one weighted winner once per day\n\n`;

    text += `**Upgrades**\n`;
    text += `• **Bank Interest**: +1% daily rate per level (Lv0 1% daily up to Lv10 11% daily)\n`;
    text += `• **Loss Cashback**: +0.1% of losses refunded per level (Lv10 = 1.0%)\n`;
    text += `• **Daily Spin Mult**: spin weight = 1 + level (Lv0=1x, Lv10=11x)\n`;
    text += `• **Hourly Universal Income Mult**: level% chance to double hourly universal payout\n`;
    text += `Use **/upgrades** to buy levels.\n\n`;

    text += `**Collectibles and Mystery Boxes**\n`;
    text += `• **/mysterybox** costs **${store.formatNumber(MYSTERY_BOX_COST)}** per box\n`;
    text += `• There are 120 collectibles across 7 rarities\n`;
    for (const [rarity, pool] of poolEntries) {
      const pct = ((pool.weight / totalWeight) * 100).toFixed(1);
      const icon = RARITIES[rarity]?.emoji || '•';
      const label = rarity.charAt(0).toUpperCase() + rarity.slice(1);
      text += `  ${icon} ${label}: ${pct}% (${pool.items.length} items)\n`;
    }
    text += `• Duplicate compensation by rarity:\n`;
    for (const rarity of rarityOrder) {
      const amount = compensationTable[rarity];
      if (!amount) continue;
      const icon = RARITIES[rarity]?.emoji || '•';
      const label = rarity.charAt(0).toUpperCase() + rarity.slice(1);
      text += `  ${icon} ${label}: ${store.formatNumber(amount)}\n`;
    }
    text += `Use **/inventory**, **/collection**, and **/trade** to manage items.`;
    return interaction.reply(text);
  }

  if (topic === 'games') {
    let text = `**Games, Payouts, and EV Guide**\n\n`;
    text += `EV means expected value per round: EV = sum of (outcome probability × net profit).\n\n`;

    text += `**Flip**\n`;
    text += `• Win chance: 50%\n`;
    text += `• Net result: +bet or -bet\n`;
    text += `• EV: 0 per flip before cashback\n\n`;

    text += `**Dice (High/Low)**\n`;
    text += `• Roll 1-6, high is 4-6, low is 1-3\n`;
    text += `• Win chance: 50%\n`;
    text += `• Net result: +bet or -bet\n`;
    text += `• EV: 0 before cashback\n\n`;

    text += `**Roulette**\n`;
    text += `• Red/Black: win chance 18/37, net +bet on win, -bet on loss\n`;
    text += `• EV(red/black): (18/37)*(+1) + (19/37)*(-1) = -1/37 = -2.70% of bet\n`;
    text += `• Green 0: win chance 1/37, net +13x bet on win, -1x bet on loss\n`;
    text += `• EV(green): (1/37)*(+13) + (36/37)*(-1) = -23/37 = -62.16% of bet\n`;
    text += `• **/allin17black** has the same EV as a straight-up roulette number: about -2.70%\n\n`;

    text += `**Blackjack**\n`;
    text += `• Natural blackjack pays +1.5x profit\n`;
    text += `• Standard win pays +1x, push pays 0, loss pays -1x\n`;
    text += `• Double and split multiply both risk and payout\n`;
    text += `• EV is decision-based, so there is no single fixed value without a strategy model\n\n`;

    text += `**Mines**\n`;
    text += `• You choose tiles on a 20-tile board with chosen mine count\n`;
    text += `• Multiplier after r safe reveals uses:\n`;
    text += `  multiplier = product from i=0 to r-1 of (20 - i) / (safeTiles - i)\n`;
    text += `• Cashout payout = floor(bet × multiplier)\n`;
    text += `• Without floor rounding, EV is near break-even at any fixed cashout depth\n\n`;

    text += `**Let It Ride**\n`;
    text += `• Each ride step is a 50/50 double-or-bust decision\n`;
    text += `• Cashing after any fixed number of successful doubles has EV near 0 before cashback\n\n`;

    text += `**Duel**\n`;
    text += `• Two players stake equal amounts, random winner takes both\n`;
    text += `• EV per player is 0 (ignoring external effects like pools and future income)\n\n`;

    text += `**Important notes**\n`;
    text += `• Cashback applies on many losses and improves your long-run EV slightly\n`;
    text += `• Win/loss pool taxes are tracked separately for system redistribution`;
    return interaction.reply(text);
  }

  if (topic === 'commands') {
    let text = `**Command Reference (New Player Friendly)**\n\n`;
    text += `Amount input supports values like **100**, **4.7k**, **1.2m**, **2b**, and **all**.\n\n`;

    text += `**Core Money Commands**\n`;
    text += `• **/balance**: show purse, bank, and total\n`;
    text += `• **/daily**: claim daily reward\n`;
    text += `• **/deposit amount:<amount>**: move purse to bank\n`;
    text += `• **/invest amount:<amount>**: alias of /deposit\n`;
    text += `• **/withdraw amount:<amount>**: move bank to purse\n`;
    text += `• **/bank**: show bank amount, rate, and next payout\n`;
    text += `• **/upgrades**: buy and view upgrades\n`;
    text += `• **/pool**: view universal and daily spin pools\n\n`;

    text += `**Game Commands**\n`;
    text += `• **/flip amount:<amount> quantity:<1-10 optional>**\n`;
    text += `• **/dice amount:<amount>** (then pick high or low)\n`;
    text += `• **/roulette amount:<amount>** (then pick red, black, or green)\n`;
    text += `• **/allin17black** (all purse coins on 17 black)\n`;
    text += `• **/blackjack amount:<amount>** (buttons for hit, stand, double, split)\n`;
    text += `• **/mines amount:<amount> mines:<1-15>**\n`;
    text += `• **/letitride amount:<amount>**\n`;
    text += `• **/duel opponent:<user> amount:<amount>**\n\n`;

    text += `**Player Economy and Social**\n`;
    text += `• **/give user:<user> amount:<amount>**: send coins to another player\n`;
    text += `• **/trade user:<user>**: start item/coin trade flow\n`;
    text += `• **/leaderboard**: richest players\n`;
    text += `• **/stats user:<user optional> username:<text optional>**\n`;
    text += `• **/giveaway message:<text optional>**: start giveaway modal\n\n`;

    text += `**Collectibles**\n`;
    text += `• **/mysterybox quantity:<1-50 optional>**\n`;
    text += `• **/inventory page:<1+ optional>**\n`;
    text += `• **/collection**\n\n`;

    text += `**Help**\n`;
    text += `• **/help general** economy, pools, upgrades, collectibles\n`;
    text += `• **/help games** payouts, EV, and formulas\n`;
    text += `• **/help commands** full command list and inputs`;
    return interaction.reply(text);
  }

  return interaction.reply(`Unknown help topic. Try **/help general**, **/help games**, or **/help commands**.`);
}

module.exports = { handleHelp };
