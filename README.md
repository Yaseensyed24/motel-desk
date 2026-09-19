# Staydesk — Motel front desk

Staydesk is a small cash-only motel register. The front desk opens on three useful numbers—stayovers, today’s departures, and today’s cash—and keeps the room board, guest history, room history, reservations, nightly rates, room moves, checkout, and cash ledger in one place.

## Current workflow

- One account is enabled: **Boss**. There are no roles, staff pickers, or preloaded room inventory.
- Register a guest in three short sections: person details, stay details, then a manually typed room number.
- Type one rate for every night or choose a different rate for each night. All stored amounts are integer cents, so totals do not drift by fractions of a cent.
- A room card is created only when an active guest is checked in. Moving from one room to another keeps both room intervals in the guest and room history.
- Search history by guest name, ID number, or room number. Future reservations can be entered with a room number and checked in later.
- Cash is recorded manually. Room payments, security deposits, refunds, and returned deposits remain separate ledger entries.

## Two modes

**GitHub Pages is a browser demo.** It starts empty and stores fictional data in that browser’s local storage. It is useful for trying the flow, but it is not shared across devices and does not provide secure production authentication. Do not enter real guest IDs, names, passwords, or cash records into the public demo.

**The included Node server is the shared version.** It uses SQLite, one password-protected Boss account, HTTP-only sessions, server-side validation, revision checks, and the same cash and history rules. GitHub Pages cannot run this backend; use a Node host with persistent disk and HTTPS for a real motel pilot.

No payment gateway or card integration is included. Cash is entered by the Boss at the desk.

## Run the Pages demo locally

Requires Python 3:

```sh
npm run demo
```

Open `http://localhost:4173` and choose **Boss**. The first save creates the first manually typed room card.

## Run the shared server

Requires Node.js 24 or newer. No npm dependencies are needed.

Configure these environment variables with your host’s secret manager before the first start:

| Variable | Purpose |
| --- | --- |
| `MOTEL_INITIAL_USER` | Boss username; defaults to `boss` |
| `MOTEL_INITIAL_PASSWORD` | Unique initial passphrase, 15–200 characters |
| `MOTEL_INITIAL_NAME` | Boss display name; defaults to `Boss` |
| `MOTEL_DB` | Absolute path to SQLite on persistent storage |
| `PORT` | Server port, default `3000` |
| `HOST` | Bind address, default `127.0.0.1` |
| `APP_ORIGIN` | Exact external origin; use `https://...` in production |
| `NODE_ENV` | Set to `production` when hosted behind HTTPS |

Then run:

```sh
npm start
```

The first start creates an empty register with one Boss account and no room list. The initial password is only used while the database is created; remove it from the host environment afterwards. Timezone is `America/Los_Angeles`, and checkout defaults to 11:00 while remaining editable per stay.

## Deploy the demo to GitHub Pages

The Pages workflow publishes only `public/`; it does not upload the server, database, tests, or secrets.

1. Push the source to `main`.
2. In **Settings → Pages**, choose **GitHub Actions**.
3. Push to `main` or run **Deploy Pages demo**.
4. Open the Pages URL from the deployment result.

## Tests

```sh
npm test
```

The tests cover exact-cents totals, one-account setup, manual room conflicts, transfers, extensions, reservations, checkout, cash returns, categories, invalid data, and server authentication/conflict checks.

## Pilot checklist

Before using real guest information, use a Node host with persistent encrypted backups, HTTPS, a strong Boss passphrase, restricted database access, a written retention policy, and a supervised pilot beside the existing register. Reconcile a full day of cash against the existing process before making Staydesk the system of record.
