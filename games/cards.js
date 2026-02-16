function createDeck() {
  const suits = ['♥', '♦', '♣', '♠'];
  const values = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
  const deck = [];
  for (const s of suits) for (const v of values) deck.push({ suit: s, value: v });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function getCardValue(c) {
  if (['J','Q','K'].includes(c.value)) return 10;
  if (c.value === 'A') return 11;
  return parseInt(c.value);
}

function getHandValue(hand) {
  let v = 0, a = 0;
  for (const c of hand) { v += getCardValue(c); if (c.value === 'A') a++; }
  while (v > 21 && a > 0) { v -= 10; a--; }
  return v;
}

function formatCard(c) { return `\`${c.value}${c.suit}\``; }
function formatHand(h) { return h.map(formatCard).join(' '); }

function canSplit(hand) {
  return hand.length === 2 && getCardValue(hand[0]) === getCardValue(hand[1]);
}

module.exports = { createDeck, getCardValue, getHandValue, formatCard, formatHand, canSplit };
