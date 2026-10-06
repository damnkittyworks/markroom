# Known issues and release boundaries

Updated 2026-10-05. Markroom is an early self-hosted release. These are outstanding limitations, not completed features or promises of a fix date.

## Dependencies and distributed assets

- The recorded npm audit has **28 affected package entries: 21 high, 6 moderate, 1 low, and no critical**. These include inherited/tooling findings and are not 28 distinct demonstrated application exploits. See [the dependency review and reproducible snapshot](docs/dependency-review.md) for the inspected paths and remaining work.
- Official prebuilt releases and public browser deployments are gated on native PDFium attribution. The build preserves the upstream licenses, asset identity, and package inventory, but the npm artifact does not supply an exhaustive native component/build manifest. Obtain the exact native-library/font manifest and required notices before distributing those binaries. This is a provenance gap, not evidence of an incompatible license. See [third-party notices](THIRD_PARTY_NOTICES.md). Generated viewer assets are excluded from the source repository.

## Collaboration and PDF compatibility

- Synchronization is manual through **Check for updates**. Concurrent edits can conflict; inspect the result before proceeding.
- Stamps, signatures, attachments, redaction, and form editing are disabled pending separate round-trip checks. The supported annotations still need broader testing across PDF editors and document types.
- Two-browser checks verified persistence, closing, save-failure recovery, and export. Independent inspection of synthetic exported PDFs confirmed native comments, reply linkage, UTC timestamps, and editable flags. This is not a full Acrobat compatibility certification.
- Invalid historical annotation records are isolated to keep the viewer usable, but export is blocked until the records are repaired. The application will not silently omit them.

## Hosting and data lifecycle

- A room link grants read access to the PDF, names, and comments. Closing the review freezes writes; it does not revoke read access.
- Edit capabilities live in browser storage. There is no account-based recovery, share-link rotation, or read-access revocation workflow.
- Creation keys, persistent write-rate limits, global room/PDF/annotation budgets, and operator takedown are available. Operators must configure secrets, review budgets, and provide edge traffic controls; see [hosting controls](docs/hosting-controls.md).
- There is no automated expiry, owner-facing deletion, or managed backup/restore. Operator takedown deletes application D1/R2 records; operators still own logs, backups, and downloaded copies.
- The server enforces the streamed 100 MB byte limit and PDF signature. It bounds the submitted page-count value; only the browser parses the 1–1,000 page count. This does not sanitize uploaded PDFs.

## Upgrade checks

Use the [two-browser acceptance check](README.md#two-browser-acceptance-check) after framework/viewer upgrades. Back up existing installations before migrations. Older installations that auto-created tables without migration tracking need the guarded [schema adoption procedure](docs/schema-upgrades.md), rather than replaying the initial CREATE TABLE migrations. Requests no longer create schema.
