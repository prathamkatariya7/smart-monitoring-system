# Reactor Monitoring Platform — Licence Management Guide

**Audience:** Borosil staff who administer client licences and provide
support (issuing a new client's licence, changing an existing client's
terms, deactivating one, or resetting a locked-out client Admin's password).
**Covers:** the offline, signed-licence model (Part 9.9), the **Borosil
Admin** role that exclusively controls it, and exactly what each action
does and does not affect. This applies identically to every client
deployment regardless of size — a 3-device solo install and a 40-device
team install like Sai Life Sciences follow the exact same model.

---

## 0. Roles: who can do what

Every deployment has exactly two admin-tier roles, seeded the same way
regardless of client size:

| | **Borosil Admin** (`BOROSIL_ADMIN`) | **Admin** (`ADMIN`, client-side) |
|---|---|---|
| Licence: view status | Yes | Yes (read-only) |
| Licence: activate/change/deactivate | Yes -- exclusively | No |
| Reset any user's password | Yes, including other Admins | Yes, for their own users only -- never a Borosil Admin account |
| Create users | Yes | Yes |
| Tenancy, devices, processes, alarms, backups, health | No visibility at all | Yes, full control |

The Borosil Admin account is deliberately scoped to **licence control +
support (password resets)** only. It has no row-level-security bypass and
no laboratory scope, so it structurally cannot read a client's operational
data (reactors, processes, alarms, measurements) -- this is enforced by
Postgres RLS, not just hidden in the UI.

**No cross-site portal.** Each client's deployment is fully local and
independent -- there is no centralized dashboard listing every client from
one place, and nothing phones home. When a client needs licence or account
support, they contact Borosil directly; a Borosil IT person remotes into
that one client's machine (e.g. AnyDesk, UltraViewer, or on-site) and logs
into the Borosil Admin account already seeded in that deployment.

## 1. How licensing works (read this before doing anything)

- **Offline, signed, no phone-home.** A licence is a small JSON file
  (`{payload, signature}`) signed with an RSA-2048 private key. The server
  only ships the **public** key (`backend/licence/public_key.pem`) and
  verifies the signature on load — there is no internet call, no licence
  server, nothing to "activate online."
- **The private key must never be deployed.** It lives at
  `tools/licence-tools/dev-private-key.pem` in this repo (dev) — for a real
  client rollout, this key should be held by Borosil, not shipped inside
  any device or server image. Anyone with the private key can issue a
  licence for any organisation/device count/term, so protect it like a
  credential.
- **A licence controls one thing: whether new devices can be claimed.**
  Specifically:
  - `maxDevices` + a **10% grace margin** (`floor(maxDevices * 1.1)`) is
    the ceiling on claimed devices.
  - `supportTermEnd` is the date after which claiming new devices is
    blocked, until renewed.
  - **None of this ever blocks already-collected data, viewing dashboards,
    or exporting CSVs** — even with an expired or missing licence, existing
    devices keep reporting and existing data stays fully accessible. Only
    *new device claims* are gated.
- **The licence payload shape:**
  ```json
  {
    "organisation": "Client Name",
    "edition": "solo" | "team" | "enterprise",
    "maxDevices": 40,
    "supportTermEnd": "2027-11-07",
    "featureFlags": {},
    "issuedAt": "2026-11-08T19:40:28.029Z"
  }
  ```

---

## 2. First-time deployment: onboarding a new client

1. Borosil runs the seed script once on the client's newly-deployed
   system (`npm run seed` inside the `app` container, or
   `SEED_BOROSIL_ADMIN_USERNAME`/`SEED_BOROSIL_ADMIN_PASSWORD` env vars to
   set a specific bootstrap password). This creates the client/
   organisation row, the full role catalog, and **one Borosil Admin
   user** -- no client Admin exists yet.
2. Log in as that Borosil Admin account → **Admin → Users → Create
   user** → create the client's own `ADMIN` account (name, username,
   password, role `ADMIN`). Hand those credentials to the client.
3. From then on, the client's Admin manages their own tenancy, devices,
   users, backups, and health. They can see their licence status
   read-only; only Borosil's account can change it. If the client's Admin
   is ever locked out, they call Borosil, who logs into the Borosil Admin
   account and resets the password (§8).

