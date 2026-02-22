const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { CONFIG } = require('../config');
const store = require('../data/store');

const MINES_ROWS = CONFIG.games.mines.rows;
const MINES_COLS = CONFIG.games.mines.cols;
const MINES_TOTAL = CONFIG.games.mines.total;

const activeMines = new Map();

/* ── Pity announcement ──────────────────────────────────── */

async function maybeAnnouncePityTrigger(interaction, userId, pityResult) {
  if (!pityResult || !pityResult.triggered) return;
  const channel = interaction.channel;
  if (!channel || typeof channel.send !== 'function') return;

  const boostPct = (pityResult.winChanceBoost * 100).toFixed(1);
  await channel.send({
    embeds: [{
      description: `☘ <@${userId}> luck triggered: **+${boostPct}%** win chance boost | loss streak: ${pityResult.lossStreak}`,
      color: 0x57f287,
    }],
  }).catch(() => null);
}

/* ── Session persistence ────────────────────────────────── */

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

/* ── Grid helpers ───────────────────────────────────────── */

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

function buildFullGrid(game) {
  let gr = '';
  for (let r = 0; r < MINES_ROWS; r++) {
    for (let c = 0; c < MINES_COLS; c++) {
      const i = r * MINES_COLS + c;
      gr += game.grid[i] ? `${CONFIG.games.mines.symbols.mine} ` : `${CONFIG.games.mines.symbols.revealedSafe} `;
    }
    gr += '\n';
  }
  return gr;
}

/* ── Embed builders ─────────────────────────────────────── */

function buildMinesEmbed({ title, grid, color, description, fields = [] }) {
  const embed = {
    title: `💣 ${title}`,
    description: grid ? `\`\`\`\n${grid}\`\`\`\n${description || ''}` : (description || ''),
    color,
    fields,
  };
  return embed;
}

/* ── Slash command handler ──────────────────────────────── */

async function handleCommand(interaction) {
  const userId = interaction.user.id;
  const rawAmount = interaction.options.getString('amount');
  const balance = store.getBalance(userId);
  if (balance <= 0) {
    return interaction.reply({
      embeds: [{ description: `You don't have enough coins. Balance: **${store.formatNumber(balance)}**`, color: 0xed4245 }],
      ephemeral: true,
    });
  }

  const bet = store.parseAmount(rawAmount, balance);
  if (!bet || bet <= 0) {
    return interaction.reply({ content: CONFIG.commands.invalidAmountText, ephemeral: true });
  }

  const mc = interaction.options.getInteger('mines');
  const bal = store.getBalance(userId);
  if (bet > bal) {
    return interaction.reply({
      embeds: [{ description: `You only have **${store.formatNumber(bal)}**`, color: 0xed4245 }],
      ephemeral: true,
    });
  }
  if (mc >= MINES_TOTAL) return interaction.reply({ content: `Max ${MINES_TOTAL - 1} mines`, ephemeral: true });

  store.setBalance(userId, bal - bet);
  const g = {
    bet, mineCount: mc, grid: createMinesGrid(mc),
    revealed: Array(MINES_TOTAL).fill(false), revealedCount: 0,
    multiplier: 1, oddsUserId: userId, createdAt: Date.now(),
  };
  activeMines.set(userId, g);
  persistMinesSessions();
  return interaction.reply({
    embeds: [{
      title: '💣 Mines',
      description: `${mc} mines, ${MINES_TOTAL - mc} safe tiles\nRevealed: **0** | **1.00x**`,
      color: 0x5865f2,
      footer: { text: `Bet: ${store.formatNumber(bet)}` },
    }],
    components: renderMinesGrid(g),
  });
}

/* ── Button handler ─────────────────────────────────────── */

