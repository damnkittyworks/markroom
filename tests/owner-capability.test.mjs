import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../lib/owner-capability.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
});
const { resolveOwnerCandidate } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`
);

test("a valid room-confirmed fragment becomes the saved owner candidate", async () => {
  const candidate = "c".repeat(43);
  const seen = [];
  const result = await resolveOwnerCandidate(candidate, null, async (value) => {
    seen.push(value);
    return true;
  });
  assert.deepEqual(result, { acceptedFragment: true, token: candidate });
  assert.deepEqual(seen, [candidate]);
});

test("an invalid fragment cannot replace an existing owner capability", async () => {
  const candidate = "c".repeat(43);
  const stored = "s".repeat(43);
  const result = await resolveOwnerCandidate(candidate, stored, async () => false);
  assert.deepEqual(result, { acceptedFragment: false, token: stored });
});

test("an invalid first-use fragment is not persisted as an owner capability", async () => {
  const result = await resolveOwnerCandidate("c".repeat(43), null, async () => false);
  assert.deepEqual(result, { acceptedFragment: false, token: null });
});

test("missing or malformed fragments retain storage without a server request", async () => {
  const stored = "s".repeat(43);
  let calls = 0;
  const validate = async () => { calls += 1; return true; };
  for (const candidate of [null, "too-short", "x".repeat(31), "x".repeat(181), `${"x".repeat(42)}!`]) {
    assert.deepEqual(
      await resolveOwnerCandidate(candidate, stored, validate),
      { acceptedFragment: false, token: stored },
    );
  }
  assert.equal(calls, 0);
});

test("validation failures propagate so a first-use fragment is not silently discarded", async () => {
  const failure = new Error("synthetic validation failure");
  await assert.rejects(
    resolveOwnerCandidate("c".repeat(43), null, async () => { throw failure; }),
    failure,
  );
});
