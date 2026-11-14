// Shared Chart.js options that follow the page's colour tokens.
function token(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

export function baseOptions({ yLabel, xLabel, tooltip, hoverMode = 'index', onClick } = {}) {
  const text = token('--muted')
  const grid = token('--grid')
  const axis = (title) => ({
    ticks: { color: text },
    grid: { color: grid },
    title: title ? { display: true, text: title, color: text } : undefined,
  })
  return {
    responsive: true,
    maintainAspectRatio: false,
    onClick,
    interaction: { mode: hoverMode, intersect: hoverMode !== 'index' },
    plugins: {
      legend: { position: 'top', align: 'start', labels: { color: token('--text'), usePointStyle: true } },
      tooltip: tooltip ?? {},
    },
    scales: { x: axis(xLabel), y: axis(yLabel) },
  }
}

export function lineDataset(label, data, color, extra = {}) {
  return {
    label, data, borderColor: color, backgroundColor: color,
    borderWidth: 2, pointRadius: 4, pointHoverRadius: 6, spanGaps: true, ...extra,
  }
}