async function handleButton(interaction, parts) {
  const uid = parts[parts.length - 1];
  if (interaction.user.id !== uid) return interaction.reply({ content: "Not your game!", ephemeral: true });
  const game = activeMines.get(uid);
  if (!game) return interaction.reply({ content: "Expired!", ephemeral: true });

  // ── Cashout ──
  if (parts[1] === 'cashout') {
    const baseWin = Math.floor(game.bet * game.multiplier);
    let finalWin = baseWin;
    let tax = 0;
    if (baseWin > game.bet) {
      const baseProfit = baseWin - game.bet;
      const boostedProfit = store.applyProfitBoost(uid, 'mines', baseProfit);
      tax = store.addToUniversalPool(boostedProfit, uid);
      finalWin = game.bet + boostedProfit - tax;
      store.recordWin(uid, 'mines', boostedProfit);
    }
    store.setBalance(uid, store.getBalance(uid) + finalWin);
    activeMines.delete(uid);
    persistMinesSessions();
    const gr = gridToString(game);
    const detailParts = [
      `${game.revealedCount} tiles at **${game.multiplier.toFixed(2)}x**`,
      `Won **+${store.formatNumber(finalWin - game.bet)}**`,
    ];
    if (tax > 0) detailParts.push(`${store.formatNumber(tax)} tax → pool`);
    detailParts.push(`Balance: **${store.formatNumber(store.getBalance(uid))}**`);
    return interaction.update({
      content: '',
      embeds: [buildMinesEmbed({
        title: 'Mines - Cashed Out',
        grid: gr,
        color: 0x57f287,
        description: detailParts.join('\n'),
      })],
      components: [],
    });
  }

  // ── Reveal tile ──
  const ti = parseInt(parts[1]);
  if (game.revealed[ti]) return interaction.reply({ content: "Already revealed!", ephemeral: true });

  // ── Hit a mine ──
  if (game.grid[ti]) {
    const savedByCharm = store.tryTriggerMinesReveal(uid);
    if (savedByCharm) {
      game.revealed[ti] = true;
      game.revealedCount++;
      game.multiplier = getMinesMultiplier(game.revealedCount, game.mineCount);
      persistMinesSessions();

      // Perfect clear after charm
      if (game.revealedCount >= MINES_TOTAL - game.mineCount) {
        const baseWin = Math.floor(game.bet * game.multiplier);
        let finalWin = baseWin;
        if (baseWin > game.bet) {
          const baseProfit = baseWin - game.bet;
          const boostedProfit = store.applyProfitBoost(uid, 'mines', baseProfit);
          const pityResult = store.recordWin(uid, 'mines', boostedProfit);
          await maybeAnnouncePityTrigger(interaction, uid, pityResult);
          const tax = store.addToUniversalPool(boostedProfit, uid);
          finalWin = game.bet + boostedProfit - tax;
        }
        store.setBalance(uid, store.getBalance(uid) + finalWin);
        activeMines.delete(uid);
        persistMinesSessions();
        return interaction.update({
          content: '',
          embeds: [buildMinesEmbed({
            title: 'Mines - Charm Save + Perfect Clear!',
            grid: buildFullGrid(game),
            color: 0x57f287,
            description: `✨ Mines Charm saved you from a mine!\nPerfect clear payout: **+${store.formatNumber(finalWin - game.bet)}**\nBalance: **${store.formatNumber(store.getBalance(uid))}**`,
          })],
          components: [],
        });
      }

      return interaction.update({
        embeds: [{
          title: '💣 Mines - ✨ Charm Save!',
          description: `Mines Charm saved you from a mine!\nRevealed: **${game.revealedCount}** | **${game.multiplier.toFixed(2)}x**\nPotential: **+${store.formatNumber(Math.floor(game.bet * game.multiplier) - game.bet)}**`,
          color: 0x57f287,
          footer: { text: `Bet: ${store.formatNumber(game.bet)}` },
        }],
        components: renderMinesGrid(game),
      });
    }

    // Actually hit a mine - loss
    const potentialCashout = Math.floor(game.bet * game.multiplier);
    const pityResult = store.recordLoss(uid, 'mines', game.bet);
    await maybeAnnouncePityTrigger(interaction, uid, pityResult);
    const cb = store.applyCashback(uid, game.bet);
    store.addToLossPool(game.bet);
    activeMines.delete(uid);
    persistMinesSessions();
    const gr = gridToString(game, ti);
    const detailParts = [`Lost **${store.formatNumber(game.bet)}** (initial bet)`];
    if (game.revealedCount > 0) {
      detailParts.push(`Missed cashout: **+${store.formatNumber(potentialCashout - game.bet)}** (${game.multiplier.toFixed(2)}x)`);
    }
    if (cb > 0) detailParts.push(`+${store.formatNumber(cb)} cashback`);
    detailParts.push(`Balance: **${store.formatNumber(store.getBalance(uid))}**`);
    return interaction.update({
      content: '',
      embeds: [buildMinesEmbed({
        title: 'Mines - BOOM',
        grid: gr,
        color: 0xed4245,
        description: detailParts.join('\n'),
      })],
      components: [],
    });
  }

  // ── Safe tile ──
  game.revealed[ti] = true;
  game.revealedCount++;
  game.multiplier = getMinesMultiplier(game.revealedCount, game.mineCount);
  persistMinesSessions();

  // Perfect clear
  if (game.revealedCount >= MINES_TOTAL - game.mineCount) {
    const baseWin = Math.floor(game.bet * game.multiplier);
    let finalWin = baseWin;
    let clearTax = 0;
    if (baseWin > game.bet) {
      const baseProfit = baseWin - game.bet;
      const boostedProfit = store.applyProfitBoost(uid, 'mines', baseProfit);
      const pityResult = store.recordWin(uid, 'mines', boostedProfit);
      await maybeAnnouncePityTrigger(interaction, uid, pityResult);
      clearTax = store.addToUniversalPool(boostedProfit, uid);
      finalWin = game.bet + boostedProfit - clearTax;
    }
    store.setBalance(uid, store.getBalance(uid) + finalWin);
    activeMines.delete(uid);
    persistMinesSessions();
    const detailParts = [`Won **+${store.formatNumber(finalWin - game.bet)}**`];
    if (clearTax > 0) detailParts.push(`${store.formatNumber(clearTax)} tax → pool`);
    detailParts.push(`Balance: **${store.formatNumber(store.getBalance(uid))}**`);
    return interaction.update({
      content: '',
      embeds: [buildMinesEmbed({
        title: 'Mines - PERFECT CLEAR',
        grid: buildFullGrid(game),
        color: 0x57f287,
        description: detailParts.join('\n'),
      })],
      components: [],
    });
  }

  // Normal reveal continue
  return interaction.update({
    embeds: [{
      title: '💣 Mines',
      description: `${game.mineCount} mines\nRevealed: **${game.revealedCount}** | **${game.multiplier.toFixed(2)}x**\nPotential: **+${store.formatNumber(Math.floor(game.bet * game.multiplier) - game.bet)}**`,
      color: 0x5865f2,
      footer: { text: `Bet: ${store.formatNumber(game.bet)}` },
    }],
    components: renderMinesGrid(game),
  });
}

/* ── Session expiry ─────────────────────────────────────── */

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
