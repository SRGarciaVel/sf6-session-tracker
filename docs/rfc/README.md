# RFCs

Design proposals for changes that cross module boundaries, touch the data model or change what
the project is. An RFC is a decision record **before** implementation: it does not change code.

| #                                       | Title                                     | Status | Date       |
| --------------------------------------- | ----------------------------------------- | ------ | ---------- |
| [0001](0001-sst-open-core-multigame.md) | SST: open core, cloud and multi-game path | Draft  | 2026-10-05 |

**Process**

1. Open a PR adding `docs/rfc/NNNN-short-title.md` with status **Draft**.
2. Discuss in the PR. Decisions are marked **ACCEPT NOW**, **REVIEW** or **DEFER**.
3. On merge, the status becomes **Accepted** (or **Partially accepted**, listing which decisions).
   Implementation happens in separate PRs that link back to the RFC and its phase.
4. A later RFC can supersede an earlier one; keep the old file and mark it **Superseded by NNNN**.