This exact sequence is identical whether the client has 3 devices or 400 --
nothing about it varies by edition or scale.

## 3. Issuing a licence for a client

Use `tools/licence-tools/issue-licence.js` (requires Node and the dev
private key — do this on a machine Borosil controls, not at the client site):

```
cd tools/licence-tools
node issue-licence.js "<Client Organisation>" <edition> <maxDevices> <supportTermEndISO>

# Example:
node issue-licence.js "Sai Life Sciences" team 40 2027-11-07
```

This writes `tools/licence-tools/licence.json` — a signed, ready-to-upload
licence file. `edition` is currently informational (`solo`/`team`/
`enterprise` — no backend behaviour differs by edition today beyond what's
in `featureFlags`, which is empty by default).

If `dev-private-key.pem` doesn't exist yet (e.g. a fresh clone), generate
the keypair first — **but only once ever**, and keep the private key safe
afterward:
```
node generate-keypair.js
```
Re-running this would invalidate every licence ever issued with the old
key (the server's baked-in public key wouldn't match), so don't do this
casually on an existing deployment.

---

## 4. Activating a licence (first install, or installing a freshly-issued one)

### Via the Admin UI (recommended)
1. Log in as the **Borosil Admin** account for that deployment →
   **Admin → Licence** tab. (A client's own `ADMIN` account sees this
   tab read-only, with no upload/deactivate controls.)
2. Click **Upload new licence**.
3. Paste the full contents of the issued `licence.json` file.
4. Click **OK**.

The page immediately reflects the new status (`Installed: Yes`,
`Organisation`, `Edition`, `Max devices`, `Support term end`) — no restart
needed.

### Via the API directly
```
POST /api/v1/system/licence
Authorization: Bearer <borosil admin JWT>
Content-Type: application/json

{ "payload": { ... }, "signature": "..." }
```
(The whole `licence.json` file's contents, as-is, is the request body.)
Response is the full licence status object. A signature that doesn't
verify against the server's baked-in public key is rejected with 400 —
this is the one case where "activation" can fail: you issued the licence
with a different private key than the one the server's public key
corresponds to.

---

## 5. Changing an existing client's licence terms

There is no separate "edit" action — **re-issue and re-upload** (Borosil
Admin only, same as activation):

1. Issue a new licence with the updated terms (new `maxDevices`, new
   `supportTermEnd`, different `edition`, etc.) — same command as §3.
2. Upload it the same way as §4 (Admin UI or API, logged in as the
   Borosil Admin account).

The new licence file **replaces** the old one outright (the upload
endpoint overwrites `backend/licence/licence.json`). There is no history
kept by the licence module itself — if you need an audit trail of licence
changes over time, that's already covered separately: every upload and
deactivation writes a `LICENCE_UPDATED` / `LICENCE_DEACTIVATED` row to the
audit log (`audit_record` table), which **is** permanently kept and
hash-chain verified.

**Common "change" scenarios:**
- *Client wants more devices* → re-issue with a higher `maxDevices`, upload.
- *Client renews their support contract* → re-issue with a later
  `supportTermEnd`, upload. (Do this *before* the old term expires if you
  want zero interruption — see §7 for what happens if it lapses first.)
- *Client downgrades/upgrades edition* → re-issue with the new `edition`
  string, upload. (No functional difference today beyond the label and
  whatever you put in `featureFlags`.)

---

## 6. Deactivating a licence

Use this when a client's engagement ends, a licence was issued in error,
or you need to force "no active licence" state for any other reason —
without waiting for a term to expire naturally. **Borosil Admin only** —
a client's own Admin cannot do this (and won't see the button).

### Via the Admin UI (recommended)
1. Log in as the Borosil Admin account → **Admin → Licence** tab →
   click **Deactivate licence** (only shown when a licence is currently
   installed).
2. Confirm in the dialog — this is destructive (removes the licence file).
3. Status immediately flips to `Installed: No`.

### Via the API directly
```
DELETE /api/v1/system/licence
Authorization: Bearer <borosil admin JWT>
```
Returns the updated (now "not installed") status.

