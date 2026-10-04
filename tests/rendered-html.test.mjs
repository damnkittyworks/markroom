import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

test("replaces the starter with the finished Markroom product", async () => {
  const [page, createReview, layout, css, packageJson] = await Promise.all([
    source("app/page.tsx"),
    source("app/create-review.tsx"),
    source("app/layout.tsx"),
    source("app/globals.css"),
    source("package.json"),
  ]);

  assert.match(page, /Markroom — Shared PDF review/);
  assert.match(createReview, /One PDF\./);
  assert.match(createReview, /One review record\./);
  assert.match(createReview, /1–1,000 pages/);
  assert.match(createReview, /Anyone with a room link/);
  assert.match(layout, /card: "summary"/);
  assert.doesNotMatch(layout, /\/og\.png/);
  await assert.rejects(access(new URL("public/og.png", root)));
  assert.match(css, /--coral:\s*#e8573c/);
  assert.match(css, /@media \(max-width: 560px\)/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await assert.rejects(access(new URL("app/_sites-preview/SkeletonPreview.tsx", root)));
});

test("keeps the shared review record in standalone Worker persistence", async () => {
  const [hosting, schema, migration, createRoute, fileRoute] = await Promise.all([
    source("wrangler.jsonc"),
    source("db/schema.ts"),
    source("drizzle/0000_romantic_stone_men.sql"),
    source("app/api/reviews/route.ts"),
    source("app/api/reviews/[reviewId]/file/route.ts"),
  ]);

  const hostingConfig = JSON.parse(hosting);
  assert.equal(hostingConfig.d1_databases[0].binding, "DB");
  assert.equal(hostingConfig.r2_buckets[0].binding, "FILES");
  for (const table of ["reviews", "participants", "annotations", "replies"]) {
    assert.match(schema, new RegExp(`sqliteTable\\(\\s*\"${table}\"`));
    assert.match(migration, new RegExp("CREATE TABLE `" + table + "`"));
  }
  assert.match(schema, /ownerTokenHash/);
  assert.match(schema, /tokenHash/);
  assert.doesNotMatch(schema, /ownerToken:\s*text/);
  assert.match(createRoute, /getReviewFiles\(\)/);
  assert.match(createRoute, /bucket\.put\(fileKey, upload/);
  assert.match(fileRoute, /accept-ranges/);
  assert.match(fileRoute, /status:\s*range \? 206 : 200/);
});

test("opens every review link in the full PDF workspace", async () => {
  const [mainPage, oldEmbedPage, oldNativePage, room, reviewRoute] = await Promise.all([
    source("app/review/[reviewId]/page.tsx"),
    source("app/review/[reviewId]/embed/page.tsx"),
    source("app/review/[reviewId]/native/page.tsx"),
    source("app/review/embed-review-room.tsx"),
    source("app/api/reviews/[reviewId]/route.ts"),
  ]);

  assert.match(mainPage, /EmbedReviewRoom/);
  assert.doesNotMatch(mainPage, /ReviewRoom from/);
  assert.match(oldEmbedPage, /EmbedReviewRoom/);
  assert.match(oldNativePage, /EmbedReviewRoom/);
  assert.doesNotMatch(oldNativePage, /NativeReviewRoom|Apryse/);
  assert.match(room, /SHARED PDF REVIEW/);
  assert.match(room, /Check for updates/);
  assert.match(room, /Close review/);
  assert.match(room, /Download editable PDF/);
  assert.match(room, /window\.location\.origin}\/review\/\$\{reviewId}/);
  assert.doesNotMatch(room, /OPEN-SOURCE LAB|ANNOTATION LAB|Apryse/);
  assert.match(reviewRoute, /payload\.action !== "close"/);

  for (const removedPath of [
    "app/review/review-room.tsx",
    "app/review/pdf-workspace.tsx",
    "lib/export-reviewed-pdf.ts",
  ]) {
    await assert.rejects(access(new URL(removedPath, root)));
  }
});

test("removes Apryse without dropping historical database records", async () => {
  const [packageJson, schema, migration, oldNativePage] = await Promise.all([
    source("package.json"),
    source("db/schema.ts"),
    source("drizzle/0001_secret_doctor_strange.sql"),
    source("app/review/[reviewId]/native/page.tsx"),
  ]);

  assert.doesNotMatch(packageJson, /@pdftron\/webviewer|prepare:webviewer/);
  assert.match(packageJson, /"prebuild": "npm run prepare:embedpdf"/);
  assert.match(schema, /sqliteTable\(\s*"native_annotations"/);
  assert.match(migration, /CREATE TABLE `native_annotations`/);
  assert.match(oldNativePage, /EmbedReviewRoom/);

  for (const removedPath of [
    "app/review/native-review-room.tsx",
    "app/api/reviews/[reviewId]/native-annotations/route.ts",
    "lib/native-annotation-types.ts",
    "scripts/prepare-webviewer-assets.mjs",
    "public/lib/webviewer/ui/index.html",
  ]) {
    await assert.rejects(access(new URL(removedPath, root)));
  }
});

test("runs the self-hosted editable annotation workspace", async () => {
  const [
    packageJson,
    schema,
    migration,
    mainPage,
    embedRoom,
    embedRoute,
    assetScript,
  ] = await Promise.all([
    source("package.json"),
    source("db/schema.ts"),
    source("drizzle/0002_acoustic_bedlam.sql"),
    source("app/review/[reviewId]/page.tsx"),
    source("app/review/embed-review-room.tsx"),
    source("app/api/reviews/[reviewId]/embed-annotations/route.ts"),
    source("scripts/prepare-embedpdf-assets.mjs"),
  ]);

  assert.match(packageJson, /"@embedpdf\/snippet": "2\.14\.4"/);
  assert.match(schema, /sqliteTable\(\s*"embed_annotations"/);
  assert.match(migration, /CREATE TABLE `embed_annotations`/);
  assert.match(mainPage, /EmbedReviewRoom/);
  assert.match(embedRoom, /viewerLoaderUrl = "\/lib\/embedpdf\/markroom-loader\.js"/);
  assert.match(embedRoom, /fontFallback: null/);
  assert.match(embedRoom, /worker: false/);
  assert.match(embedRoom, /fonts: \{ ui: null, signature: null \}/);
  assert.match(embedRoom, /manifests: \[\]/);
  assert.match(embedRoom, /"insert-signature"/);
  assert.match(embedRoom, /"insert-attachment"/);
  assert.match(embedRoom, /"redaction"/);
  assert.match(embedRoom, /Check for updates/);
  assert.match(embedRoom, /closeReview/);
  assert.match(embedRoom, /inReplyToId|threaded replies/);
  assert.match(embedRoom, /"locked", "lockedContents"/);
  assert.match(embedRoom, /ownershipLockedIdsRef/);
  assert.match(embedRoom, /You can reply to this comment/);
  assert.doesNotMatch(embedRoom, /annotation\.flags = .*"readOnly"/);
  assert.match(embedRoom, /saveAsCopy\(\)/);
  assert.match(embedRoom, /remoteCommitIdsRef/);
  assert.match(embedRoom, /serverFingerprintRef/);
  assert.match(embedRoute, /expectedRevision/);
  assert.match(embedRoute, /review\.status === "closed"/);
  assert.match(embedRoute, /validateEmbedTransfer/);
  assert.match(embedRoute, /authorId: embedAnnotations\.participantId/);
  assert.match(embedRoute, /existing\.participantId !== participant\.id && !owner/);
  assert.match(embedRoute, /result\.meta\.changes/);
  assert.match(assetScript, /filename\.endsWith\("\.wasm"\)/);
  await access(new URL("public/lib/embedpdf/embedpdf.js", root));
  await access(new URL("public/lib/embedpdf/markroom-loader.js", root));
  await access(new URL("public/lib/embedpdf/pdfium.wasm", root));
});

test("writes timezone-qualified UTC dates into exported PDF annotations", async () => {
  const assetRoot = new URL("public/lib/embedpdf/", root);
  const assetFiles = await readdir(assetRoot);
  const javascript = await Promise.all(
    assetFiles
      .filter((filename) => filename.endsWith(".js"))
      .map((filename) => readFile(new URL(filename, assetRoot), "utf8")),
  );
  const assets = javascript.join("\n");

  const bareDirectFormatter =
    "return`D:${e.getUTCFullYear()}${t(e.getUTCMonth()+1)}${t(e.getUTCDate())}${t(e.getUTCHours())}${t(e.getUTCMinutes())}${t(e.getUTCSeconds())}`";
  const utcDirectFormatter = `${bareDirectFormatter.slice(0, -1)}Z\``;
  const bareWorkerFormatter = "return `D:${YYYY}${MM}${DD}${HH}${mm}${SS}`;";
  const utcWorkerFormatter = "return `D:${YYYY}${MM}${DD}${HH}${mm}${SS}Z`;";

  assert.equal(assets.includes(bareDirectFormatter), false);
  assert.equal(assets.includes(bareWorkerFormatter), false);
  assert.equal(assets.includes(utcDirectFormatter), true);
  assert.equal(assets.includes(utcWorkerFormatter), true);
});
