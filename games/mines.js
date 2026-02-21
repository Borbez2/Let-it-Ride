const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { CONFIG } = require('../config');
const store = require('../data/store');

const MINES_ROWS = CONFIG.games.mines.rows;
const MINES_COLS = CONFIG.games.mines.cols;
const MINES_TOTAL = CONFIG.games.mines.total;

const activeMines = new Map();

async function maybeAnnouncePityTrigger(interaction, userId, pityResult) {
  if (!pityResult || !pityResult.triggered) return;
  const channel = interaction.channel;
  if (!channel || typeof channel.send !== 'function') return;

  const boostPct = (pityResult.winChanceBoost * 100).toFixed(1);

  await channel.send(
    `\u2618 <@${userId}> luck triggered: +${boostPct}% win chance boost | loss streak: ${pityResult.lossStreak}`
  ).catch(() => null);
}

function persistMinesSessions() {
  store.setRuntimeState('session:mines', {
    activeMines: Object.fromEntries(activeMines),
  });
}

function restoreMinesSessions() {
  const state = store.getRuntimeState('session:mines', null);
  if (!state || typeof state !== 'object') return;
  if (state.activeMines && typeof state.activeMines === 'object') {
    for (const [uid, game] of Object.entries(state.activeMines)) {
      activeMines.set(uid, game);
    }
  }
}

restoreMinesSessions();

function createMinesGrid(mc) {
  const g = Array(MINES_TOTAL).fill(false);
  let p = 0;
  while (p < mc) {
    const i = Math.floor(Math.random() * MINES_TOTAL);
    if (!g[i]) { g[i] = true; p++; }
  }
  return g;
}

function getMinesMultiplier(revealed, mc) {
  if (revealed === 0) return 1;
  const safe = MINES_TOTAL - mc;
  let m = 1;
  for (let i = 0; i < revealed; i++) m *= (MINES_TOTAL - i) / (safe - i);
  return Math.max(1, m);
}

function renderMinesGrid(game) {
  const rows = [];
  for (let r = 0; r < MINES_ROWS; r++) {
    const row = new ActionRowBuilder();
    for (let c = 0; c < MINES_COLS; c++) {
      const idx = r * MINES_COLS + c;
      const btn = new ButtonBuilder()
        .setCustomId(`mines_${idx}_${game.oddsUserId}`)
        .setStyle(game.revealed[idx] ? ButtonStyle.Success : ButtonStyle.Secondary);
      if (game.revealed[idx]) btn.setLabel(CONFIG.games.mines.symbols.revealedSafe).setDisabled(true);
      else btn.setLabel(CONFIG.games.mines.symbols.hidden);
      row.addComponents(btn);
    }
    rows.push(row);
  }
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`mines_cashout_${game.oddsUserId}`)
      .setLabel(`Cash Out (+${store.formatNumber(Math.floor(game.bet * game.multiplier) - game.bet)})`)
      .setStyle(ButtonStyle.Primary)
      .setDisabled(game.revealedCount === 0)
  ));
  return rows;
}

function gridToString(game, hitIdx) {
  let gr = '';
  for (let r = 0; r < MINES_ROWS; r++) {
    for (let c = 0; c < MINES_COLS; c++) {
      const i = r * MINES_COLS + c;
      if (hitIdx !== undefined && i === hitIdx) gr += `${CONFIG.games.mines.symbols.explodedMine} `;
      else if (game.grid[i]) gr += `${CONFIG.games.mines.symbols.mine} `;
      else if (game.revealed[i]) gr += `${CONFIG.games.mines.symbols.revealedSafe} `;
      else gr += `${CONFIG.games.mines.symbols.hidden} `;
    }
    gr += '\n';
  }
  return gr;
}

