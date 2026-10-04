# Third-party software

Markroom's application code is AGPL-3.0-only (copyright 2026 Damn Kitty Works LLC). The two adapted files below, including Markroom's changes to them, are MIT-licensed. Dependencies retain their own licenses.

## Adapted source files

| File | Upstream source | License and copyright |
|---|---|---|
| build/sites-vite-plugin.ts | Sites starter vendoring @openai/sites-vite-plugin 0.2.0 | MIT; copyright 2026 OpenAI; Markroom changes copyright 2026 Damn Kitty Works LLC |
| worker/index.ts | Worker entry template in vinext 0.0.50, dist/deploy.js | MIT; copyright 2026 Cloudflare, Inc.; Markroom changes copyright 2026 Damn Kitty Works LLC |

Both files carry the complete MIT permission/disclaimer, upstream copyright, and a description of Markroom's adaptations. The Sites notice was recovered from the installed Sites 0.1.75 starter's adjacent build/sites-vite-plugin.LICENSE; the original template revision is not recorded. The vinext notice comes from the pinned installed package's LICENSE. Preserve these file-specific notices when redistributing source.

## Viewer and generated distribution notices

The locked `@embedpdf/snippet@2.14.4` release is MIT (CloudPDF, 2025), as is its JavaScript `@embedpdf/pdfium@2.14.4` wrapper (CloudPDF, Ji Chang, 2024). The PDFium binary has separate terms in the package's `LICENSE.pdfium`, which contains PDFium's BSD redistribution conditions and Apache-2.0 text. Newer upstream repository licensing must not be substituted for these release files.

`npm run prepare:embedpdf` copies the exact installed snippet and dependency license/notice texts to `public/lib/embedpdf/licenses/` and combines them in `THIRD_PARTY_NOTICES.txt`. These are included in the browser build. The script fails if a traversed package has no root license text, and checks that the snippet's PDFium WASM equals the attributed PDFium package's WASM. `PROVENANCE.json` records the SHA-256 and package inventory. Bundled Preact, tailwind-merge, plugins, and dependency font notices are retained even where features/fonts are disabled. This conservative inventory can include unused dependency code.

The generated collection also includes full MIT notices for Babel's embedded regenerator helper, Tailwind CSS 4.1.18 in the viewer, Tailwind CSS 4.2.1 in the application stylesheet, and Rolldown 1.0.3 runtime helpers (including its Rollup/Evan Wallace notices). The saved texts and source URLs live in [licenses/](licenses/) and [licenses/SOURCES.json](licenses/SOURCES.json). These supplemental contributions are recorded separately in generated PROVENANCE.json.

The embedded Babel helper has no recoverable version. Its surviving Facebook copyright banner and the audited snippet JavaScript hash identify the code; the Babel 7.29.2 helpers license is a reference text, not a claim that the viewer embeds that version. The preparation script checks the exact viewer hash and banners, plus the installed Tailwind/Rolldown versions and license texts, so upgrades require a fresh notice review.

Markroom modifies the two EmbedPDF JavaScript date formatters to append the UTC timezone marker to PDF annotation timestamps. Modified files carry a banner, and `MODIFICATIONS.txt` describes the patch. The PDFium WASM is unmodified.

## Remaining provenance limitation

The Git source excludes generated viewer binaries. Source publication does not itself distribute the WASM, but serving a built app does. These are separate release decisions.

The 2.14.4 npm artifact supplies `LICENSE` and `LICENSE.pdfium` but does not include a complete native PDFium build/component manifest. The checked binary is tied to that artifact, not independently traced to every native third-party library, font, and revision. The generated notice collection preserves all package-supplied notices; it is not a claim that native third-party attribution is exhaustive. Before an official prebuilt release or public browser deployment, obtain that exact build's native-library/font manifest from upstream and incorporate any additional required notices. This is an unresolved provenance gap, not evidence of an incompatible license. Do not copy notices from today's different upstream runtime and imply they describe this old build.

Exact artifacts: [snippet 2.14.4](https://registry.npmjs.org/@embedpdf/snippet/-/snippet-2.14.4.tgz), [PDFium 2.14.4](https://registry.npmjs.org/@embedpdf/pdfium/-/pdfium-2.14.4.tgz). Preserve the lockfile, generated notices, and provenance when redistributing a build.

Other runtime dependencies include React/React DOM and Next (MIT), Drizzle ORM and PDF.js (Apache-2.0), plus their transitive dependencies. Vite generates `THIRD_PARTY_LICENSES.md` in each build output from the modules actually bundled. Keep those files beside the client and server outputs, together with the separate EmbedPDF notice collection and Markroom license. Neither collection is a complete native binary SBOM. See the installed packages and locked versions. [Vite license generation](https://vite.dev/config/build-options#build-license) documents the build inventory; Drizzle ORM's release license is [Apache-2.0](https://github.com/drizzle-team/drizzle-orm/blob/0.45.2/LICENSE).

The Drizzle ORM 0.45.2 and Vite RSC plugin 0.5.29 npm packages omit root license texts. Exact upstream release copies live in `licenses/`, with their URLs in `licenses/SOURCES.json`, and are copied into the generated notice collection. The build checks those package versions so an upgrade cannot silently reuse stale notices.
