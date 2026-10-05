# Demo mode

## Purpose

Demo mode presents Horizon's actual portfolio screens with fictional, read-only data. It needs no account or database and does not connect to Supabase or external data providers.

## Configuration

- `DEMO_MODE` is off unless it is explicitly set to `true`.
- Demo mode refuses to start if any Supabase URL, key, or database connection variable is configured. The error names the conflicting variable without printing its value.
- Demo builds and runtime work with no Supabase variables set.
- The server-side setting selects demo mode. A public client flag does not grant access to demo or live data.

## Data

- Use only the bundled fictional sample data. Never copy personal portfolio data, account names, identifiers, or transaction history into the demo.
- Build the sample portfolio through the same finance model used by the live screens.
- Pages may read the sample data but cannot change it. The app proxy blocks all write requests except the demo reset route.
- Demo visitors always see the bundled sample portfolio. Opening another tab or reloading does not create or share visitor-specific portfolio data.
- **Reset demo** clears preference cookies and legacy demo-session storage, then returns to the overview.

## Screens

- Reuse Horizon's actual app shell and screens for the overview, positions, transactions, accounts, instruments, prices, and settings.
- Navigation and GET-based filters remain available. Forms and actions that would change portfolio data are read-only.
- The initial language is English. The notice identifies the figures as fictional and the preview as read-only.

## Network

- Demo routes allow only the read-only application pages and the reset endpoint.
- Do not call Supabase, price or FX providers, weather services, scheduled work, or background saves in demo mode.
- The demo content security policy allows connections only to the app origin.
- Browser tests inspect requests and fail if a demo page contacts an external origin. Write requests must be rejected before an action runs.

## Authentication and live-mode boundary

- Demo visitors do not register, sign in, or configure two-factor authentication.
- Live mode keeps its current Supabase Auth, verified TOTP, and database Row Level Security behavior.
- Demo routing and data access stay behind the server-side demo setting. Client-visible flags never bypass live authentication.
- Do not change the live Vercel project, its environment variables, or either live database as part of demo work.

## Verification

- Test that demo portfolio data matches the fictional seed and produces complete portfolio values.
- Run a browser smoke test for the real Horizon shell, overview, positions, transactions, demo reset, and blocked writes.
- Assert that no browser request leaves the app origin during the smoke test.
- Test that enabling demo mode alongside any Supabase configuration causes a clear startup failure.
- Run existing live-mode checks without changing their targets or semantics.
