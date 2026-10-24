# Puentes

Puentes is your chief of staff for relationships. It reads what your inner circle posts on LinkedIn, X and Bluesky, so you don't have to scroll. It ranks their updates against your objectives and gives you:

- **Follow-up nudges**: "Ana just joined Stripe. Here's a draft."
- **Serendipity intros**: "Diego is raising for grid storage, and Sofi just started investing in it."
- **A personal CRM** you can talk to.

The interface is a WhatsApp chat (via [Kapso](https://kapso.ai)) plus an MCP server for Claude Code and Desktop. Both come from one [eve](https://eve.dev) agent.

```
people.yaml → collector/ (Playwright, your Chrome profile) → SQLite
           → agent/lib/pipeline (enrich: Haiku → events, rank: Sonnet → nudges + matches)
           → agent/ (eve): tools/ ← channels/kapso.ts (WhatsApp) + channels/mcp.ts (MCP), schedules/
```

## Setup

```bash
npm install
npx playwright install chrome   # if Chrome isn't installed
npm run db:push
```

1. **Models:** set `OPENAI_API_KEY` in `.env.local`. Puentes uses `gpt-6-luna` for extraction and `gpt-6-sol` for ranking, drafts and the agent; change them in `agent/lib/models.ts`.
2. **Sources (who to follow):** open the dashboard → **Sources**. Click **Sign in** for X or LinkedIn and a live view of Puentes' own browser appears inline; sign in there (passkeys are disabled so it falls back to password, and your everyday Chrome is never touched). For Bluesky, just enter your handle. Then **Import** your followings — everyone gets scored and the best inner-circle candidates surface under People → Suggestions. Only people you add to your inner circle get scraped and ranked.
3. **WhatsApp:**
   - Run `curl -fsSL https://kapso.ai/install.sh | bash && kapso setup`. The free plan includes a number.
   - Fill in `KAPSO_API_KEY`, `KAPSO_PHONE_NUMBER_ID`, `KAPSO_WEBHOOK_SECRET` and `OWNER_PHONE` (your own number) in `.env.local`.
   - Start a tunnel with `npm run tunnel` (needs `brew install cloudflared`). Then register the webhook:
     ```bash
     kapso whatsapp webhooks new --phone-number-id $KAPSO_PHONE_NUMBER_ID \
       --url https://<tunnel>/eve/v1/kapso --event whatsapp.message.received --active
     ```
     Set the same secret in Kapso.
4. **MCP:**
   ```bash
   claude mcp add --transport http puentes http://localhost:2000/eve/v1/mcp
   ```

## Run

| Command | What it does |
|---|---|
| `npm run dev:web` | **Dashboard** on :3000: inbox of nudges (copy / WhatsApp / done / snooze, `j` `k` `c` `d` `s` `x` keys), intros, people, objectives, re-rank button, desktop alerts. Also serves the agent API. |
| `npm run dev` | Starts only the eve agent: REPL, WhatsApp webhook, MCP on :2000 |
| `npm run browser` | The shared browser (headless Chrome, its own `.profile`). The dashboard starts this on demand; run it with `BROWSER_HEADED=1` to also show the real window. |
| `npm run connect -- x\|linkedin` | Open a platform's login in the shared browser (normally done from Sources) |
| `npm run import -- x\|linkedin\|bluesky` | Import followings and re-prioritize (normally done from Sources) |
| `npm run graph -- [N]` | Mine N people's bios into the event log + knowledge graph (companies, schools, topics, places, events). Resumable. Also the Network page's "Map more" and the `map_network` tool. |
| `npm run pipeline` | Scrape tracked people, enrich and rank (also the `run_pipeline` tool and nightly at 3am) |
| `npm run collect` / `npm run rank` | Only scrape / only enrich and rank |
| `npm run demo` | Loads fictional `fixtures/demo.json` instead of scraping, then ranks |
| `npm run capture` | Saves what you scraped to `fixtures/capture.json` for a replayable demo |

If a live import comes back empty, the site changed its API shape — rerun with `CAPTURE_DIR=.capture` to dump the raw responses, then adjust the parser in `collector/following.ts` or `collector/adapters/linkedin.ts`.

To trigger the digest by hand in dev:

```bash
curl -X POST localhost:2000/eve/v1/dev/schedules/morning-digest
```

## Notes

- **Puentes only talks to `OWNER_PHONE`** and never messages your friends. It hands you drafts and `wa.me` links.
- **24-hour window:** WhatsApp only allows free-form messages within 24h of your last message to the bot. Text it first, or register a utility template for the morning digest.
- **Scraping:** LinkedIn and X prohibit it. The collector is local, read-only and slow on purpose: jittered delays, at most 25 LinkedIn profiles per run, 14-day lookback. Use `npm run demo` on stage.
- **Selectors:** if LinkedIn changes its markup, update `SEL` in `collector/adapters/linkedin.ts`.
- **Writing style:** edit the voice section of `agent/subagents/drafter/instructions.md`. The ranking drafts use it too.
