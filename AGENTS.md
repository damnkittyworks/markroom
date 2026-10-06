# Working on Markroom

Keep the product focused on shared PDF review. Preserve the source PDF, editable
annotation export, other reviewers' authorship, and historical data on upgrades.

- Use `npm ci`, `npx tsc --noEmit`, `npm run lint`, and `npm test`.
- Apply migrations to a fresh local database and test the upgrade path for schema
  changes. Requests must never create or repair database schema.
- Verify viewer changes in two independent browser sessions, including refresh,
  replies, closing, failed saves, and exported PDF annotations.
- Keep write authorization, revision, lifecycle, and quota checks in atomic writes.
- Creation and operator keys are server secrets. Never put them in URLs, browser
  persistence, source control, screenshots, or logs. Use synthetic local fixtures.
- Do not deploy, mutate live data, or publish security patches without explicit
  authorization. Local development and tests must not invoke deployment commands.
- Follow SECURITY.md. Do not publish exploit instructions, private room links,
  tokens, or PDFs in issues or PR descriptions. Neutral titles do not hide diffs.
- Preserve AGPL-3.0-only application licensing, file-specific MIT exceptions, all
  third-party notices, and the documented native PDFium distribution gate.
- State what was verified and what remains uncertain. Parsing is not sanitization.
