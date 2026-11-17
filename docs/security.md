# Security controls

- Production requires explicit CORS origins and strong JWT secrets.
- DTO validation rejects unknown fields; global throttling and request-size limits are enabled.
- Device auto-registration is disabled unless explicitly enabled in non-production development mode.
- MQTT production uses authenticated device identity and TLS/mTLS; state topics are not a trust boundary by themselves.
- Tenant, laboratory and role scope is enforced server-side.
- Secrets, certificates, licence files, local environments, dependency trees and generated build output are ignored.
- Audit records and motor identity history are retained for traceability and must not be edited through normal UI workflows.

Before release, complete a dependency vulnerability review, refresh-token/session hardening review, certificate rotation drill, backup restore drill and penetration/security assessment.
