import { access, cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(
  projectRoot,
  "node_modules",
  "@embedpdf",
  "snippet",
  "dist",
);
const destinationRoot = path.join(projectRoot, "public", "lib", "embedpdf");
const loaderSource = path.join(projectRoot, "scripts", "embedpdf-browser-loader.js");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

// These contributions are generated into the distributed code/CSS and are not
// all represented in the package dependency graph or Vite's module inventory.
// The Babel helper has no embedded version: pin the containing artifact instead
// of treating the version of the license reference as the helper's version.
const auditedViewer = {
  version: "2.14.4",
  asset: "embedpdf-7TNsu-EA.js",
  sha256: "ef04e343cec398e3a7da132a1cfed0fbe8787140ec79e9d30ece7c58421d0b1c",
};
const generatedContributions = [
  {
    name: "Babel regenerator helper embedded in EmbedPDF",
    version: null,
    licenseReference: "@babel/helpers@7.29.2 LICENSE (not the embedded helper version)",
    files: ["babel-helpers-7.29.2-LICENSE.txt"],
  },
  { name: "Tailwind CSS embedded in EmbedPDF", version: "4.1.18", files: ["tailwindcss-4.1.18-LICENSE.txt"] },
  { name: "Tailwind CSS application output", package: "tailwindcss", version: "4.2.1", files: ["tailwindcss-4.2.1-LICENSE.txt"] },
  { name: "Rolldown generated runtime", package: "rolldown", version: "1.0.3", files: ["rolldown-1.0.3-LICENSE.txt", "rolldown-1.0.3-THIRD-PARTY-LICENSE.txt"] },
];

// EmbedPDF 2.14.4 formats UTC annotation dates without declaring their
// timezone. Acrobat then reasonably treats the UTC clock value as local time.
// Patch both shipped execution modes after copying the vendor bundle, and fail
// loudly if an EmbedPDF update changes either target instead of silently
// shipping the old behavior again.
const utcPdfDatePatches = [
  {
    label: "direct browser bundle",
    before:
      "return`D:${e.getUTCFullYear()}${t(e.getUTCMonth()+1)}${t(e.getUTCDate())}${t(e.getUTCHours())}${t(e.getUTCMinutes())}${t(e.getUTCSeconds())}`",
    after:
      "return`D:${e.getUTCFullYear()}${t(e.getUTCMonth()+1)}${t(e.getUTCDate())}${t(e.getUTCHours())}${t(e.getUTCMinutes())}${t(e.getUTCSeconds())}Z`",
  },
  {
    label: "embedded worker bundle",
    before: "return `D:${YYYY}${MM}${DD}${HH}${mm}${SS}`;",
    after: "return `D:${YYYY}${MM}${DD}${HH}${mm}${SS}Z`;",
  },
];

function occurrences(text, value) {
  return text.split(value).length - 1;
}

await access(sourceRoot).catch(() => {
  throw new Error(
    "EmbedPDF assets are missing. Run npm install before starting or building Markroom.",
  );
});

const snippetMetadata = JSON.parse(await readFile(path.join(sourceRoot, "../package.json"), "utf8"));
const viewerBytes = await readFile(path.join(sourceRoot, auditedViewer.asset));
if (snippetMetadata.version !== auditedViewer.version || sha256(viewerBytes) !== auditedViewer.sha256) {
  throw new Error("Review embedded Babel/Tailwind notices and refresh the audited EmbedPDF artifact before upgrading the viewer.");
}
const viewerText = viewerBytes.toString("utf8");
if (!viewerText.includes("regenerator-runtime -- Copyright (c) 2014-present, Facebook, Inc.") ||
    !viewerText.includes("tailwindcss v4.1.18 | MIT License")) {
  throw new Error("Expected embedded Babel and Tailwind license banners are missing.");
}
for (const contribution of generatedContributions.filter((item) => item.package)) {
  const metadata = JSON.parse(await readFile(path.join(projectRoot, "node_modules", contribution.package, "package.json"), "utf8"));
  if (metadata.version !== contribution.version) {
    throw new Error(`Review generated-output notices for ${contribution.package}@${metadata.version} before upgrading.`);
  }
  const installedLicense = await readFile(path.join(projectRoot, "node_modules", contribution.package, "LICENSE"));
  const savedLicense = await readFile(path.join(projectRoot, "licenses", contribution.files[0]));
  if (!installedLicense.equals(savedLicense)) throw new Error(`License text changed for ${contribution.package}; refresh its supplement.`);
}

await rm(destinationRoot, { recursive: true, force: true });
await mkdir(destinationRoot, { recursive: true });

const assets = (await readdir(sourceRoot)).filter(
  (filename) => filename.endsWith(".js") || filename.endsWith(".wasm"),
);
for (const filename of assets) {
  await cp(path.join(sourceRoot, filename), path.join(destinationRoot, filename));
}

const appliedPatches = new Map(utcPdfDatePatches.map((patch) => [patch.label, 0]));
for (const filename of assets.filter((filename) => filename.endsWith(".js"))) {
  const destination = path.join(destinationRoot, filename);
  const original = await readFile(destination, "utf8");
  let patched = original;
  for (const patch of utcPdfDatePatches) {
    const count = occurrences(patched, patch.before);
    if (count > 0) {
      appliedPatches.set(patch.label, (appliedPatches.get(patch.label) ?? 0) + count);
      patched = patched.replaceAll(patch.before, patch.after);
    }
  }
  if (patched !== original) await writeFile(destination, "/* Modified by Markroom: append UTC timezone to PDF annotation dates. See MODIFICATIONS.txt. */\n" + patched);
}

for (const patch of utcPdfDatePatches) {
  if (appliedPatches.get(patch.label) !== 1) {
    throw new Error(
      `Expected one ${patch.label} UTC PDF date formatter in EmbedPDF, found ${appliedPatches.get(patch.label)}.`,
    );
  }
}

await cp(loaderSource, path.join(destinationRoot, "markroom-loader.js"));
await cp(path.join(projectRoot, "LICENSE"), path.join(destinationRoot, "MARKROOM-LICENSE.txt"));

console.log(`Prepared the self-hosted EmbedPDF engine (${assets.length + 1} files).`);

// Keep the actual package notices beside the redistributed browser binaries.
// The exact package's license, not the current upstream branch, is authoritative.
const licensesRoot = path.join(destinationRoot, "licenses");
await mkdir(licensesRoot, { recursive: true });
const seen = new Set();
const noticeSections = [];
async function collectPackageNotices(name) {
  if (seen.has(name)) return;
  seen.add(name);
  const packageRoot = path.join(projectRoot, "node_modules", name);
  const metadata = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
  const files = (await readdir(packageRoot)).filter((filename) => /^(license|licence|notice|copying)([.\-_]|$)/i.test(filename));
  if (!files.length) throw new Error(`Missing release license text for bundled dependency ${name}@${metadata.version}`);
  for (const filename of files) {
    const content = await readFile(path.join(packageRoot, filename), "utf8");
    const targetName = `${name.replaceAll("/", "__")}--${filename}`;
    await writeFile(path.join(licensesRoot, targetName), content);
    noticeSections.push(`${name}@${metadata.version} / ${filename}\n${content}`);
  }
  for (const dependency of Object.keys(metadata.dependencies ?? {})) await collectPackageNotices(dependency);
}
await collectPackageNotices("@embedpdf/snippet");
for (const contribution of generatedContributions) {
  for (const filename of contribution.files) {
    const content = await readFile(path.join(projectRoot, "licenses", filename), "utf8");
    await writeFile(path.join(licensesRoot, filename), content);
    const identity = contribution.version ? `${contribution.name}@${contribution.version}` : `${contribution.name} (version unidentified)`;
    noticeSections.push(`${identity}\n${contribution.licenseReference ? `License reference: ${contribution.licenseReference}\n` : ""}${filename}\n${content}`);
  }
}
// These exact release packages omit root license files. Preserve their upstream
// release texts as supplements to Vite's generated application-bundle inventory.
for (const [name, version, filename] of [
  ["drizzle-orm", "0.45.2", "drizzle-orm-0.45.2-LICENSE.txt"],
  ["@vitejs/plugin-rsc", "0.5.29", "vite-plugin-rsc-0.5.29-LICENSE.txt"],
]) {
  const metadata = JSON.parse(await readFile(path.join(projectRoot, "node_modules", name, "package.json"), "utf8"));
  if (metadata.version !== version) throw new Error(`Refresh the checked-in license for ${name}@${metadata.version}.`);
  const content = await readFile(path.join(projectRoot, "licenses", filename), "utf8");
  await writeFile(path.join(licensesRoot, filename), content);
  noticeSections.push(`${name}@${version} / upstream LICENSE\n${content}`);
}
await cp(path.join(projectRoot, "licenses/SOURCES.json"), path.join(licensesRoot, "SUPPLEMENT-SOURCES.json"));
const pdfiumPackage = path.join(projectRoot, "node_modules/@embedpdf/pdfium");
const shippedHash = sha256(await readFile(path.join(destinationRoot, "pdfium.wasm")));
const upstreamHash = sha256(await readFile(path.join(pdfiumPackage, "dist/pdfium.wasm")));
if (shippedHash !== upstreamHash) throw new Error("Snippet PDFium binary differs from the attributed @embedpdf/pdfium binary.");
await writeFile(path.join(destinationRoot, "THIRD_PARTY_NOTICES.txt"), noticeSections.join("\n\n========================================\n\n"));
await writeFile(path.join(destinationRoot, "MODIFICATIONS.txt"), "Markroom modifies the EmbedPDF 2.14.4 direct and worker JavaScript date formatters to append Z (UTC) to exported PDF annotation timestamps. PDFium WASM is unmodified.\n");
await writeFile(path.join(destinationRoot, "PROVENANCE.json"), JSON.stringify({
  snippet: "@embedpdf/snippet@2.14.4",
  pdfium: "@embedpdf/pdfium@2.14.4",
  pdfiumSha256: shippedHash,
  auditedViewer,
  generatedContributions,
  noticePackages: [...seen].sort(),
  limitation: "Package-supplied notices are preserved. The package does not supply a complete native build/component manifest; completeness of native third-party notices has not been independently established.",
}, null, 2) + "\n");
await cp(path.join(projectRoot, "THIRD_PARTY_NOTICES.md"), path.join(destinationRoot, "README-NOTICES.md"));
console.log(`Preserved notices for ${seen.size} EmbedPDF dependency packages.`);
