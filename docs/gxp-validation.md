# Pharmaceutical validation and release evidence

This project supports regulated pharmaceutical customers, but software build success alone is not a GxP release. Each customer must define the applicable GxP, data-integrity, electronic-record, retention and validation requirements.

## Required evidence

Maintain approved requirements, risk assessment, architecture and traceability; reviewed source commit and dependency lockfiles; database migration record; firmware and HMI artifact hashes; installation/configuration record; IQ/OQ/PQ or equivalent validation protocols; test execution evidence; deviation/CAPA records; backup/restore evidence; access review; change-control approval; and release sign-off.

## Data integrity controls

Verify attributable, legible, contemporaneous, original and accurate records. Confirm immutable or controlled audit history, reliable time synchronization, role segregation, electronic signatures where required, controlled corrections, retention and retrieval. Motor identity history must remain traceable across replacement and must not be silently overwritten.

## Hardware qualification

Qualify the actual ESP32 control box, RS-232 level shifter and cable, IKA and Heidolph models, RTD chain, DWIN panel, buttons, power behavior and network path. Test normal, absent, disconnected, swapped, malformed-response, reboot and communication-loss conditions.

## Release decision

Do not label a deployment production-qualified until the customer-approved validation package, real hardware tests, backup restore, security review and operational training are complete. Record all open limitations explicitly in the release record.
