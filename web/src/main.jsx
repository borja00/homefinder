import { createRoot } from 'react-dom/client'
import {
  CategoryScale, Chart, Legend, LinearScale, LineElement, PointElement, ScatterController, Tooltip,
} from 'chart.js'
import App from './App.jsx'
import './styles.css'

Chart.register(CategoryScale, LinearScale, LineElement, PointElement, ScatterController, Tooltip, Legend)

createRoot(document.getElementById('root')).render(<App />)
