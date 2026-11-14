import { existsSync, readFileSync } from 'node:fs'
import YAML from 'yaml'

export function loadConfig(path = process.env.HOMEFINDER_CONFIG || 'config.yaml') {
  if (!existsSync(path)) {
    throw new Error(`${path} not found. Copy config.example.yaml to ${path} and edit it.`)
  }
  const raw = YAML.parse(readFileSync(path, 'utf8')) ?? {}
  const scraper = raw.scraper ?? {}
  const [lo, hi] = scraper.delay_seconds ?? [25, 60]
  return {
    searches: (raw.searches ?? []).map(({ name, url }) => ({ name, url })),
    maxPagesPerSearch: scraper.max_pages_per_search ?? 3,
    delaySeconds: [Number(lo), Number(hi)],
    saveRawHtml: scraper.save_raw_html ?? true,
    rawHtmlRetentionDays: scraper.raw_html_retention_days ?? 30,
    fetchDetails: scraper.fetch_details ?? true,
    detailsPerRun: scraper.details_per_run ?? 100,
    baseUrl: 'https://www.idealista.com',
    autoResume: scraper.auto_resume ?? true,
    resumeAttempts: scraper.resume_attempts ?? 3,
  }
}

export function databaseUrl() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')
  return url
}
