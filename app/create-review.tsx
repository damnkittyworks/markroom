"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { getPdfJs } from "../lib/pdfjs-client";

const MAX_FILE_BYTES = 100 * 1024 * 1024;

type ReadyFile = {
  file: File;
  pageCount: number;
};

function humanFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes > 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

export function CreateReview() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [creationKey, setCreationKey] = useState("");
  const [creationEnabled, setCreationEnabled] = useState<boolean | null>(null);
  const [availabilityError, setAvailabilityError] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [title, setTitle] = useState("");
  const [readyFile, setReadyFile] = useState<ReadyFile | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/reviews", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Room creation availability could not be checked. Reload to try again.");
        const payload = await response.json() as { creationEnabled?: boolean };
        setCreationEnabled(payload.creationEnabled === true);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setAvailabilityError(errorMessage(error));
        setCreationEnabled(false);
      });
    return () => controller.abort();
  }, []);

  async function inspectFile(file: File) {
    setError("");
    setReadyFile(null);
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setError("Choose a PDF file.");
      return;
    }
    if (file.size < 1 || file.size > MAX_FILE_BYTES) {
      setError("Choose a PDF that is 100 MB or smaller.");
      return;
    }
    setAnalyzing(true);
    try {
      const pdfjs = await getPdfJs();
      const data = await file.arrayBuffer();
      const task = pdfjs.getDocument({ data });
      let pageCount: number;
      try {
        const pdf = await task.promise;
        pageCount = pdf.numPages;
      } finally {
        await task.destroy();
      }
      if (pageCount < 1 || pageCount > 1000) {
        throw new Error("This first version supports PDFs from 1 to 1,000 pages.");
      }
      setReadyFile({ file, pageCount });
      if (!title.trim()) setTitle(file.name.replace(/\.pdf$/i, ""));
    } catch (inspectionError) {
      const message = errorMessage(inspectionError);
      setError(
        /password/i.test(message)
          ? "Password-protected PDFs are not supported in this first version."
          : "That file could not be read as a PDF. Try opening it normally, then choose it again.",
      );
    } finally {
      setAnalyzing(false);
    }
  }

  async function createReview(event: React.FormEvent) {
    event.preventDefault();
    if (!creationEnabled || !creationKey) {
      setError("Enter a creation key provided by this site's operator to start a room.");
      return;
    }
    if (!readyFile) {
      setError("Choose a PDF to start the review.");
      return;
    }
    if (!ownerName.trim()) {
      setError("Enter the name reviewers should see.");
      return;
    }
    setCreating(true);
    setError("");
    try {
      const response = await fetch("/api/reviews", {
        method: "POST",
        headers: {
          "content-type": "application/pdf",
          "x-markroom-creation-key": creationKey,
          "x-file-name": encodeURIComponent(readyFile.file.name),
          "x-file-size": String(readyFile.file.size),
          "x-page-count": String(readyFile.pageCount),
          "x-review-title": encodeURIComponent(title.trim()),
          "x-reviewer-name": encodeURIComponent(ownerName.trim()),
        },
        body: readyFile.file,
      });
      const payload = (await response.json()) as {
        error?: string;
        reviewId?: string;
        ownerToken?: string;
        participantToken?: string;
        sharePath?: string;
      };
      if (!response.ok || !payload.reviewId || !payload.ownerToken || !payload.participantToken) {
        throw new Error(payload.error || "The review room could not be created.");
      }
      setCreationKey("");
      localStorage.setItem(
        `markroom:participant:${payload.reviewId}`,
        payload.participantToken,
      );
      localStorage.setItem(`markroom:owner:${payload.reviewId}`, payload.ownerToken);
      router.push(
        `${payload.sharePath || `/review/${payload.reviewId}`}#owner=${encodeURIComponent(payload.ownerToken)}`,
      );
    } catch (createError) {
      setError(errorMessage(createError));
      setCreating(false);
    }
  }

  return (
    <main className="landing-shell">
      <nav className="landing-nav" aria-label="Primary">
        <Link className="brand" href="/" aria-label="Markroom home">
          <span className="brand-mark" aria-hidden="true">M</span>
          <span>MARKROOM</span>
        </Link>
        <span className="beta-pill">SHARED PDF REVIEW</span>
      </nav>

      <section className="hero-grid">
        <div className="hero-copy">
          <p className="eyebrow">ONE SOURCE OF TRUTH</p>
          <h1>One PDF.<br />One review record.</h1>
          <p className="hero-intro">
            Put a document in a shared room. Reviewers mark the same pages,
            check for new feedback, and leave with one finished review copy.
          </p>
          <div className="workflow-line" aria-label="Review workflow">
            <span><b>01</b> Upload</span>
            <span><b>02</b> Share</span>
            <span><b>03</b> Review</span>
            <span><b>04</b> Export</span>
          </div>
        </div>

        <form className="create-card" onSubmit={createReview}>
          <div className="card-heading">
            <div>
              <p className="eyebrow">START A ROOM</p>
              <h2>Create a shared review</h2>
            </div>
            <span className="secure-note"><i aria-hidden="true" /> Link access</span>
          </div>

          <button
            className={`pdf-dropzone ${dragging ? "is-dragging" : ""} ${readyFile ? "has-file" : ""}`}
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              const file = event.dataTransfer.files[0];
              if (file) void inspectFile(file);
            }}
          >
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,.pdf"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void inspectFile(file);
              }}
            />
            <span className="file-glyph" aria-hidden="true">PDF</span>
            {analyzing ? (
              <span className="drop-copy"><strong>Reading the document…</strong><small>Checking page count and format</small></span>
            ) : readyFile ? (
              <span className="drop-copy file-ready">
                <strong>{readyFile.file.name}</strong>
                <small>{readyFile.pageCount.toLocaleString()} pages · {humanFileSize(readyFile.file.size)} · Change file</small>
              </span>
            ) : (
              <span className="drop-copy"><strong>Drop your PDF here</strong><small>or choose a file · 1–1,000 pages · up to 100 MB</small></span>
            )}
          </button>

          <p className="privacy-copy">Only open PDFs from people you trust. Files are not sanitized.</p>

          <label className="field">
            <span>Creation key</span>
            <input
              type="password"
              value={creationKey}
              onChange={(event) => setCreationKey(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="none"
              aria-describedby="creation-key-help"
              required
              disabled={creationEnabled !== true || creating}
            />
          </label>
          <p className="privacy-copy" id="creation-key-help" role="status">
            {creationEnabled === null
              ? "Checking room creation availability…"
              : creationEnabled
                ? "Ask this site's operator for a creation key. Reviewers only need the room link."
                : availabilityError || "Room creation is currently unavailable. Existing review links still work."}
          </p>

          <div className="field-row">
            <label className="field">
              <span>Review title</span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={120}
                placeholder="Product specification review"
              />
            </label>
            <label className="field">
              <span>Your name</span>
              <input
                value={ownerName}
                onChange={(event) => setOwnerName(event.target.value)}
                maxLength={60}
                placeholder="Lily"
                autoComplete="name"
                required
              />
            </label>
          </div>

          {error ? <p className="form-error" role="alert">{error}</p> : null}

          <button className="primary-action" type="submit" disabled={creating || analyzing || creationEnabled !== true || !creationKey}>
            <span>{creating ? "Creating review room…" : "Create review room"}</span>
            <span aria-hidden="true">↗</span>
          </button>
          <p className="privacy-copy">
            Anyone with a room link can see reviewer names and comments. Do not upload
            regulated, patient, payment-card, or highly confidential material.
          </p>
        </form>
      </section>

      <section className="principle-strip" aria-label="How Markroom works">
        <article><span>IMMUTABLE ORIGINAL</span><p>The uploaded PDF stays untouched while every review mark lives separately.</p></article>
        <article><span>CONCURRENT BY DESIGN</span><p>Separate comments save cleanly even when several people review at once.</p></article>
        <article><span>OWNER-CONTROLLED FINISH</span><p>Close the room, freeze changes, and download a PDF whose comments and replies remain editable.</p></article>
      </section>
    </main>
  );
}
