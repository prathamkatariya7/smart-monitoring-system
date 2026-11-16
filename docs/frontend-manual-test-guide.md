# Reactor Monitoring Platform — Frontend Manual Test Guide

**Purpose:** a step-by-step script for manually exercising every screen of
the web frontend against the real backend, so you can confirm it with your
own eyes (not just take the build's word for it).

**Audience:** you (or anyone else at Borosil doing a sanity check before a
demo/pilot) — no coding knowledge assumed beyond following steps in order.

---

## 1. Prerequisites — get everything running

### 1.1 Start the backend stack
From the project root (`D:\Pratham\Firmware\Cortex IDE\Smart Monitoring System`):
```
docker compose up -d
```
Wait ~15 seconds, then confirm all four containers are up:
```
docker compose ps
```
You should see `app`, `postgres`, `mosquitto`, `caddy` all `Up` (postgres
should say `(healthy)`). If any container is missing or restarting, run
`docker compose logs <service>` to see why before continuing.

**Quick backend sanity check** — open this URL in any browser:
```
http://localhost:3000/health
```
You should see JSON with `"status":"ok"`. If it says `"degraded"` or
`"critical"`, something's wrong with the backend itself — fix that before
testing the frontend, since every frontend screen depends on it.

### 1.2 Start the frontend dev server
Open a terminal in `frontend/`:
```
cd frontend
npm install        # only needed the first time, or after pulling new changes
npm run dev
```
Leave this terminal running. It will print:
```
➜  Local:   http://localhost:5173/
```
That's the app. Open it in your browser.

> **Note on this machine specifically:** if `npm` fails with an `EPERM` /
> `lstat 'C:\Users\Borosil\AppData'` error, there's a broken `nvm4w` shim
> earlier on your PATH than the real Node install. Use the full path instead:
> `& "C:\Program Files\nodejs\npm.cmd" install` / `run dev`. This is a
> one-time machine quirk, not an app bug.

### 1.3 Log in
Go to `http://localhost:5173`. You'll land on a login screen.

| Field | Value |
|---|---|
| Username | `admin` |
| Password | `ChangeMe123!` |

Click **Sign in**. You should land on the Dashboard with a sidebar showing
Dashboard, Devices, Processes, Alarms & Overrides, Notifications, Admin.

If login fails, double check the backend is actually reachable at
`http://localhost:3000/health` first — a frontend "login failed" almost
always means the backend/proxy isn't up, not a password problem.

---

## 2. What "working" looks like, screen by screen

For each screen below: what you should see, what to click, and what should
happen. If any step doesn't match, note the exact screen + step + what you
saw instead — that's a precise bug report.

### 2.1 Dashboard (`/`)
- **Expect:** one card per reactor currently configured, each showing a
  temperature/RPM/torque snapshot and a green "OK" tag, or a red alarm-count
  tag if that reactor has active alarms, or an orange "Maintenance" tag.
- **Try:** wait ~5 seconds and watch a card's numbers — if a device is
  actively streaming data (see §3 for how to simulate one), the values
  should update without you refreshing the page.
- **Try:** click a reactor card → should navigate to that reactor's detail
  page.
- **If the list is empty:** that's expected on a brand-new install with no
  reactors created yet — go create one via Admin → Tenancy first (§2.8), or
  skip to a database that already has test data from earlier sessions.

### 2.2 Reactor detail (`/reactors/:id`)
- **Expect:** a breadcrumb back to Dashboard, a "Live status" card with the
  latest temperature/RPM/torque, a line chart under "Recent trend", an
  "Active alarms" table, and a "Reactor details" card.
- **Try:** if there's an active alarm in the table with an "Acknowledge"
  button, click it → the row should update (button disappears, state
  changes) within a couple seconds without a full page reload.
- **Try:** watch the chart over ~10-15 seconds while data is streaming — new
  points should appear at the right edge.

### 2.3 Devices (`/devices`, sidebar only visible to Admin)
- **Expect:** a table of every claimed device (serial number, claim state,
  status, last seen, firmware version) with action buttons per row.
- **Try — Claim a new device:** click **Claim device** (top right). Fill in
  a serial number and claim code that **don't already exist** (e.g.
  `DEV-TEST-01` / `TESTCODE`). Submit.
  - **Expect success** if you're under your licence's device limit (check
    Admin → Licence for `maxDevices`, with a 10% grace margin on top).
  - **Expect a red error toast** ("Licence device limit reached...") if
    you're at/over the limit — **this is correct behaviour, not a bug.** It
    proves the licence enforcement works. Don't be alarmed if it fires.
