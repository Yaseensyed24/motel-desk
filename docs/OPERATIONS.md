# Operating Staydesk

## Current delivery status

This is an initial implementation for review and a controlled pilot, not a claim of a completed production security audit. GitHub Pages serves the local-only fictional-data demo. The server needs separate hosting before staff can share real data securely.

## Hosting the server

Use a Node 24+ host that supports a persistent filesystem and a single running instance. Put the SQLite file on a persistent volume, outside the static web directory. Do not deploy the SQLite file to an ephemeral serverless filesystem. The app intentionally uses one database transaction and an expected revision on each mutation to reject stale concurrent writes. Staff get a conflict message and must review the latest state before retrying.

Use an HTTPS reverse proxy and set APP_ORIGIN to the exact HTTPS hostname. The server uses an HttpOnly, SameSite=Strict cookie and adds Secure in HTTPS mode. It checks POST Origin and a custom request header to protect against cross-site requests. It does not trust a client-supplied staff ID for cash attribution.

No public self-registration exists. Every active staff member has the same full access and can create accounts, deactivate others and reset passwords. This is the requested equal-privilege model; operate it only with trusted staff. Deactivation and password reset revoke existing sessions. Sessions expire after eight hours.

## Initial configuration

The first database setup creates rooms 101–116: nine one-bed rooms and seven two-bed rooms, all marked ready. Before real use, replace this sample inventory with the actual rooms in the initializer or run a reviewed database migration before any guest records exist. Do not reset or overwrite an occupied production database. Timezone is America/Los_Angeles. Checkout form defaults to 11 AM, with per-stay changes allowed. Enter the correct tax/fee total in each booking; the app does not calculate jurisdiction-specific taxes.

## Cash interpretation

Total received = room/reservation payments + security deposits received. Net collection subtracts actual room refunds and deposit returns. Retaining an already-held deposit does not create a cash inflow. Booking, checking in and changing rooms do not create a receipt by themselves. Unpaid bookings are not cash.

Staff totals track the employee who receives/returns the cash. Stay details separately show who booked/assigned the room. A later room transfer does not change the room recorded against an earlier receipt. A reservation advance without a room is shown against its reservation reference and bed type.

No opening cash, petty cash expenses or bank deposits are tracked. The report is not a cash-drawer reconciliation or an accrual accounting revenue report.

## Backups and recovery

Schedule consistent SQLite backups using the hosting provider or SQLite backup API/VACUUM INTO. Do not copy only the live main .sqlite file while WAL writes may be outstanding. Keep encrypted backups off the application disk with access restricted to authorized staff. Choose retention and recovery targets before the pilot.

A JSON export includes sensitive guest data and is useful for review, but is not a full restorable authentication/database backup. It deliberately omits password hashes and sessions. There is no JSON restore UI.

Before launch, test restoration on a separate instance: stop that instance, restore a consistent SQLite backup, start with its own APP_ORIGIN, verify logins and guest histories, and reconcile cash totals with the source backup. Document the exact host-specific restore steps. Never test restoration by overwriting live data.

## Security and retention

Use unique passphrases and individual accounts. Do not share usernames. Keep hosting secrets outside Git. Restrict filesystem access to the database. Monitor authentication failures and server availability. Apply Node/security updates through a tested release process. A guest-data retention/deletion process and encryption-at-rest configuration are still required before real ID storage.

## Deployment and rollback

Keep source in Git. Run npm test before each deploy. Back up the database before any schema/data migration. Deploy a tested source version; do not reset the database on deployment. Source rollback and data rollback are different actions. An older source version must be compatible with the existing database before rollback.

## Front-desk pilot checks

Use fictional data first. Test assigning a room, extending it, moving rooms, adding different nightly prices, recording a deposit, refunding cash, checking out, marking clean, finding history, and comparing staff totals. Involve two staff sessions to verify conflict handling. Compare a whole day's entries to the existing register before relying on this app. Retain a paper/manual fallback for internet or host outages.