**What deactivation does and does not do:**
- ✅ Blocks claiming any *new* devices from that point on (same effect as
  an expired term).
- ✅ Audit-logged (`LICENCE_DEACTIVATED`), with the previous payload kept
  in the audit record's `previous_value` for a historical record of what
  was removed.
- ❌ Does **not** touch any already-claimed device, its data, or any
  dashboard/export access for existing data. Everything a client already
  has keeps working exactly as before.
- **Reversible**: uploading any valid signed licence again (§4) restores
  full functionality immediately — deactivation only removes the file, it
  doesn't blacklist the organisation or leave any other trace that would
  prevent re-activation.

---

## 7. What happens when a licence term simply expires (no action taken)

Same effect as deactivation, automatically, with no admin action needed:
- `GET /api/v1/system/licence` (and the Admin UI, for both roles) will
  show `Expired: Expired`.
- New device claims are blocked (`canClaimDevice()` checks `isExpired()`
  unconditionally, regardless of remaining device-count headroom).
- All existing data access is unaffected, exactly as in §6.

To resolve: Borosil issues a fresh licence with a later `supportTermEnd`
(§5) and uploads it — no need to deactivate first.

---

## 8. Support: resetting a locked-out client Admin's password

If a client's own `ADMIN` account is locked out (forgotten password, too
many failed attempts), the client contacts Borosil. A Borosil IT person
remotes into that client's deployment (§0) and resets it:

### Via the Admin UI
1. Log in as the Borosil Admin account → **Admin → Users** tab.
2. Find the client's Admin row → click **Reset password**.
3. Enter a new password → **OK**. The account is also automatically
   unlocked (failed-login counter and any lockout cleared).
4. Give the new password to the client; have them change it after login.

### Via the API directly
```
POST /api/v1/auth/users/<userId>/reset-password
Authorization: Bearer <borosil admin JWT>
Content-Type: application/json

{ "newPassword": "..." }
```

A client's own `ADMIN` account can reset passwords for their *own* users
(Lab In-charges, Analysts, etc.) the same way, for routine day-to-day
support — but will get a 403 if they try to reset a `BOROSIL_ADMIN`
account's password, so a client can never lock Borosil out of their own
support account.

---

## 9. Quick reference

| I want to... | Do this |
|---|---|
| Onboard a brand-new client | §2 (seed Borosil Admin → create client Admin) |
| Set up that client's licence | §3 (issue) → §4 (activate) |
| Give an existing client more devices or more time | §5 (re-issue + re-upload) |
| Temporarily or permanently shut off a client's ability to add devices | §6 (deactivate) |
| Resume after deactivating | §4 (upload any valid licence again) |
| Check current licence status | Admin → Licence tab (both roles), or `GET /api/v1/system/licence` (`ADMIN` or `BOROSIL_ADMIN` only) |
| Reset a locked-out client Admin's password | §8 (Borosil Admin only) |
| See a history of licence/user changes | Query `audit_record` where `action IN ('LICENCE_UPDATED', 'LICENCE_DEACTIVATED', 'USER_CREATED', 'PASSWORD_RESET')` |

---

## 10. Re-verified end-to-end (2026-11-10)

Issue (§3) → activate (§4) → deactivate (§6, confirmed `installed:false`) →
re-issue and restore the original terms (§5) — all via real API calls
against this dev deployment, not mocked. Still works exactly as documented
above; no drift found since the 2026-11-08 test matrix ([[licence-testing]]
memory, if you have access to it).

**One operational note, not a licence-module bug**: the seeded
`borosil_admin` bootstrap account's password had drifted from the
documented default (`ChangeMe123!`) at some point in an earlier session —
login failed with "Invalid credentials" until the password was reset
directly in the database (there being no second Borosil Admin account
available to use the normal §8 reset flow on it). If you ever find yourself
locked out of the *only* Borosil Admin account with no second one to reset
it, this is the fallback: compute a fresh Argon2id hash with the app
container's own `argon2` library and `UPDATE app_user SET password_hash =
...` directly — exactly as the backend's own `AuthService.hashPassword()`
would, just run manually since there's no "reset my own account" self-
service path for this role by design.
