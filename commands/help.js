const { MYSTERY_BOX_COST, MYSTERY_BOX_POOLS, POOL_TAX_RATE, LOSS_POOL_RATE, RARITIES } = require('../config');
const store = require('../data/store');

async function handleHelp(interaction) {
  const topic = interaction.options.getString('topic');

  if (topic === 'collectibles') {
    const poolEntries = Object.entries(MYSTERY_BOX_POOLS);
    const totalWeight = poolEntries.reduce((s, [, p]) => s + p.weight, 0);

    let text = `**Collectibles Guide**\n\n`;
    text += `There are **120 collectibles** to collect, split across 7 rarities. `;
    text += `You get them from mystery boxes which cost **${store.formatNumber(MYSTERY_BOX_COST)}** coins each.\n\n`;

    text += `**Rarities and Drop Rates**\n\n`;
    for (const [rarity, pool] of poolEntries) {
      const pct = ((pool.weight / totalWeight) * 100).toFixed(1);
      const r = RARITIES[rarity];
      text += `${r.emoji} **${rarity.charAt(0).toUpperCase() + rarity.slice(1)}**: ${pct}% chance, ${pool.items.length} items\n`;
    }

    text += `\n**Duplicate Compensation**\n`;
    text += `If you roll a duplicate, refund is based on item rarity:\n`;
    const compTable = store.getDuplicateCompensationTable();
    for (const [rarity] of poolEntries) {
      const r = RARITIES[rarity];
      const compensation = compTable[rarity] || 0;
      text += `${r.emoji} **${rarity.charAt(0).toUpperCase() + rarity.slice(1)}**: ${store.formatNumber(compensation)} coins\n`;
    }

    text += `\nWhen you open a mystery box, it first rolls which rarity tier you land on using the percentages above. `;
    text += `Then it picks a random item from that tier. You can get duplicates, so completing the full set of 120 takes dedication.\n\n`;
    text += `Use **/inventory** to see what you own and **/collection** to see who has the most unique collectibles.\n\n`;
    text += `You can also trade collectibles with other players using **/trade**.`;
    return interaction.reply(text);
  }

  if (topic === 'universalincome') {
    const taxPct = (POOL_TAX_RATE * 100).toFixed(0);
    const lossPct = (LOSS_POOL_RATE * 100).toFixed(0);

    let text = `**Universal Income & Pools Guide**\n\n`;
    text += `The economy has two pools that redistribute wealth to keep things interesting.\n\n`;

    text += `**Universal Pool (Win Tax)**\n`;
    text += `Every time someone wins a bet, ${taxPct}% of their profit goes into the Universal Pool. `;
    text += `This pool is split equally among ALL registered players every hour. `;
    text += `So even if you're not gambling, you still earn a share of everyone else's winnings. `;
    text += `The more players there are, the smaller each share, but the pool also fills up faster.\n\n`;

    text += `**Daily Spin Pool (Loss Tax)**\n`;
    text += `Every time someone loses a bet, ${lossPct}% of their loss goes into the Daily Spin Pool. `;
    text += `Once per day at 11:15pm, the entire pool is given to one lucky winner chosen by a weighted random spin. `;
    text += `Your odds of winning the spin depend on your Spin Mult upgrade level. `;
    text += `At base you have 1x weight, and each upgrade level adds another 1x (so level 5 gives you 6x the base chance).\n\n`;

    text += `**How it all connects**\n`;
    text += `Wins feed the universal pool which pays everyone hourly. `;
    text += `Losses feed the spin pool which pays one lucky player daily. `;
    text += `This means the economy recycles coins back into circulation instead of them disappearing. `;
    text += `Use **/pool** to see current pool totals and when the next payouts happen.`;
    return interaction.reply(text);
  }

  // Default help overview
  let text = `**Help Topics**\n\n`;
  text += `Use **/help collectibles** to learn about the collectible system, mystery boxes, and rarity drop rates.\n\n`;
  text += `Use **/help universalincome** to learn how the universal pool and daily spin redistribute coins.`;
  return interaction.reply(text);
}

module.exports = { handleHelp };
