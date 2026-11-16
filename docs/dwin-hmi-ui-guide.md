# Reactor Monitoring Platform — DWIN HMI UI Guide

**Audience:** the team building the on-device DWIN touchscreen UI (DWIN T5L
series or similar, driven over UART from the ESP32-P4/C6 control box).
**Status: this is a *proposed reference spec*, not an already-built design.**
No DWIN screen layout exists today — `device.dwin_project_ver` is tracked by
the backend purely as a version string for whatever the HMI team ships; the
backend has no opinion on pixel layout, fonts, or navigation chrome. This
document exists to answer two questions for you: **what data is available to
show**, and **what should happen when someone touches the screen** — the
actual visual design, screen count, and navigation flow are yours to decide.

Read [`firmware-integration-guide.md`](./firmware-integration-guide.md) first —
everything here assumes you already know the MQTT topic/payload contract. This
document only adds the *display and interaction* layer on top of it.

---

## 1. Division of responsibility: HMI vs. web app

This is the most important decision this document makes, because it affects
what the HMI firmware needs to implement at all:

- **The HMI is a local status/monitoring surface, not a second control
  plane.** All *authoritative* actions — process creation, start/pause/
  abort, alarm override with a reason code, calibration approval, licence
  and tenancy admin — happen in the web app, where they're attributed to a
  logged-in analyst/admin and go through the audit trail (Part 13) and the
  policy-pack rules (override limits, dual-approval, etc.). The HMI has no
  concept of "who is touching the screen" the way the web app has a JWT
  session, so it cannot safely perform attributed actions.
- **What the HMI *should* do locally:** display live values, display
  active alarms and their severity, let an operator **silence the local
  buzzer/visual flash** for an active alarm (a device-local UX action, not
  a server-attributed override — see §4.2), and show connection/claim/
  binding health so an operator standing at the reactor knows *why* nothing
  is updating if something's wrong.
- **What the HMI should NOT try to do:** accept an override reason code,
  approve/reject a calibration, start or abort a process, or do anything
  else that the spec requires an attributed analyst/admin action for. If a
  requirement later needs the HMI to do one of these, it needs its own
  design discussion (local login? PIN entry via the DWIN touch keypad?) —
  don't improvise an unattributed shortcut.

This split keeps firmware simple (no local auth, no policy-pack logic to
duplicate) and keeps every attributed action in one place (the audit chain).

---

## 2. Data dictionary — what must be shown

Everything below is already available to the firmware either from data it
collects itself, or from the server via `cfg/desired` / `ack/cmd` (see the
firmware guide for the exact JSON). Nothing here requires a new backend
endpoint.

