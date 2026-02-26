const { CONFIG } = require('../config');
const store = require('../data/store');
const { maybeAnnouncePityTrigger } = require('./shared');

// Coin flip - instant 50/50 game.
async function handleFlip(interaction) {
  const userId = interaction.user.id;
  const rawAmount = interaction.options.getString('amount');
  const balance = store.getBalance(userId);
  if (balance <= 0) {
    return interaction.reply({ embeds: [{ color: 0xed4245, description: `You don't have any coins. Balance: **${store.formatNumber(balance)}**` }] });
  }

  const bet = store.parseAmount(rawAmount, balance);
  if (!bet || bet <= 0) {
    return interaction.reply({ embeds: [{ color: 0xed4245, description: CONFIG.commands.invalidAmountText }] });
  }

  const qty = interaction.options.getInteger('quantity') || 1;
  const bal = store.getBalance(userId);
  if (bet * qty > bal) {
    return interaction.reply({ embeds: [{ color: 0xed4245, description: `Not enough coins. You only have **${store.formatNumber(bal)}**` }] });
  }

  // special flag for all-in bets
  const allIn = bet * qty === bal;

  if (qty === 1) {
    const flipModifier = store.getWinChanceModifier(userId);
    const won = Math.random() < CONFIG.games.flip.winChance * flipModifier;
    if (won) {
      const { profit, effects } = store.applyProfitBoost(userId, 'flip', bet);
      const pityResult = store.recordWin(userId, 'flip', profit);
      await maybeAnnouncePityTrigger(interaction, userId, pityResult);
      const tax = store.addToUniversalPool(profit, userId);
      store.setBalance(userId, bal + profit - tax);
      const taxLine = tax > 0 ? `\n${store.formatNumber(tax)} tax to pool` : '';
      const allInLine = allIn ? '\n‼️ **ALL IN!**' : '';
      const effectLines = effects.length ? `\n${effects.join('\n')}` : '';
      return interaction.reply({ embeds: [{
        color: 0x57f287,
        title: '🪙 Coin Flip',
        description: `**WIN** +**${store.formatNumber(profit - tax)}**${taxLine}${allInLine}${effectLines}\nBalance: **${store.formatNumber(store.getBalance(userId))}**`,
      }] });
    }
    store.setBalance(userId, bal - bet);
    const pityResult = store.recordLoss(userId, 'flip', bet);
    await maybeAnnouncePityTrigger(interaction, userId, pityResult);
    const cb = store.applyCashback(userId, bet);
    store.addToLossPool(bet);
    const cbm = cb > 0 ? ` (+${store.formatNumber(cb)} back)` : '';
    const allInLine = allIn ? '\n‼️ **ALL IN!**' : '';
    return interaction.reply({ embeds: [{
      color: 0xed4245,
      title: '🪙 Coin Flip',
      description: `**LOSE** -**${store.formatNumber(bet)}**${cbm}${allInLine}\nBalance: **${store.formatNumber(store.getBalance(userId))}**`,
    }] });
  }

  // Multi-flip: process each flip individually so mid-batch luck buffs apply.
  let wins = 0, results = [];
  let totalBoostedWinnings = 0;
  let totalLossAmount = 0;
  let lastTriggeredPity = null;
  let multiEffects = [];

  for (let i = 0; i < qty; i++) {
    const flipModifier = store.getWinChanceModifier(userId);
    const won = Math.random() < CONFIG.games.flip.winChance * flipModifier;
    results.push(won ? CONFIG.games.flip.winMarker : CONFIG.games.flip.lossMarker);
    if (won) {
      wins++;
      const { profit, effects } = store.applyProfitBoost(userId, 'flip', bet);
      totalBoostedWinnings += profit;
      if (effects && effects.length) {
        multiEffects.push(...effects);
      }
      store.recordWin(userId, 'flip', profit);
    } else {
      totalLossAmount += bet;
      const pityResult = store.recordLoss(userId, 'flip', bet);
      if (pityResult && pityResult.triggered) lastTriggeredPity = pityResult;
    }
  }

  const boostedNet = totalBoostedWinnings - totalLossAmount;
  let totalTax = 0;

  if (totalBoostedWinnings > 0) {
    totalTax = store.addToUniversalPool(totalBoostedWinnings, userId);
  }
  store.setBalance(userId, bal + boostedNet - totalTax);

  let cbm = '';
  if (totalLossAmount > 0) {
    const cb = store.applyCashback(userId, totalLossAmount);
    store.addToLossPool(totalLossAmount);
    if (cb > 0) cbm = ` (+${store.formatNumber(cb)} back)`;
  }

  const displayNet = boostedNet - totalTax;
  const allInLine = allIn ? '\n‼️ **ALL IN!**' : '';

  if (lastTriggeredPity) {
    await maybeAnnouncePityTrigger(interaction, userId, lastTriggeredPity);
  }

  const taxLine = totalTax > 0 ? ` (${store.formatNumber(totalTax)} tax to pool)` : '';
  const color = wins > qty - wins ? 0x57f287 : wins < qty - wins ? 0xed4245 : 0x5865f2;
  const effectsLine = multiEffects.length ? `\n${multiEffects.join('\n')}` : '';

  return interaction.reply({ embeds: [{
    color,
    title: `🪙 Coin Flip x${qty}`,
    description: `${results.join(' ')}\n**${wins}**W **${qty - wins}**L | Net: **${displayNet >= 0 ? '+' : ''}${store.formatNumber(displayNet)}**${taxLine}${cbm}${allInLine}${effectsLine}\nBalance: **${store.formatNumber(store.getBalance(userId))}**`,
  }] });
}

module.exports = { handleFlip };
