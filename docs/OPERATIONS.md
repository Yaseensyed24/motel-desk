# Operating Staydesk

Staydesk is a compact motel register for a controlled pilot. The GitHub Pages build is a fictional-data browser demo. The Node build is the shared version for a real motel and needs a persistent filesystem, HTTPS, and a backup plan.

## Hosting the server

Use a Node 24+ host with persistent storage. Keep the SQLite database outside the static web directory. Run one application instance, use an HTTPS reverse proxy, and set `APP_ORIGIN` to the exact public HTTPS origin. The server uses an HttpOnly, SameSite=Strict session cookie, validates POST origins, and checks an expected revision on every mutation so a stale tab cannot silently overwrite a newer save.

Only one account is enabled: the Boss account. Do not share the password. This is a single-owner model with no role or staff picker; cash entries are attributed to the signed-in Boss account. Sessions expire after eight hours.

## Initial configuration

The first database setup creates one Boss account, an empty guest register, and no room inventory. Staff type a room number when a guest checks in. A room appears on the current room board only while a stay uses it, while all historical room segments remain searchable afterwards. The default timezone is `America/Los_Angeles`, and checkout defaults to 11:00.

Set `MOTEL_INITIAL_USER`, `MOTEL_INITIAL_PASSWORD` (15–200 characters), and optionally `MOTEL_INITIAL_NAME` before the first launch. Remove the initial password from the host environment after initialization. Do not delete or recreate the SQLite file once real records exist.

## Cash interpretation

Total collected for a day is room payments plus security deposits received on that day. Net cash subtracts room refunds and returned deposits. Retaining an already-held deposit does not create a new cash inflow. A cash entry keeps its stay, room, timestamp, type, and note. Totals are integer cents and are displayed to two decimal places.

The home page shows the day’s total collected. The Cash page shows total collected, cash returned, net cash, and every entry for the selected date. This is a cash register report, not an accrual revenue report or a full drawer reconciliation; opening cash, expenses, and bank deposits are outside the current scope.

## Backups and recovery

Back up SQLite consistently while the app is running; use the host’s SQLite backup support or `VACUUM INTO` rather than copying only the main file while WAL writes may be outstanding. Store encrypted backups away from the application disk and restrict access. Test restoration on a separate instance before the pilot.

The browser demo’s local storage is not a backup. The optional JSON export contains guest information but not password hashes or sessions and is not a complete database restore.

## Security and retention

Use HTTPS, a strong unique Boss passphrase, restricted filesystem permissions, host secret storage, and current Node security updates. Decide how long guest IDs and cash history should be retained, how corrections are reviewed, and who may access backups before entering real data.

## Deployment and rollback

Run `npm test` before every release. Back up the database before schema changes. Keep source and database rollback plans separate: an older source version must remain compatible with the current database before it is deployed.

## Pilot checks

Use fictional records first. Test registering a guest, applying different nightly prices, recording a deposit, returning cash, moving rooms, extending a stay, checking out, creating a future reservation, checking it in, finding guest history, opening room history, and reconciling a full day of cash. Keep the existing paper/manual fallback available for an outage.
