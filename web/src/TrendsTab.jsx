import { useEffect, useState } from 'react'
import { Line, Scatter } from 'react-chartjs-2'
import { api, colorMap, fmtEur, fmtNum } from './lib.js'
import { baseOptions, lineDataset } from './charts.js'

function countOptions() {
  const options = baseOptions({ yLabel: 'Anuncios' })
  options.scales.y.beginAtZero = true
  return options
}

export default function TrendsTab({ listings }) {
  const [trends, setTrends] = useState(null)
  useEffect(() => { api('/api/trends').then(setTrends).catch(() => setTrends([])) }, [])
  if (!trends) return <p className="notice">Cargando…</p>
  if (!trends.length) return <p className="notice">Todavía no hay datos.</p>

  const days = [...new Set(trends.map((t) => t.day))].sort()
  const searches = [...new Set(trends.map((t) => t.search_name))]
  const colors = colorMap(searches)
  const series = (field) => ({
    labels: days,
    datasets: [...searches].sort().map((s) => {
      const byDay = Object.fromEntries(trends.filter((t) => t.search_name === s).map((t) => [t.day, t[field]]))
      return lineDataset(s, days.map((d) => byDay[d] ?? null), colors[s])
    }),
  })

  const active = listings.filter((l) => l.active && l.size_m2 && l.price)
  const scatter = {
    datasets: [...searches].sort().map((s) => ({
      label: s,
      data: active.filter((l) => l.searches[0] === s).map((l) => ({ x: l.size_m2, y: l.price, l })),
      backgroundColor: colors[s],
      borderColor: 'white',
      borderWidth: 1.5,
      pointRadius: 5,
      pointHoverRadius: 7,
    })),
  }
  const scatterOptions = baseOptions({
    xLabel: 'm²', yLabel: 'Precio (€)', hoverMode: 'nearest',
    onClick: (_e, points, chart) => {
      const p = points[0]
      if (p) location.hash = `anuncio/${encodeURIComponent(chart.data.datasets[p.datasetIndex].data[p.index].l.id)}`
    },
    tooltip: {
      callbacks: {
        label: ({ raw: { l } }) => [l.title, `${fmtEur(l.price)} · ${fmtNum(l.size_m2)} m² · ${fmtNum(l.eur_m2)} €/m²`, `${l.rooms ?? '?'} hab.`],
      },
    },
  })

  return (
    <>
      <h2>Mediana de €/m² de los anuncios en venta</h2>
      <div className="chart"><Line data={series('median_eur_m2')} options={baseOptions({ yLabel: '€/m²' })} /></div>
      <h2>Anuncios en venta</h2>
      <div className="chart"><Line data={series('active')} options={countOptions()} /></div>
      {days.length < 2 && <p className="muted">Las tendencias necesitan al menos dos días de descargas.</p>}
      <h2>Precio frente a superficie (anuncios activos)</h2>
      <div className="chart tall"><Scatter data={scatter} options={scatterOptions} /></div>
      {searches.length > 3 && <p className="muted">Con más de 3 búsquedas el gráfico se lee mal; pulsa en la leyenda para ocultar alguna.</p>}
    </>
  )
}
