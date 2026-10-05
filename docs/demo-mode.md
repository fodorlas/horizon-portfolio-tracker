# Demo mode

## Purpose

Demo mode gives portfolio reviewers a safe, interactive way to explore Horizon's main workflow. It uses fictional sample data in the visitor's browser and never connects to Supabase or external data providers.

## Configuration

- `DEMO_MODE` is off unless it is explicitly set to `true`.
- When demo mode is on, the app must refuse to start if any Supabase URL, key, or database connection variable is configured. The error must identify the conflicting configuration without printing its value.
- Demo builds and runtime must work with no Supabase variables set.
- Demo mode is selected by server configuration. A public client flag may control presentation, but it must not be the security boundary.

## Data and session lifetime

- Serve the showcase from a dedicated demo route. It must not render the live server pages or invoke their Supabase-backed actions. Reuse shared finance calculations only where they can run without server-only or network dependencies.

- Use deterministic, clearly fictional seed data. Never copy personal portfolio data, account names, identifiers, or transaction history into the demo.
- Store demo changes only in the visitor's browser, scoped to the current tab session. Do not use server memory, shared caches, cookies, or a remote database for demo state.
- Reloading the same tab may retain changes. Closing the tab ends the demo session; opening a new tab starts from the seed data.
- “Reset demo” restores the seed data immediately. Reloading after reset must still show the seed data.
- If browser storage is unavailable or contains invalid data, the app must remain usable by falling back to the seed data.

## Supported showcase

The demo focuses on a short portfolio-review journey:

1. Review a portfolio with fictional assets, accounts, currencies, cash, and a compact history.
2. Record a buy or sale and see the account cash and portfolio totals respond.
3. Explore the allocation and value history, then reset the demo.

Use bundled sample prices and label them as sample prices. Advanced ledger corrections, splits, foreign-exchange trades, bond-interest approvals, and other owner-only workflows are outside the first showcase unless needed to complete this journey.

## Network and background work

- Demo pages and interactions must make no request to Supabase or any other external host.
- Do not run price or FX providers, weather lookups, scheduled work, or background saves in demo mode.
- The content security policy for the demo must not allow connections to external services.
- Tests must inspect browser requests and fail if a demo session contacts an external origin.

## Authentication and live-mode boundary

- Demo visitors do not register, sign in, or configure two-factor authentication.
- The existing live application keeps its current Supabase Auth, verified TOTP, and Row Level Security behavior.
- Demo routing and data access must be isolated behind the server-side demo setting. Client-visible flags must never grant access to live data or bypass live authentication.
- Do not change the live Vercel project, its environment variables, or either live database as part of demo work.

## Interface and language

- Show a clear notice that the app is a demo using sample data that is not saved.
- Provide a “Reset demo” control and a link explaining how the live version works.
- English is the demo's initial language. A language change applies only to the current demo tab session.
- Keep live-mode language preferences and defaults unchanged.

## Verification

- Unit-test loading, buy/sell changes, cash handling, reset, and invalid stored state.
- Run a browser smoke test for the unauthenticated English landing, one buy, updated totals, reset, and reload.
- Assert that no browser request leaves the app origin during the smoke test.
- Test that enabling demo mode alongside any Supabase configuration causes a clear startup failure.
- Run existing unit, end-to-end, and database tests in live mode without changing their targets or semantics.
