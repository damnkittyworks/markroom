# Dependency review

Reviewed 2026-10-03 against this repository's lockfile and locally built Worker. This is a dated assessment, not a guarantee that all reachable vulnerabilities have been found. Recheck advisories when changing dependencies or publishing a release.

## Applied updates

| Package | Previous | Pinned | Verification |
| --- | --- | --- | --- |
| React, React DOM, react-server-dom-webpack | 19.2.6 | 19.2.8 | Installed peers and rebuilt RSC implementation report 19.2.8. |
| @vitejs/plugin-rsc | 0.5.26 | 0.5.29 | Its vendored RSC also reports 19.2.8, avoiding an old fallback implementation. |
| Next and eslint-config-next | 16.2.6 | 16.3.8 | Same-major compatibility update; typecheck and build pass. |
| pdfjs-dist | 5.7.284 | 6.2.108 | Loading cleanup uses the v6 loading task's `destroy()`; browser upload/page counting passes. |
| Vite | 8.0.13 | 8.0.16 | Patch update; build and local preview pass. |

EmbedPDF remains pinned at 2.14.4 with Markroom's UTC annotation-date patch. Vinext remains at 0.0.50.

## Runtime applicability

- **React Server Components:** the server bundle contains RSC request decoding. Declaring RSC as a development dependency does not make it build-only. Both the installed and vendored implementations were patched for [GHSA-wx67-qw84-cm4g](https://github.com/react/react/security/advisories/GHSA-wx67-qw84-cm4g).
- **PDF.js:** Markroom uses core document loading to count pages, without the PDF.js viewer scripting manager. The scripting preconditions of [GHSA-hq66-cqwq-w95j](https://github.com/mozilla/pdf.js/security/advisories/GHSA-hq66-cqwq-w95j) were not demonstrated here; the package was still updated to the patched release. Browser upload verifies the worker path, not just Node parsing.
- **Next:** application imports resolve through vinext shims. The inspected Worker has no `node_modules/next/` regions or user-controlled `next/og` endpoint. The compatibility package and lint companion were nevertheless updated. The former critical [next/og finding](https://github.com/vercel/next.js/security/advisories/GHSA-vcvr-r3jv-pc5j) was not evidence of an exploitable Markroom route.
- **Vite:** the patched [Windows development-server issue](https://github.com/vitejs/vite/security/advisories/GHSA-fx2h-pf6j-xcff) concerns contributors' tooling, rather than the deployed Worker.

## Remaining findings

The [recorded npm audit](npm-audit-2026-10-03.json) contains **28 affected package entries: 21 high, 6 moderate, 1 low, and no critical**. The previous install had 33 affected entries, including one critical. Counts include inherited findings; they are not counts of distinct demonstrated application vulnerabilities.

| Dependency path | Inspected use and limit | Follow-up |
| --- | --- | --- |
| Cloudflare Vite plugin → Wrangler/Miniflare → sharp, undici, ws | Local build/preview tooling. No sharp/undici regions were identified in the inspected Worker. Tooling exposure still matters. | Test a coordinated Cloudflare toolchain upgrade. The inspected latest pair introduces a major preview-runtime change; an intermediate pair still carried reported transitive ranges. Keep development servers local. |
| vinext → image-size 2.0.2 | Local image imports and metadata build reads. No uploaded-PDF route into its image parsers was identified. | Upgrade with vinext compatibility checks; do not treat an absent bundle region as a complete reachability proof. |
| vinext → @vercel/og → satori → fflate | OG/font-processing path with no application OG generation endpoint identified. | Reassess if dynamic OG generation or untrusted font/archive input is added. |
| EmbedPDF core → Svelte adapter → devalue | The application uses the prebuilt snippet's Preact integration. It does not load the Svelte adapter. | Review the upstream bundled components separately. A lockfile-only change cannot establish a fix inside a prebuilt snippet. |
| ESLint/glob/braces/micromatch; Babel; browser metadata; fast-uri; js-yaml; nanoid | Contributor/build inputs. The remaining nanoid is a PostCSS dependency; application capability tokens use Web Crypto. | Update compatible tooling and avoid running untrusted contributor code in a privileged job. |
| drizzle-kit → @esbuild-kit → esbuild | Migration-generation tooling; the app does not serve requests through this esbuild API. | Test an upstream tooling update; avoid npm's suggested forced downgrade. |

No broad overrides or forced downgrades were applied. These observations narrow the inspected attack paths; they do not establish that every residual finding is harmless.

## Reproduce and reassess

```sh
npm ci
npm audit --json > npm-audit-current.json
npx tsc --noEmit
npm run lint
npm test
```

`npm audit` currently exits nonzero because findings remain. Its future output may differ as advisories change. CI runs the build, tests, typecheck, lint, and fresh local migrations; it does not turn this audit snapshot into a security gate or deploy the application.

After a framework/viewer update, inspect the generated server's actual RSC version and run the [two-browser acceptance check](../README.md#two-browser-acceptance-check). The current local checks passed, including independent inspection of synthetic PDF exports before and after closing a room.

Native PDFium component attribution is a separate unresolved release concern, documented in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md). See [SECURITY.md](../SECURITY.md) for private reporting and [KNOWN_ISSUES.md](../KNOWN_ISSUES.md) for deployment boundaries.
