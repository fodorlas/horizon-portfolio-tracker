# Horizon

Horizon is a personal portfolio tracker for people who hold investments across several accounts, currencies and asset classes. It brings holdings, account cash, transactions and portfolio history into one view.

![A short tour: the overview with a year's figures, the positions filtered to ETFs, and the New entry form filled in](docs/images/tour.gif)

All portfolio data shown in these images is invented. The images show the fuller application UI; the interactive demo focuses on the dashboard and a core buy or sell flow.

| | |
| :---: | :---: |
| ![Overview: total wealth, the investment result, net flow and return over a year, and the value over time](docs/images/overview.png) | ![Positions: every holding with its account, units, price, value, cost basis and gain](docs/images/positions.png) |
| ![Transactions: a dividend, buys, deposits and currency exchanges, with a filter by kind and account](docs/images/transactions.png) | ![Prices and FX rates: each instrument's logged daily prices with their source, status and note](docs/images/prices.png) |

## Try the demo

The demo is a small, guided version of Horizon. It needs no account or database. Sample data and changes stay in the current browser tab. The demo sends no request to an external service, and **Reset demo** restores the starting data.

To run it locally:

```bash
npm ci
DEMO_MODE=true NEXT_PUBLIC_DEMO_MODE=true npm run dev
```

Then open [http://localhost:3100/demo](http://localhost:3100/demo).

## Product and engineering decisions

- **Start from the user's task.** The main entry flow records a buy or sale and keeps related account and instrument details close to the form.
- **Keep estimates visible.** Prices and exchange rates are logged over time; portfolio results are labelled as analysis estimates, not tax figures.
- **Measure before integrating.** External data sources were probed before their behaviour shaped the application, and invented responses are used in tests.
- **Separate the showcase from account data.** The demo uses browser session storage and bundled sample prices. It does not call the authenticated application, Supabase, or external providers.

The application code also includes a Supabase-backed mode. Its access model uses verified TOTP and database Row Level Security. Database tests reject any target whose hostname is not a loopback address, and CI starts a disposable local Supabase instance for those tests.

## Technology

Next.js App Router · TypeScript · Supabase · PostgreSQL · Vitest · Playwright

## Development and checks

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run test:e2e:demo
```

The database checks require the Supabase CLI and Docker. Start the local stack, load its disposable credentials, then run the RLS and authentication tests:

```bash
npx supabase start -x realtime,storage-api,imgproxy,postgres-meta,studio,edge-runtime,logflare,vector,supavisor
eval "$(scripts/local-supabase-env.sh)"
npm run test:db
```

The test guard permits loopback hosts only. Do not point the database tests at a hosted Supabase project.

## AI-assisted development

AI tools supported implementation and code review. I set the product scope and financial rules, reviewed the changes, and made the final project decisions.

## Licence

Released under the MIT Licence. See [LICENSE](LICENSE).