- **Try — History:** click **History** on any device → a side panel opens
  showing its binding history (which reactor it was/is attached to, when).
  A freshly-claimed, never-bound device correctly shows "No data".
- **Try — Bind:** click **Bind** on a claimed-but-unbound device → pick a
  reactor from the dropdown, enter a reason, submit → the device's row
  should still show `CLAIMED`/`ACTIVE` (binding doesn't change claim state,
  it attaches the device to a reactor so its data has somewhere to go).
- **Try — Unbind / Decommission:** only available on claimed, non-decommissioned
  devices; both ask for confirmation before acting. Decommission is
  irreversible — don't do this to a device you still want to use for
  testing.

### 2.4 Processes (`/processes`)
- **Expect:** a table of processes (batches/runs) with name, reactor,
  status tag, planned start/end.
- **Try — Create a new process:** click **New process**. Fill in:
  - Name (anything, e.g. "Manual test run")
  - Reactor (pick from dropdown — must have at least one reactor configured)
  - Planned start (pick a date/time)
  - Planned duration in hours (e.g. `1`)
  - Analysts — pick at least one user (the first one you pick becomes the
    "owner"; with only `admin` seeded, pick `Default Admin`)
  - Submit → should appear in the table with status `SCHEDULED`.
- **Try — Walk a process through its lifecycle:** click into the process you
  just created, then in order:
  1. **Accept assignment** (if shown) → then **Start** → status becomes `RUNNING`.
  2. While `RUNNING`, try **Pause** (it'll ask for a reason) → status becomes `PAUSED`.
  3. **Resume** → back to `RUNNING`.
  4. **Complete** → status becomes `COMPLETED` (or `AWAITING_COMPLETION` first,
     in which case click **Confirm complete** to finish it).
  5. Once `COMPLETED`, a **Restart** button should appear — this proves the
     "terminal state → restart" path from the backend's process lifecycle
     rules is wired up correctly.
  - Every action that changes state should show a green "Done" toast and the
    status tag at the top of the card should update immediately.
  - Check the **Attempts** table at the bottom of the detail page — a new
    attempt row should appear each time the process starts.

### 2.5 Alarms & Overrides (`/alarms`)
Three tabs:
- **Alarms tab:** a table of raised alarms. If one is `ACTIVE_UNACK`, click
  **Acknowledge** → state should change. Click **Override** on an active
  alarm → fill in a reason code, optional details, and a duration in
  minutes → submit → check the **Overrides** tab to see it listed.
- **Overrides tab:** shows override requests. An active (not-yet-ended) one
  shows a **Revoke** button (asks for confirmation) and, if unseen, a
  **Mark seen** button.
- **Alert catalog tab (Admin only):** a reference table of all configured
  alert types, their severity class, who's allowed to override them, and
  the max override duration — this is read-only in the current build, just
  verify it lists ~11 rows across its pages.

### 2.6 Notifications (`/notifications`, also the bell icon top-right)
- **Expect:** a list of notifications, unseen ones highlighted with a light
  blue background and a **Mark seen** button.
- **Try:** click **Mark seen** on one → highlight should disappear, the
  little red badge count on the bell icon (top right, visible from any
  page) should decrease by one.
- **Try:** click **Mark all seen** → badge count should drop to 0 (no badge
  shown at all).
- **Try (requires §3 below):** trigger a real alarm via the device simulator
  while this app is open → a toast notification should pop up in the
  top-right corner **without you refreshing the page** — this is the
  real-time push working, not a polling refresh.

### 2.7 Admin (`/admin`, Admin role only) — four tabs
- **Tenancy tab:**
  - **Sites** table + **New site** button (name + optional time zone).
  - **Laboratories** table + **New laboratory** button (needs a Site's UUID
    — copy it from the Sites table above, there's no dropdown yet, paste the
    ID string directly).
  - **Feature switches** table — each row has a toggle switch; flipping one
    should show a success toast and the switch should stay in its new
    position after the table refreshes.
- **Licence tab:**
  - Shows installed/valid/expired status, organisation, edition, max
    devices, support term end date.
  - **Upload new licence:** only test this with a real signed `licence.json`
    file's contents (paste the whole `{"payload": {...}, "signature": "..."}`
    JSON) — pasting garbage should show a clear "signature verification
    failed" error, not a crash.