async function handleCommand(interaction) {
  const userId = interaction.user.id;
  const rawAmount = interaction.options.getString('amount');
  const balance = store.getBalance(userId);
  if (balance <= 0) return interaction.reply(`Not enough coins. You only have **${store.formatNumber(balance)}**`);
  
  const bet = store.parseAmount(rawAmount, balance);
  if (!bet || bet <= 0) {
    return interaction.reply(CONFIG.commands.invalidAmountText);
  }
  
  const mc = interaction.options.getInteger('mines');
  const bal = store.getBalance(userId);
  if (bet > bal) return interaction.reply(`You only have **${store.formatNumber(bal)}**`);
  if (mc >= MINES_TOTAL) return interaction.reply(`Max ${MINES_TOTAL - 1} mines`);

  store.setBalance(userId, bal - bet);
  const g = {
    bet, mineCount: mc, grid: createMinesGrid(mc),
    revealed: Array(MINES_TOTAL).fill(false), revealedCount: 0,
    multiplier: 1, oddsUserId: userId, createdAt: Date.now(),
  };
  activeMines.set(userId, g);
  persistMinesSessions();
  return interaction.reply({
    content: `**Mines** (${mc} mines, ${MINES_TOTAL - mc} safe)\nRevealed: 0 | 1.00x`,
    components: renderMinesGrid(g),
  });
}

