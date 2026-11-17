# 2026-11-17 — documentation and repository cleanup

The active documentation set was reorganized into current architecture, backend, frontend, firmware, HMI, deployment, testing, security, operations and GxP validation guides. Superseded architecture and 240×320 HMI documents were moved into explicitly named archive directories rather than being presented as current instructions.

A dedicated `docs/change-log/` folder was added for chronological traceability. Generated dependencies, ESP-IDF build trees, downloaded managed components and local frontend/backend build output were removed from the working tree; they remain reproducible from lockfiles and toolchain instructions.
