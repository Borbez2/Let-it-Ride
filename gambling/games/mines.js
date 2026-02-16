const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { MINES_ROWS, MINES_COLS, MINES_TOTAL } = require('../config');
const store = require('../data/store');

const activeMines = new Map();

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
      if (game.revealed[idx]) btn.setLabel('O').setDisabled(true);
      else btn.setLabel('·');
      row.addComponents(btn);
    }
    rows.push(row);
  }
  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`mines_cashout_${game.oddsUserId}`)
      .setLabel(`Cash Out (${store.formatNumber(Math.floor(game.bet * game.multiplier))})`)
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
      if (hitIdx !== undefined && i === hitIdx) gr += '! ';
      else if (game.grid[i]) gr += 'X ';
      else if (game.revealed[i]) gr += 'O ';
      else gr += '· ';
    }
    gr += '\n';
  }
  return gr;
}

async function handleCommand(interaction) {
  const userId = interaction.user.id;
  const rawAmount = interaction.options.getString('amount');
  const balance = store.getBalance(userId);
  
  const bet = store.parseAmount(rawAmount, balance);
  if (!bet || bet <= 0) {
    return interaction.reply('Invalid amount. Use a number, "1k", "1m", or "all"');
  }
  
  const mc = interaction.options.getInteger('mines');
  const bal = store.getBalance(userId);
  if (bet > bal) return interaction.reply(`You only have **${store.formatNumber(bal)}**`);
  if (mc >= MINES_TOTAL) return interaction.reply(`Max ${MINES_TOTAL - 1} mines`);

  store.setBalance(userId, bal - bet);
  const g = {
    bet, mineCount: mc, grid: createMinesGrid(mc),
    revealed: Array(MINES_TOTAL).fill(false), revealedCount: 0,
    multiplier: 1, oddsUserId: userId,
  };
  activeMines.set(userId, g);
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
    const win = Math.floor(game.bet * game.multiplier);
    store.setBalance(uid, store.getBalance(uid) + win);
    if (win > game.bet) store.addToUniversalPool(win - game.bet);
    activeMines.delete(uid);
    const gr = gridToString(game);
    return interaction.update({
      content: `**Mines - Cashed Out**\n\`\`\`\n${gr}\`\`\`\n${game.revealedCount} tiles at ${game.multiplier.toFixed(2)}x\nWon **${store.formatNumber(win)}**\nBalance: **${store.formatNumber(store.getBalance(uid))}**`,
      components: [],
    });
  }

  // Reveal tile
  const ti = parseInt(parts[1]);
  if (game.revealed[ti]) return interaction.reply({ content: "Already revealed!", ephemeral: true });

  // Hit a mine
  if (game.grid[ti]) {
    const cb = store.applyCashback(uid, game.bet);
    store.addToLossPool(game.bet);
    activeMines.delete(uid);
    const gr = gridToString(game, ti);
    const cbm = cb > 0 ? `\n+${store.formatNumber(cb)} cashback` : '';
    return interaction.update({
      content: `**Mines - BOOM**\n\`\`\`\n${gr}\`\`\`\nLost **${store.formatNumber(game.bet)}**${cbm}\nBalance: **${store.formatNumber(store.getBalance(uid))}**`,
      components: [],
    });
  }

  // Safe tile
  game.revealed[ti] = true;
  game.revealedCount++;
  game.multiplier = getMinesMultiplier(game.revealedCount, game.mineCount);

  // Perfect clear
  if (game.revealedCount >= MINES_TOTAL - game.mineCount) {
    const win = Math.floor(game.bet * game.multiplier);
    store.setBalance(uid, store.getBalance(uid) + win);
    if (win > game.bet) store.addToUniversalPool(win - game.bet);
    activeMines.delete(uid);
    let gr = '';
    for (let r = 0; r < MINES_ROWS; r++) {
      for (let c = 0; c < MINES_COLS; c++) {
        const i = r * MINES_COLS + c;
        gr += game.grid[i] ? 'X ' : 'O ';
      }
      gr += '\n';
    }
    return interaction.update({
      content: `**Mines - PERFECT CLEAR**\n\`\`\`\n${gr}\`\`\`\nWon **${store.formatNumber(win)}**\nBalance: **${store.formatNumber(store.getBalance(uid))}**`,
      components: [],
    });
  }

  return interaction.update({
    content: `**Mines** (${game.mineCount} mines)\nRevealed: ${game.revealedCount} | ${game.multiplier.toFixed(2)}x\nPotential: **${store.formatNumber(Math.floor(game.bet * game.multiplier))}**`,
    components: renderMinesGrid(game),
  });
}

module.exports = { handleCommand, handleButton, activeMines };