async function handleButton(interaction, parts) {
  const uid = parts[parts.length - 1];
  if (interaction.user.id !== uid) return interaction.reply({ content: "Not your game!", ephemeral: true });
  const game = activeMines.get(uid);
  if (!game) return interaction.reply({ content: "Expired!", ephemeral: true });

  // Cashout
  if (parts[1] === 'cashout') {
    const baseWin = Math.floor(game.bet * game.multiplier);
    let finalWin = baseWin;
    if (baseWin > game.bet) {
      const baseProfit = baseWin - game.bet;
      const boostedProfit = store.applyProfitBoost(uid, 'mines', baseProfit);
      finalWin = game.bet + boostedProfit;
      store.recordWin(uid, 'mines', boostedProfit);
      store.addToUniversalPool(boostedProfit);
    }
    store.setBalance(uid, store.getBalance(uid) + finalWin);
    activeMines.delete(uid);
    persistMinesSessions();
    const gr = gridToString(game);
    return interaction.update({
      content: `**Mines - Cashed Out**\n\`\`\`\n${gr}\`\`\`\n${game.revealedCount} tiles at ${game.multiplier.toFixed(2)}x\nWon **+${store.formatNumber(finalWin - game.bet)}**\nBalance: **${store.formatNumber(store.getBalance(uid))}**`,
      components: [],
    });
  }

  // Reveal tile
  const ti = parseInt(parts[1]);
  if (game.revealed[ti]) return interaction.reply({ content: "Already revealed!", ephemeral: true });

  // Hit a mine
  if (game.grid[ti]) {
    const savedByCharm = store.tryTriggerMinesReveal(uid);
    if (savedByCharm) {
      game.revealed[ti] = true;
      game.revealedCount++;
      game.multiplier = getMinesMultiplier(game.revealedCount, game.mineCount);
      persistMinesSessions();

      if (game.revealedCount >= MINES_TOTAL - game.mineCount) {
        const baseWin = Math.floor(game.bet * game.multiplier);
        let finalWin = baseWin;
        if (baseWin > game.bet) {
          const baseProfit = baseWin - game.bet;
          const boostedProfit = store.applyProfitBoost(uid, 'mines', baseProfit);
          finalWin = game.bet + boostedProfit;
          const pityResult = store.recordWin(uid, 'mines', boostedProfit);
          await maybeAnnouncePityTrigger(interaction, uid, pityResult);
          store.addToUniversalPool(boostedProfit);
        }
        store.setBalance(uid, store.getBalance(uid) + finalWin);
        activeMines.delete(uid);
        persistMinesSessions();
        let gr = '';
        for (let r = 0; r < MINES_ROWS; r++) {
          for (let c = 0; c < MINES_COLS; c++) {
            const i = r * MINES_COLS + c;
            gr += game.grid[i] ? `${CONFIG.games.mines.symbols.mine} ` : `${CONFIG.games.mines.symbols.revealedSafe} `;
          }
          gr += '\n';
        }
        return interaction.update({
          content: `✨ **Mines Charm Proc** saved you from a mine\n\`\`\`\n${gr}\`\`\`\nPerfect clear payout: **+${store.formatNumber(finalWin - game.bet)}**\nBalance: **${store.formatNumber(store.getBalance(uid))}**`,
          components: [],
        });
      }

      return interaction.update({
        content: `✨ **Mines Charm Proc** saved you from a mine\nRevealed: ${game.revealedCount} | ${game.multiplier.toFixed(2)}x\nPotential: **+${store.formatNumber(Math.floor(game.bet * game.multiplier) - game.bet)}**`,
        components: renderMinesGrid(game),
      });
    }

    const potentialCashout = Math.floor(game.bet * game.multiplier);
    const pityResult = store.recordLoss(uid, 'mines', game.bet);
    await maybeAnnouncePityTrigger(interaction, uid, pityResult);
    const cb = store.applyCashback(uid, game.bet);
    store.addToLossPool(game.bet);
    activeMines.delete(uid);
    persistMinesSessions();
    const gr = gridToString(game, ti);
    const cbm = cb > 0 ? `\n+${store.formatNumber(cb)} cashback` : '';
    let lossText = `Lost **${store.formatNumber(game.bet)}** (initial bet)`;
    if (game.revealedCount > 0) {
      lossText += `\nMissed cashout: **+${store.formatNumber(potentialCashout - game.bet)}** (${game.multiplier.toFixed(2)}x)`;
    }
    return interaction.update({
      content: `**Mines - BOOM**\n\`\`\`\n${gr}\`\`\`\n${lossText}${cbm}\nBalance: **${store.formatNumber(store.getBalance(uid))}**`,
      components: [],
    });
  }

  // Safe tile
  game.revealed[ti] = true;
  game.revealedCount++;
  game.multiplier = getMinesMultiplier(game.revealedCount, game.mineCount);
  persistMinesSessions();

  // Perfect clear
  if (game.revealedCount >= MINES_TOTAL - game.mineCount) {
    const baseWin = Math.floor(game.bet * game.multiplier);
    let finalWin = baseWin;
    if (baseWin > game.bet) {
      const baseProfit = baseWin - game.bet;
      const boostedProfit = store.applyProfitBoost(uid, 'mines', baseProfit);
      finalWin = game.bet + boostedProfit;
      const pityResult = store.recordWin(uid, 'mines', boostedProfit);
      await maybeAnnouncePityTrigger(interaction, uid, pityResult);
      store.addToUniversalPool(boostedProfit);
    }
    store.setBalance(uid, store.getBalance(uid) + finalWin);
    activeMines.delete(uid);
    persistMinesSessions();
    let gr = '';
    for (let r = 0; r < MINES_ROWS; r++) {
      for (let c = 0; c < MINES_COLS; c++) {
        const i = r * MINES_COLS + c;
        gr += game.grid[i] ? `${CONFIG.games.mines.symbols.mine} ` : `${CONFIG.games.mines.symbols.revealedSafe} `;
      }
      gr += '\n';
    }
    return interaction.update({
      content: `**Mines - PERFECT CLEAR**\n\`\`\`\n${gr}\`\`\`\nWon **+${store.formatNumber(finalWin - game.bet)}**\nBalance: **${store.formatNumber(store.getBalance(uid))}**`,
      components: [],
    });
  }

  return interaction.update({
    content: `**Mines** (${game.mineCount} mines)\nRevealed: ${game.revealedCount} | ${game.multiplier.toFixed(2)}x\nPotential: **+${store.formatNumber(Math.floor(game.bet * game.multiplier) - game.bet)}**`,
    components: renderMinesGrid(game),
  });
}

function expireSessions(ttlMs) {
  const now = Date.now();
  let expired = 0;
  for (const [uid, game] of activeMines) {
    if (game.createdAt && now - game.createdAt > ttlMs) {
      store.setBalance(uid, store.getBalance(uid) + game.bet);
      activeMines.delete(uid);
      expired++;
    }
  }
  if (expired > 0) persistMinesSessions();
  return expired;
}

module.exports = { handleCommand, handleButton, activeMines, expireSessions };
