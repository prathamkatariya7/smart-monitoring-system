# RMP frontend

React/Vite operations dashboard for the Reactor Monitoring Platform. The frontend is a typed client of the NestJS backend and is not the source of authorization or process truth.

See [`../docs/frontend.md`](../docs/frontend.md) for component ownership, realtime behavior and UI standards.

```bash
npm ci
npm run dev
npm run typecheck
npm run lint -- --max-warnings=0
npm run build
```

Never put customer secrets, API tokens or certificates in frontend source or build artifacts.
