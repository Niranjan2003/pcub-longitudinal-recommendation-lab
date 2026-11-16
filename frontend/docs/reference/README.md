# Reference snapshot (10 November 2026)

Read-only copies of the backend documentation that the frontend was designed against. They are reference material, not editable contracts. Where they disagree with the running backend, the backend source and [`../OBSERVED_CONTRACT_NOTES.md`](../OBSERVED_CONTRACT_NOTES.md) take precedence.

- `MASTER_SYSTEM_REPORT.md`: authoritative explanation of the implemented research system and its limits. Same content as [`backend/docs/MASTER_SYSTEM_REPORT.md`](../../../backend/docs/MASTER_SYSTEM_REPORT.md), apart from line endings.
- `CODE_ARCHITECTURE_REFERENCE.md`: source-level audit of the backend, about 7,000 lines. Sections 1–12 and 14 give the overview, and section 14 contains important qualifications. Same content as [`backend/docs/CODE_ARCHITECTURE_REFERENCE.md`](../../../backend/docs/CODE_ARCHITECTURE_REFERENCE.md), apart from line endings.
- `API_CONTRACT.md`: archived contract of the nine `/v1` endpoints, with a PowerShell walkthrough. Where it conflicts with the running server, the current backend source is authoritative.

This folder contains no model or recipe data, runtime database, provider journal, test-evidence bundle or executable backend code. The project proposal, historical audits and the archived reconstruction manual are not included. None of them is needed to build, run or interpret the current system.

**Provenance.** The snapshot's original SHA-256 list (`SHA256.txt` at frontend commit `989acf6`) recorded the bytes of these files with CRLF line endings, while Git stores them with LF. That list is preserved in the repository's [`SOURCE_IDENTITY.json`](../../../SOURCE_IDENTITY.json) under `frontend.reference_snapshot`, and [`scripts/verify_publication.py`](../../../scripts/verify_publication.py) checks every entry against these files.