- **Backups tab:**
  - A table of backup files with size and creation time, each with a
    **Download** link.
  - Click **Trigger backup now** → after a few seconds a new row should
    appear at the top of the table. Click its **Download** link → your
    browser should download a `.sql` file.
- **Health tab:**
  - Four tiles: Database, MQTT broker, Disk free, Last backup — all should
    read green/healthy values if the backend is in good shape. This tab
    auto-refreshes every 10 seconds; watch "Last backup" tick upward in
    real time (e.g. "2 min ago" → "3 min ago").

### 2.8 Role-based visibility check — every role, with real credentials

Six roles exist in this deployment. All use the same demo password,
**`ChangeMe123!`**, except the seeded Borosil Admin bootstrap account below.
(`lab_incharge1`/`analyst1` are additionally scoped to **QC Lab 1** — the one
laboratory seeded in this dev deployment — via a `user_lab_scope` row, so
they have something real to see; `auditor1`/`support1` deliberately have
**no** lab scope, so you can also confirm the "zero visibility without an
explicit scope grant" case, which is enforced by Postgres row-level
security, not just hidden in the UI.)

| Username | Password | Role | Lab scope |
|---|---|---|---|
| `admin` | `ChangeMe123!` | ADMIN | full (ADMIN bypasses lab scoping) |
| `sai_admin` | `ChangeMe123!` | ADMIN | full (ADMIN bypasses lab scoping) |
| `borosil_admin` | `ChangeMe123!` | BOROSIL_ADMIN | none (by design — see `licence-management-guide.md` §0) |
| `lab_incharge1` | `ChangeMe123!` | LAB_INCHARGE | QC Lab 1 |
| `analyst1` | `ChangeMe123!` | ANALYST | QC Lab 1 |
| `auditor1` | `ChangeMe123!` | AUDITOR | none |
| `support1` | `ChangeMe123!` | SUPPORT | none |

What each role should see in the sidebar/tabs (sourced directly from the
frontend's role-gating code, so this table can't drift from reality):

| Area | ADMIN | BOROSIL_ADMIN | LAB_INCHARGE | ANALYST | AUDITOR | SUPPORT |
|---|---|---|---|---|---|---|
| Dashboard / Processes / Alarms / Notifications (base view) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Devices** sidebar link | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Admin** sidebar link (Tenancy/Licence/Backups/Health tabs) | ✅ | ✅ (Licence tab read-only, no upload/deactivate) | ❌ | ❌ | ❌ | ❌ |
| Processes → **New process** button | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ |
| Alarms & Overrides → **Alert catalog** tab | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Data actually visible (dashboard cards, reactor detail, alarms) | all labs | none (structurally — see below) | QC Lab 1 only | QC Lab 1 only | none | none |

**Try this for each role:** log out, log back in as each username above, and
confirm:
1. The sidebar matches the table (e.g. `lab_incharge1` sees no **Devices** or
   **Admin** link at all, not just a disabled one).
