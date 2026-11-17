# Frontend guide

The React/Vite dashboard is a client of the backend, not a second source of business truth. It renders server responses, handles loading/error/empty states and uses Socket.IO only for authorized freshness updates.

## Structure

- `src/api/` — typed client, request contracts and domain types.
- `src/auth/` and `src/store/` — login/session state.
- `src/realtime/` — socket provider and cache refresh behavior.
- `src/pages/` — domain pages such as reactors, devices, processes and calibrations.
- `src/components/` — reusable layout, feedback and error-boundary components.

## Device and motor display

The Devices page shows current manufacturer, model and protocol. A blank identity means no motor is currently detected; it must not be shown as a valid zero RPM/torque measurement. Historical identity auditing is a backend concern.

## UI standards

Every API view must have loading, empty, error and stale/disconnected states. Navigation must enforce protected routes. Avoid render-time side effects and direct `Date.now()` calls for state decisions; use stable hooks or query timestamps. Do not use `any` for API or realtime payloads.

## Verification

```bash
npm ci
npm run typecheck
npm run lint -- --max-warnings=0
npm run build
```

The current production build has a non-failing large-main-chunk warning. Route-level code splitting is a planned optimization and must not be confused with a correctness failure.
