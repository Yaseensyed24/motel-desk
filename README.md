# Staydesk — Motel front desk

A mobile-friendly motel register with a room board, flexible nightly pricing, reservations, searchable guest and room history, and cash collection by staff member.

## Two modes — important

**GitHub Pages is a fictional-data demo.** It has selectable demo staff identities, not secure password accounts. Records persist only in that browser's local storage. Do not enter real guest names, ID numbers, passwords or cash records. Multiple devices do not share data. The banner and welcome screen state these limitations.

**The included Node server provides shared records and password authentication.** It runs the same interface with a SQLite database, password hashing, expiring HTTP-only sessions, server-side validation, and conflict detection. GitHub Pages cannot run this backend. Deploy this version to a Node-compatible host with persistent disk and HTTPS for a controlled motel pilot.

No card processor, online payment gateway or payment integration is included. This is cash recording only.

## Features

- Home: stayovers, departures (including overdue), arrivals, available rooms and today's cash.
- Room board with ready, occupied, needs-cleaning and maintenance states.
- Assign room with guest name, ID, check-in/out date/time, cash, and separate security deposit.
- Apply one rate to every night or edit each night's price individually.
- Reservations by one-bed/two-bed inventory, optionally preassigned to a room, with advance cash.
- Check in a reservation without double-counting its advance.
- Extend stays while preserving previous rates and recording additional cash.
- Move a guest between rooms with exact occupancy intervals, unchanged prices, payments and deposit.
- Checkout preserves records and marks the room as needing cleaning.
- Room payments, deposits, refunds and deposit returns/retentions as separate ledger entries.
- Guest-name search and room-number history, including room transfers.
- Daily/date-range collection totals and per-staff drilldown to rooms and stays; CSV export.
- Equal-privilege staff accounts, creation, deactivation, password reset (server mode).
- Automatic staff attribution and activity history.
- JSON register export.

## Run the Pages demo locally

Requires Python 3:

```sh
npm run demo
```

Open `http://localhost:4173`. Choose a sample staff identity. No password is required in demo mode.

## Run the shared server

Requires Node.js 24 or newer. No npm dependencies are needed.

Configure these environment variables using your host's secret manager:

| Variable | Purpose |
| --- | --- |
| `MOTEL_INITIAL_USER` | First account username, for example `user1` |
| `MOTEL_INITIAL_PASSWORD` | Unique initial passphrase, 15–200 characters; never commit it |
| `MOTEL_INITIAL_NAME` | Display name; defaults to User 1 |
| `MOTEL_DB` | Absolute path to SQLite database on persistent disk |
| `PORT` | Server port, default 3000 |
| `HOST` | Bind address, default 127.0.0.1; use 0.0.0.0 behind a host proxy |
| `APP_ORIGIN` | Exact external origin; default http://localhost:3000 for local use |
| `NODE_ENV` | Set to production for hosted use; requires an HTTPS APP_ORIGIN |

Then run:

```sh
npm start
```

The first start initializes 16 example room numbers with **no guest or cash records**. Initial credentials are only used when the database is created. Remove the initial password from the environment after initialization. Edit the initial room inventory before your pilot to match the actual motel. The present interface does not yet add/delete room inventory or change the motel timezone (America/Los_Angeles).

Both browser and API must use the same origin in server mode. This release does not include a cross-origin Pages-to-backend connection. Host the Node version to use real shared accounts; do not treat the Pages demo's identity picker as authentication.

## Deploy the demo to GitHub Pages

The Pages workflow publishes **only `public/`**. No server files, database, environment secrets, tests or guest data are uploaded to the Pages artifact.

1. Create a repository and push this source to `main`.
2. In Settings → Pages, select **GitHub Actions** as the build source.
3. Run the **Deploy Pages demo** workflow (or push to main).
4. Open the deployment URL shown in the Actions/Pages deployment result.

The public demo and its code contain only fictional guest records. Publishing it does not create a working production database.

## Tests

```sh
npm test
```

Tests cover variable rates, room conflicts, overdue occupancy, transfers, type inventory, advance carryover, extensions, multiple collectors, refunds, deposits, checkout, cancellation, duplicate guest names, invalid inputs and server authentication/conflict checks.

## Production pilot readiness

Read [docs/OPERATIONS.md](docs/OPERATIONS.md). Before real guests, configure real room inventory, confirm local checkout/tax rules, validate backup restoration, review security, and run a supervised pilot alongside the existing register.

Known scope limitations: no booking-platform synchronization; no key-card integration; no offline multi-device sync; no automated tax calculation (staff enter tax/fee totals); no automated encrypted backup scheduler; no guest-data deletion/retention workflow. These gaps must be resolved according to the motel's operating needs before replacing its existing system.