2. `lab_incharge1`/`analyst1` see the Dashboard populated with QC Lab 1 /
   Reactor 25's data (assuming a simulator or real device is streaming —
   see §3) — this proves the lab-scope grant actually works, not just that
   login succeeds.
3. `auditor1`/`support1` see an **empty** Dashboard (no reactor cards) even
   though data exists for QC Lab 1 — this proves the *absence* of a lab
   scope correctly blocks visibility, enforced by Postgres row-level
   security (`user_lab_scope` table), not just a client-side filter.
4. `borosil_admin` sees the **Admin** link (for the Licence tab only — the
   Tenancy/Backups/Health tabs render but are scoped to show nothing
   meaningful for this role) but never **Devices**, and if you inspect the
   Dashboard/Processes/Alarms pages they are empty — Borosil Admin has
   *zero* visibility into any client's operational data, by design (see
   `licence-management-guide.md` §0/§4 for exactly why).

**Known gap, not a bug:** there is currently no Admin-UI/API way to grant a
`user_lab_scope` row — the `lab_incharge1`/`analyst1` grants above were
inserted directly via SQL (`docker exec ... psql -c "INSERT INTO
user_lab_scope ..."`). If you create a *new* Lab In-charge/Analyst user via
Admin → Users → Create user, they will correctly see **nothing** until a
lab-scope row is added the same way — this is an acknowledged backend gap,
not something wrong with your test.

---

## 3. Simulating real device data (optional, for a fuller test)

The frontend has nothing to show on the Dashboard/Reactor Detail/Alarms
pages unless some device is actually streaming data. To generate real
traffic without physical hardware:

```
cd tools/device-simulator
npm install        # first time only
$env:DEVICE_ID = "<uuid of a claimed+bound device>"
npx ts-node simulate.ts
```
Find a device's UUID yourself: on the **Devices** page, open your browser's
DevTools (F12) → **Network** tab, refresh the page, click the request named
`devices`, and look at the **Response** — each device object has an `id`
field (a long UUID) next to its `serialNo`. Copy the `id` for the device you
want to simulate (pick one that's already bound to a reactor, e.g. via its
History panel, so its data actually shows up somewhere). Run the simulator
with that UUID, then flip back to the browser —
within a few seconds the Dashboard card and Reactor Detail chart for that
reactor should update with the values the simulator sent.

Add `--gap` to the command to deliberately create a data gap (useful for
confirming gap-detection shows up correctly in backend data, though there's
no dedicated frontend view for gaps yet — Admin-only via
`GET /devices/:id/gaps` directly).

---

## 4. Known non-issues (don't report these as bugs)

- **Licence "device limit reached" error when claiming a new device** — if
  you're at the licence's device cap, this is correct enforcement, not a bug.
  Check Admin → Licence for the current `maxDevices`.
- **Browser console shows an orange "antd: List... use Listy instead"
  warning** on the Notifications page — cosmetic deprecation notice from the
  UI library, doesn't affect functionality, left alone intentionally (see
  project notes).
- **Vite terminal shows periodic `ws proxy error: write ECONNABORTED` /
  `socket hang up` lines** while the dev server is running — this is the
  dev server's hot-reload WebSocket timing out on idle, not the app's
  real-time notification socket (that one's a separate connection and is
  unaffected). Harmless.
- **Laboratory creation needs a pasted Site UUID**, not a dropdown — this is
  a known rough edge in the current build, not broken.

## 5. If something looks genuinely wrong

When reporting an issue, the most useful report includes:
1. Which page/tab you were on (the URL shown in the browser bar).
2. What button/action you took.
3. What you expected vs. what actually happened (exact error text if a red
   toast appeared).
4. Open the browser's DevTools (F12) → Console tab → copy any red error
   lines (ignore the orange warnings listed in §4).
5. If relevant, check `docker compose logs app --tail=50` in the project
   root around the same time for a matching backend-side error.
