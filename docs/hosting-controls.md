# Hosting controls

Room creation is disabled until an operator configures a **32–256 character
creation key**. Share this key only with trusted creators. Reviewers still use
room links. A creation key is not an account, malware scanner, or proof of identity.

## Configuration

Generate independent random secrets (at least 32 random bytes, encoded as hex or
base64) for `MARKROOM_CREATION_KEY`, `MARKROOM_OPERATOR_KEY`, and
`MARKROOM_RATE_SALT`. Keep them in your secret manager. Configure the first two
only for the capabilities you want enabled. A rate salt is needed for joins and
writes when no other key is configured. Keep it stable across key rotation.

For local development, put these variables in a private `.dev.vars` file beside
the selected Wrangler configuration. For the built preview that is
`dist/server/.dev.vars`; recreate it after rebuilding. `.dev.vars*` is ignored by
Git. Never put production keys in command arguments or the repository.

For deployment, use Wrangler's interactive `secret put VARIABLE_NAME --config
.env.wrangler.jsonc` for each secret. These are operator actions, not build steps.
The creation form sends its key in a request header and does not save it in
browser storage. Operator keys never belong in the browser. HTTPS is required
outside local development. Do not log request bodies or authorization headers.

Changing or removing the creation key controls **new uploads only**. Existing room
links remain readable until operator takedown. Closing a review freezes edits.

## Default limits

| Resource | Limit |
| --- | --- |
| Completed rooms plus pending uploads | 20 |
| Original PDFs plus pending uploads | 512 MiB |
| One original PDF | 100 MiB |
| Annotation JSON in one room | 4 MiB |
| Annotation JSON across the installation | 64 MiB |
| Active annotation IDs per room | 5,000 |
| Retained IDs including deletion records per room | 10,000 |
| Participants per room, including creator | 100 |
| Creation attempts with a valid key per IP | 10/hour |
| Join attempts per room/IP | 10/minute |
| Annotation writes per room/IP | 120/minute |

Optional server variables `MARKROOM_MAX_ROOMS` and `MARKROOM_MAX_STORED_BYTES`
override the first two defaults with positive integers. Existing records count
toward budgets; an upgrade never deletes them to satisfy a new limit. Review
Cloudflare plan limits and existing database size before increasing budgets.
JSON budgets exclude SQL indexes, legacy records, logs, and backups. Rate limits
use persistent, salted IP hashes, at most 10,000 buckets, with one-hour cleanup.
People behind one shared IP share limits. These application write limits do not
replace Cloudflare request/billing alerts or edge controls for high-volume reads.

Creation reserves a room slot and bytes atomically **before** writing R2. Failed
uploads release their reservation only after confirmed R2 cleanup. A crash or
cleanup failure deliberately leaves a counted reservation. The operator list
shows these. To repair one, first stop new uploads and ensure no upload remains
in flight, inspect that exact reservation/object, delete its R2 object, then
delete its reservation. Never expire reservations automatically while an upload
could still finish. A failed admission does not upload a PDF.

## Inspect and take down rooms

With `MARKROOM_OPERATOR_KEY` in your process environment:

```sh
node scripts/operator.mjs https://your-site.example list
node scripts/operator.mjs https://your-site.example delete ROOM_ID --confirm
```

The list includes up to 1,000 rooms and pending reservations. The delete command
first disables a room, then removes its R2 object and associated D1 records.
Reads (including HEAD/range requests) and writes check that disabled state. Failed
cleanup leaves the room disabled and counted; retry the same deletion. Backups,
logs, previously downloaded copies, and already-started responses are separate
operator concerns. There is no owner-facing delete, expiry, or link-rotation UI.

## Review integrity and PDFs

New joins require distinct normalized names within a room. Names are still
self-selected. Owner badges derive from a server-recorded participant role;
exported authors include the role and participant ID to distinguish older
duplicate names. Historical installations did not record the owner-participant
relationship, so their participant badges are not guessed. Existing owner keys
continue to authorize closing and reviewed-PDF export.

A comment with live replies cannot be deleted. Delete only comments you own (or
moderate as the owner). Existing orphan replies block export until repaired or
removed, rather than silently disappearing. Deletion frees active capacity and
erases content, while bounded revision records protect synchronization.

PDFs remain **unsanitized**. The server bounds streamed bytes and checks the PDF
signature; page counting and parsing happen in the creator's browser. Original
PDF content may remain in exports. Accept files only from trusted people. The
viewer is not a safe-file certification service. HTTP/HTTPS/mail links remain
supported; a secure transport does not establish the destination's trust.

The built Worker adds a per-response script nonce, a same-origin CSP compatible
with PDF WASM, framing prevention, no-referrer policy, and MIME sniffing
protection. Inline styles remain allowed for the viewer. These policies reduce
some browser risks; they do not make same-origin compromised code harmless.
