import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const supplements = [
  "babel-helpers-7.29.2-LICENSE.txt",
  "tailwindcss-4.1.18-LICENSE.txt",
  "tailwindcss-4.2.1-LICENSE.txt",
  "rolldown-1.0.3-LICENSE.txt",
  "rolldown-1.0.3-THIRD-PARTY-LICENSE.txt",
];

// Read the served build, not just the script that is meant to produce it.
test("distributes full notices for embedded helpers, CSS, and the bundler runtime", async () => {
  const destination = new URL("dist/client/lib/embedpdf/", root);
  const combined = await readFile(new URL("THIRD_PARTY_NOTICES.txt", destination), "utf8");
  const sources = JSON.parse(await readFile(new URL("licenses/SUPPLEMENT-SOURCES.json", destination), "utf8"));
  for (const filename of supplements) {
    const expected = await readFile(new URL(`licenses/${filename}`, root), "utf8");
    assert.equal(await readFile(new URL(`licenses/${filename}`, destination), "utf8"), expected);
    assert.ok(combined.includes(expected), `Combined notice omits ${filename}`);
    assert.ok(sources[filename], `Missing provenance for ${filename}`);
  }
  assert.match(combined, /Copyright \(c\) 2014-present, Facebook, Inc\./);
  assert.match(combined, /Copyright \(c\) 2020 Evan Wallace/);
  const provenance = JSON.parse(await readFile(new URL("PROVENANCE.json", destination), "utf8"));
  const helper = provenance.generatedContributions.find((item) => item.name.includes("Babel regenerator"));
  assert.equal(helper.version, null, "The embedded Babel helper version has not been identified");
  assert.match(helper.licenseReference, /not the embedded helper version/);
  assert.match(provenance.auditedViewer.sha256, /^[a-f0-9]{64}$/);
  assert.match(provenance.limitation, /completeness.*has not been independently established/);
});
