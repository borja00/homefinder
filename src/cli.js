#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { text } from 'node:stream/consumers'
import { loadConfig } from './config.js'
import { connect } from './db.js'
import { migrate } from './migrate.js'

const USAGE = `Usage: homefinder <command> [options]

Commands:
  migrate              apply pending database migrations
  scrape [--search N]  load configured searches and record listings
  recover              resume today's interrupted scrapes (serve does this by itself)
  reparse              rebuild listings from stored raw HTML
  cookie               store the Idealista Cookie header read from stdin
  serve [--port P]     run the dashboard and API (default port 3000)

Options:
  -c, --config PATH    config file (default: config.yaml, or $HOMEFINDER_CONFIG)

DATABASE_URL must point at the Postgres database (read from .env if present).`

async function main() {
  // Variables already in the environment win, so the cluster's Secret is never overridden.
  if (existsSync('.env')) process.loadEnvFile('.env')
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      config: { type: 'string', short: 'c' },
      search: { type: 'string' },
      port: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  })
  const [command] = positionals
  if (values.help || !command) {
    console.log(USAGE)
    return
  }

  const sql = connect()
  try {
    // Commands that use the schema bring it up to date first (cheap and
    // lock-protected), so a new migration never needs a separate step.
    if (['serve', 'scrape', 'recover', 'reparse', 'cookie'].includes(command)) {
      await migrate(sql, (m) => m !== 'no pending migrations' && console.log(m))
    }
    switch (command) {
      case 'migrate':
        await migrate(sql)
        break
      case 'scrape': {
        const { scrapeAll, ScrapeBusyError } = await import('./scraper.js')
        try {
          const ok = await scrapeAll(sql, loadConfig(values.config), values.search)
          if (!ok) process.exitCode = 2
        } catch (err) {
          if (!(err instanceof ScrapeBusyError)) throw err
          console.log(`${err.message} Skipping this one.`)
        }
        break
      }
      case 'reparse': {
        const { reparse } = await import('./scraper.js')
        await reparse(sql)
        break
      }
      case 'cookie': {
        const { storeCookie } = await import('./scraper.js')
        if (process.stdin.isTTY) console.error('Paste the Cookie header, then press Ctrl-D:')
        const n = await storeCookie(sql, await text(process.stdin))
        console.log(`Stored ${n} cookies`)
        break
      }
      case 'recover': {
        const { recoverInterrupted } = await import('./scraper.js')
        const names = await recoverInterrupted(sql, loadConfig(values.config))
        console.log(names.length ? `Resumed: ${names.join(', ')}` : 'Nothing to resume')
        break
      }
      case 'serve': {
        const { createApp } = await import('./server.js')
        const { recoverInterrupted } = await import('./scraper.js')
        const port = Number(values.port ?? process.env.PORT ?? 3000)
        const server = createApp(sql).listen(port, () => console.log(`Listening on :${port}`))

        // Resume scrapes that a stop/restart cut short: shortly after start,
        // then every few minutes (also catches a CronJob killed mid-run).
        const recover = async () => {
          try {
            const names = await recoverInterrupted(sql, loadConfig(values.config))
            if (names.length) console.log(`Auto-resume finished: ${names.join(', ')}`)
          } catch (err) {
            if (err.name !== 'ScrapeBusyError') console.error(`Auto-resume: ${err.message}`)
          }
        }
        setTimeout(recover, 10_000).unref()
        setInterval(recover, 5 * 60_000).unref()

        const stop = () => server.close(() => sql.end({ timeout: 5 }).then(() => process.exit(0)))
        process.on('SIGTERM', stop)
        process.on('SIGINT', stop)
        return // keep the pool open
      }
      default:
        console.error(`Unknown command: ${command}\n\n${USAGE}`)
        process.exitCode = 1
    }
  } catch (err) {
    console.error(err.message)
    process.exitCode = 1
  }
  await sql.end()
}

await main()
