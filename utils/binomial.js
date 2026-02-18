function binomialLowerTail(k, n, p) {
  if (n < 0) return 0;
  if (k < 0) return 0;
  if (k >= n) return 1;
  if (p <= 0) return 1;
  if (p >= 1) return k >= n ? 1 : 0;

  const q = 1 - p;
  let term = Math.pow(q, n);
  let sum = term;

  for (let i = 0; i < k; i++) {
    term *= ((n - i) / (i + 1)) * (p / q);
    sum += term;
  }

  if (sum < 0) return 0;
  if (sum > 1) return 1;
  return sum;
}

function binomialUpperTail(k, n, p) {
  if (k <= 0) return 1;
  if (k > n) return 0;
  const lowerBefore = binomialLowerTail(k - 1, n, p);
  const result = 1 - lowerBefore;
  if (result < 0) return 0;
  if (result > 1) return 1;
  return result;
}

function getLuckAssessment(wins, total, expectedWinProb = 0.5) {
  if (!Number.isFinite(wins) || !Number.isFinite(total) || total <= 0) {
    return null;
  }

  const p = expectedWinProb;
  const n = total;
  const expectedWins = n * p;
  const variance = n * p * (1 - p);
  const stdDev = variance > 0 ? Math.sqrt(variance) : 0;
  const zScore = stdDev > 0 ? (wins - expectedWins) / stdDev : 0;

  let direction = 'neutral';
  let tailProbability = 1;

  if (wins > expectedWins) {
    direction = 'lucky';
    tailProbability = binomialUpperTail(wins, n, p);
  } else if (wins < expectedWins) {
    direction = 'unlucky';
    tailProbability = binomialLowerTail(wins, n, p);
  }

  const confidence = direction === 'neutral' ? 0 : (1 - tailProbability) * 100;
  const winRate = (wins / n) * 100;
  const expectedRate = p * 100;

  return {
    wins,
    total: n,
    expectedWins,
    expectedRate,
    winRate,
    winRateDelta: winRate - expectedRate,
    direction,
    tailProbability,
    confidence,
    zScore,
  };
}

module.exports = {
  binomialLowerTail,
  binomialUpperTail,
  getLuckAssessment,
};
