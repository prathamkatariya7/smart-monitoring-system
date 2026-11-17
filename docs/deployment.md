# Deployment guide

## Development

Copy `backend/.env.example` to a local untracked `backend/.env`, set database/MQTT/JWT values and run the backend/frontend with their package scripts. For a complete stack, use the root Compose file after reviewing its volumes and secrets.

```bash
docker compose up -d --build
docker compose ps
```

Never use development auto-registration or plain PostgreSQL fallback in production.

## Production-like checklist

1. Use PostgreSQL/TimescaleDB with encrypted storage and a dedicated least-privilege application role.
2. Configure Mosquitto with real CA, broker and device certificates; do not use repository certificates.
3. Set strong unique JWT secrets, explicit CORS origins, request limits and licence configuration.
4. Run migrations as a controlled release step and verify backup/restore before enabling ingestion.
5. Serve the frontend and API behind HTTPS with a documented DNS/certificate owner.
6. Configure monitoring for API health, MQTT connection, database latency, disk, backups and licence state.
7. Seed or provision only through the approved commissioning workflow.
8. Record release commit, migration state, firmware image hash, HMI package hash and validation evidence.

## Rollback

Stop new device ingestion if schema or firmware compatibility is uncertain. Preserve logs and database backups, roll back the application image only when migrations are backward-compatible, and never delete audit or motor identity history to repair a deployment.
