const { CONFIG, MYSTERY_BOX_POOLS, RARITIES } = require('../config');
const store = require('../data/store');

async function replyHelp(interaction, text) {
  const maxLen = 1900;
  if (text.length <= 2000) return interaction.reply(text);

  const lines = text.split('\n');
  const chunks = [];
  let current = '';

  for (const line of lines) {
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length > maxLen) {
      if (current) chunks.push(current);
      if (line.length > maxLen) {
        let remaining = line;
        while (remaining.length > maxLen) {
          chunks.push(remaining.slice(0, maxLen));
          remaining = remaining.slice(maxLen);
        }
        current = remaining;
      } else {
        current = line;
      }
    } else {
      current = candidate;
    }
  }

  if (current) chunks.push(current);
  if (!chunks.length) return interaction.reply('No help content available.');

  await interaction.reply(chunks[0]);
  for (let i = 1; i < chunks.length; i++) {
    await interaction.followUp(chunks[i]);
  }
}

async function handleHelp(interaction) {
  const topic = interaction.options.getString('topic') || 'general';

  if (topic === 'general') {
    const taxPct = (CONFIG.economy.pools.universalTaxRate * 100).toFixed(0);
    const lossPct = (CONFIG.economy.pools.lossTaxRate * 100).toFixed(0);

    let text = `**General Economy**\n\n`;
    text += `**Money**\n`;
    text += `• Purse: spendable coins for bets, trades, and boxes\n`;
    text += `• Bank: protected coins with hourly-paid interest\n\n`;

    text += `**Income + Pools**\n`;
    text += `• **/daily** gives daily coins + streak bonus\n`;
    text += `• Win tax: ${taxPct}% of profit -> Universal Pool\n`;
    text += `• Loss tax: ${lossPct}% of losses -> Daily Spin Pool\n`;
    text += `• Universal Pool pays all players hourly to bank\n`;
    text += `• Daily Spin Pool pays one weighted winner daily\n\n`;

    text += `**Upgrades**\n`;
    text += `• Interest: +1% daily per level (Lv0 1% -> Lv10 11%)\n`;
    text += `• Cashback: +0.1% loss refund per level (Lv10 = 1.0%)\n`;
    text += `• Spin Mult: weight = 1 + level\n`;
    text += `• Universal Mult: level% chance to double hourly universal payout\n`;
    text += `• Manage in **/upgrades**\n\n`;

    text += `**Collectibles + Boxes**\n`;
    text += `• Boxes use purse coins only\n`;
    text += `• Collectibles can add passive bonuses\n`;
    text += `• For rarity/drop/duplicate tables: **/help mysteryboxes**\n`;
    text += `• Manage items with **/inventory**, **/collection**, **/trade**\n`;
    return replyHelp(interaction, text);
  }

  if (topic === 'universalincome') {
    const taxPct = (CONFIG.economy.pools.universalTaxRate * 100).toFixed(0);
    let text = `**Universal Income**\n\n`;
    text += `• Source: ${taxPct}% of win profit goes to Universal Pool\n`;
    text += `• Payout: every hour, shared across all registered players\n`;
    text += `• Destination: paid to **bank** (not purse)\n`;
    text += `• Upgrade: Universal Mult gives level% chance to double your hourly payout\n`;
    text += `• Check pool and estimate via **/pool**\n`;
    return replyHelp(interaction, text);
  }

  if (topic === 'collectibles') {
    let text = `**Collectibles**\n\n`;
    text += `• Earned mainly from **/mysterybox**\n`;
    text += `• Stored in your inventory and can provide passive bonuses\n`;
    text += `• Typical effect types: interest, cashback, luck, mines-save, EV boosts\n`;
    text += `• View active bonuses in **/stats** -> **Bonuses**\n`;
    text += `• Manage with **/inventory**, **/collection**, **/trade**\n`;
    text += `• Box rarity/drop/duplicate details: **/help mysteryboxes**\n`;
    return replyHelp(interaction, text);
  }

  if (topic === 'games') {
    let text = `**Games + EV (Quick)**\n\n`;
    text += `EV = expected value per round.\n\n`;
    text += `• **Flip**: 50/50, EV ~0 before cashback\n`;

    text += `• **Roulette red/black**: EV = -1/37 = **-2.70%**\n`;
    text += `• **Roulette green 0**: EV = -23/37 = **-62.16%**\n`;
    text += `• **/allin17black**: same straight-up EV style (~-2.70%)\n`;
    text += `• **Blackjack**: strategy dependent, no single fixed EV\n`;
    text += `• **Mines**: multiplier = product((20-i)/(safeTiles-i)); cashout = floor(bet × mult)\n`;
    text += `• **LetItRide**: repeated 50/50 double-or-bust steps\n`;
    text += `• **Duel**: equal stakes, random winner, EV ~0/player\n\n`;
    text += `Cashback and item EV boosts can improve net outcomes.`;
    return replyHelp(interaction, text);
  }

  if (topic === 'modifiers' || topic === 'luck' || topic === 'pity') {
    const cfg = store.getRuntimeTuning ? store.getRuntimeTuning() : null;
    const pityBoostPct = cfg ? (cfg.binomialPityBoostRate * 100).toFixed(2) : '1.00';
    const pityDuration = cfg ? cfg.binomialPityDurationMinutes : 30;
    const pityCooldown = cfg ? cfg.binomialPityCooldownMinutes : 15;

    let text = `**Modifiers + Luck + Pity**\n\n`;
    text += `Base game math runs first, then modifiers are applied.\n\n`;
    text += `**Sources**\n`;
    text += `• Upgrades: interest, cashback, spin weight, universal double chance\n`;
    text += `• Items: passive boosts (interest/cashback/luck/mines-save/EV by game)\n`;
    text += `• Pity systems: mystery-box pity + game-results pity\n`;
    text += `• Mystery-box pity full details: **/help mysteryboxes**\n\n`;
    text += `**Quick Summary**\n`;
    text += `• Modifiers affect payout math, not win chance\n`;
    text += `• Pity tiers: 60/70/80/90%, then every +1% from 91% to 99%\n`;
    text += `• Each pity trigger adds +${pityBoostPct}% EV for ${pityDuration}m and stacks\n`;
    text += `• Track live status with **/pity** and **/stats**\n\n`;
    text += `**Pity (Game Results)**\n`;
    text += `• No minimum game requirement\n`;
    text += `• Unlucky threshold stacks: **60% / 70% / 80% / 90%** probability of being this unlucky, each adds **+${pityBoostPct}%** EV boost\n`;
    text += `• After 90, every **+1%** probability step (**91%..99%**) also adds **+${pityBoostPct}%**\n`;
    text += `• Max pity boost cap: **+10.00%** total\n`;
    text += `• Runtime pity cooldown setting is currently not used by threshold-cross stacks\n`;
    text += `• Every trigger lasts **${pityDuration}m** and stacks with other active triggers\n`;
    text += `• Boost affects win profit only (does not force wins)\n\n`;
    text += `Check live values in **/stats** -> **Bonuses** and **/pity**.`;
    return replyHelp(interaction, text);
  }

  if (topic === 'mysterybox' || topic === 'mysteryboxes' || topic === 'boxes') {
    const rarityOrder = CONFIG.ui.rarityOrder;
    const poolEntries = rarityOrder
      .map((rarity) => [rarity, MYSTERY_BOX_POOLS[rarity]])
      .filter(([, pool]) => !!pool);
    const totalWeight = poolEntries.reduce((s, [, p]) => s + p.weight, 0);
    const compensationTable = store.getDuplicateCompensationTable();

    let text = `**Mystery Boxes**\n\n`;
    text += `• **/mysterybox quantity:<1-50 optional>** uses **purse only**\n`;
    text += `• Cost: **${store.formatNumber(CONFIG.collectibles.mysteryBox.cost)}** per box\n`;
    text += `• 120 collectibles across 7 rarities\n`;
    text += `• Luck = item luck + pity luck\n\n`;

    text += `**Base Drop Weights**\n`;
    for (const [rarity, pool] of poolEntries) {
      const pct = ((pool.weight / totalWeight) * 100).toFixed(1);
      const icon = RARITIES[rarity]?.emoji || '•';
      const label = rarity.charAt(0).toUpperCase() + rarity.slice(1);
      text += `  ${icon} ${label}: ${pct}% (${pool.items.length} items)\n`;
    }

    text += `\n**Duplicate Compensation**\n`;
    for (const rarity of rarityOrder) {
      const amount = compensationTable[rarity];
      if (!amount) continue;
      const icon = RARITIES[rarity]?.emoji || '•';
      const label = rarity.charAt(0).toUpperCase() + rarity.slice(1);
      text += `  ${icon} ${label}: ${store.formatNumber(amount)}\n`;
    }

    text += `\n**Future Item Modifier Placeholder**\n`;
    text += `• Format: Item — interest +X%/day | cashback +Y% | luck +Z% | mines-save +A% | EV(game)+B%\n`;
    text += `• Many placeholders are currently 0 until assigned\n\n`;

    text += `Use **/inventory**, **/collection**, and **/trade** to manage collectibles.`;
    return replyHelp(interaction, text);
  }

  if (topic === 'commands') {
    let text = `**Command Reference**\n\n`;
    text += `Amount format: **100**, **4.7k**, **1.2m**, **2b**, **all**\n\n`;
    text += `**Money**\n`;
    text += `• /balance /daily /bank /pool\n`;
    text += `• /deposit /invest /withdraw\n`;
    text += `• /upgrades\n\n`;
    text += `**Games**\n`;
    text += `• /flip /roulette /allin17black\n`;
    text += `• /blackjack /mines /letitride /duel\n\n`;
    text += `**Economy + Social**\n`;
    text += `• /give /trade /leaderboard /stats /pity /giveaway\n\n`;
    text += `**Collectibles**\n`;
    text += `• /mysterybox /inventory /collection\n\n`;
    text += `**Help Topics**\n`;
    text += `• /help general | universalincome | collectibles | games | modifiers | mysteryboxes | commands`;
    return replyHelp(interaction, text);
  }

  const options = CONFIG.help.topics.map((entry) => `**/help ${entry.value}**`).join(', ');
  return interaction.reply(`Unknown help topic. Try ${options}.`);
}

module.exports = { handleHelp };