### 2.1 Connection & identity status
| Field | Source | Notes |
|---|---|---|
| Network link | firmware-local (`eth`/`wifi`/`none`) | Same value sent in `state.link` |
| MQTT connected? | firmware-local | Whether the mTLS session is currently up |
| `deviceId` | provisioned at claim time | Show truncated/last-6 for operator sanity-check, not the full UUID |
| Claimed & bound? | known from whether `cfg/desired.binding` is non-`null` | **If `binding` is `null`, telemetry is being silently dropped server-side** — this is the single most important status to surface clearly, since it's the #1 "why isn't anything updating" cause (see firmware guide §7) |
| Reactor number / lab name | `cfg/desired.binding.reactorNumber` / `cfg/desired.laboratoryName` | Human-readable identity once bound |
| Clock sync status | firmware-local (`tsync` you're currently sending) | Show plainly if unsynced — operator should know measurements are being timestamped at server-receipt time, not device time |

### 2.2 Live telemetry (per channel, whatever the device actually has)
| Field | Source | Notes |
|---|---|---|
| Temperature (corrected) | `t` column you send | Primary number, large/prominent |
| Temperature (raw) | `t_raw` | Secondary/smaller, useful during calibration checks |
| RPM | `rpm` | — |
| Torque | `tq` | — |
| Per-channel quality | `q` string (`G`/`S`/`B` per channel) | Suggest: green/amber/red dot next to each value — **a `B` (bad) channel should visually dominate**, since it means "don't trust this number" |
| Fault code | `flt` | Device-defined meaning — show as a raw code is fine; you decide if/how to translate it to text |

### 2.3 Process / batch context (read-only on the HMI)
| Field | Source | Notes |
|---|---|---|
| Active attempt? | whatever the device was told via config/command, if anything | Today the backend doesn't push the full process record to the device — only an `attempt` UUID is accepted *from* the device in `tele/batch` if the device happens to know it. Treat "is a batch running" as **informational only** unless/until the server starts pushing attempt state down; don't build HMI logic that assumes it always knows the current process status. |
| Process attempt states (for reference, if ever surfaced) | `PENDING`, `RUNNING`, `PAUSED`, `AWAITING_COMPLETION`, `COMPLETED`, `ABORTED` | These are the only values that will ever appear if this data is added later |

### 2.4 Alarms (read-only on the HMI, see §4.2 for the one allowed local action)
| Field | Source | Notes |
|---|---|---|
| Active alarm(s) | server pushes nothing to the device for this today — see **open question** in §5 | The backend raises alarms server-side from the same threshold data the device already sends; it does not currently push an "alarm active" signal back down to the device over MQTT. **If the HMI needs to show "alarm active" locally, the simplest correct approach is for the device to evaluate the same thresholds it already has (once `cfg/desired.thresholds` is populated — currently always `null`, see firmware guide Known Gaps) rather than waiting on a new server→device alarm topic.** Flag this to the backend team if local alarm display becomes a hard requirement — it may need a small new topic. |
| Alarm severity | `alert_catalog.class`: `INFO` \| `WARNING` \| `CRITICAL` | All alarms raised by the server today are `WARNING` (CRITICAL classification isn't wired up yet) — don't design a layout that *only* shows CRITICAL as alarming; WARNING is the real-world case right now. |

### 2.5 Calibration (read-only on the HMI)
| Field | Source | Notes |
|---|---|---|
| Calibration version applied | `cal` field you already send in `tele/batch` | Just echo back what the device itself applied |
| Pending calibration command | `cmd/set_calibration` you receive | Show "calibration update received" briefly when one arrives and is applied — the ack you send (`ack/cmd`) is what actually confirms it server-side |

---

## 3. Suggested screen set (a starting point, not a mandate)

A reasonable minimal set, in rough priority order:

1. **Home / live status** — big numbers for the primary channel(s), quality
   dots, connection status badge, reactor identity.
2. **Alarm screen** — shown automatically when an alarm condition is
   active (however you end up detecting it, see §2.4); silence button
   lives here (§4.2).
3. **Network & binding screen** — link type, MQTT connection, claimed/
   bound status, `deviceId` (truncated) — the "why is nothing updating"
   diagnostic screen.
4. **About / firmware & calibration screen** — firmware version, DWIN
   project version, applied calibration version. Useful for field support
   calls without needing a laptop.

Navigation chrome (tabs, swipe, physical buttons if your DWIN variant has
them) is entirely your call.

---

## 4. Interaction → MQTT contract mapping

### 4.1 General rule
Any interaction that needs to be **attributed to a person** (override,
process control, calibration approval) is out of scope for the HMI — see
§1. The table below is therefore short on purpose.

### 4.2 The one local action: silence/acknowledge locally
- **What it is:** stop the local buzzer/visual flash for an alarm the
  operator has seen, *at this physical device only*.
- **What it must NOT be confused with:** the web app's "override" flow
  (`ALERT_SOUND_OVERRIDDEN`, Part 6.5), which requires a reason code, is
  attributed to a logged-in analyst, is time-bounded (`plannedExpiry`), and
  is subject to the policy pack's override limits (Flexible/Standard/
  Regulated) and the "3 overrides in 1 hour" repeated-override notice.
- **Recommended implementation:** this is a **local-only UI state**, not an
  MQTT message. Don't invent a new topic to tell the server "I silenced the
  buzzer" — the server has no use for that information today, and sending
  it risks being misread later as equivalent to a real override (it is
  not, and must never be treated as one for compliance purposes). If a
  future requirement needs the server to know a local silence happened,
  that's a deliberate new design decision for the backend team, not
  something to improvise in firmware.

### 4.3 Everything else firmware already does
Every other device→server interaction (publishing `state`/`tele/batch`/
`event`, replying to `cmd/{name}` with `ack/cmd`) is already fully
specified in the firmware guide and is unchanged by anything in this
document — the HMI only *displays* that data, it doesn't change what gets
sent.

---

## 5. Open questions (for the HMI team + backend team to resolve together, not assumed here)

1. **Does the HMI need the server to push "alarm active" explicitly?**
   Today the server doesn't tell the device about alarms it raises — see
   §2.4. If local-only threshold evaluation (once `cfg/desired.thresholds`
   is populated) isn't acceptable, a new `alarm/active` server→device topic
   would need to be designed and added to the firmware guide.
2. **Does the HMI need live process/attempt status** (not just an
   `attempt` UUID it already happens to know)? If yes, `cfg/desired` or a
   new topic would need to start carrying it — not available today.
3. **PIN/local-login for HMI-side actions** — out of scope for this
   version entirely; raise it explicitly if a future requirement needs an
   attributed action performed at the device rather than the web app.

Until these are answered, build the HMI against §2–§4 only — everything
there is backed by data the firmware already has or already receives.
