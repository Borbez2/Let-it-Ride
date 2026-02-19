/**
 * Local Chart.js renderer using chartjs-node-canvas.
 *
 * Returns a PNG Buffer instead of a URL, so callers attach it to Discord
 * messages via `AttachmentBuilder`.
 */
const { ChartJSNodeCanvas } = require('chartjs-node-canvas');

// Keep one renderer per (width, height) to avoid creating new canvases each time.
const renderers = new Map();

function getRenderer(width, height) {
  const key = `${width}x${height}`;
  if (renderers.has(key)) return renderers.get(key);

  const renderer = new ChartJSNodeCanvas({
    width,
    height,
    backgroundColour: '#1f1f1f',
  });

  renderers.set(key, renderer);
  return renderer;
}

/**
 * Render a Chart.js config to a PNG Buffer.
 *
 * @param {object} chartConfig  - Chart.js configuration object (type, data, options, …).
 * @param {number} [width=980]  - Image width in pixels.
 * @param {number} [height=420] - Image height in pixels.
 * @returns {Promise<Buffer>}   - PNG image buffer.
 */
async function renderChartToBuffer(chartConfig, width = 980, height = 420) {
  const renderer = getRenderer(width, height);
  return renderer.renderToBuffer(chartConfig);
}

module.exports = { renderChartToBuffer };
