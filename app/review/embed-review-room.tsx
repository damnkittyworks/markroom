"use client";

import { protectedThreadIds } from "../../lib/thread-deletion";

import type {
  AnnotationCapability,
  AnnotationEvent,
  AnnotationPlugin,
  AnnotationTransferItem,
  CommandsPlugin,
  DocumentManagerPlugin,
  EmbedPdfContainer,
  ExportCapability,
  ExportPlugin,
  PdfAnnotationObject,
  PluginRegistry,
  UIPlugin,
} from "@embedpdf/snippet";
import { useEffect, useRef, useState } from "react";
import type {
  EmbedAnnotationAction,
  EmbedAnnotationMutation,
  EmbedAnnotationRecord,
  EmbedAnnotationSnapshot,
  EmbedAnnotationTransfer,
} from "../../lib/embed-annotation-types";
import type { ReviewSnapshot } from "../../lib/review-types";
import { validateEmbedTransfer } from "../../lib/embed-validation";

const viewerLoaderUrl = "/lib/embedpdf/markroom-loader.js";
const unsupportedAnnotationTypes = new Set([13, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28]);

type ViewerBridge = {
  annotations: Readonly<AnnotationCapability>;
  checkForUpdates: () => Promise<number>;
  container: EmbedPdfContainer;
  documentId: string;
  exporter: Readonly<ExportCapability>;
  registry: PluginRegistry;
};

declare global {
  interface Window {
    __markroomEmbedPdf?: ViewerBridge;
    __markroomEmbedPdfModule?: typeof import("@embedpdf/snippet");
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

async function parseJson<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T & { error?: string; code?: string };
  if (!response.ok) {
    const error = new Error(payload.error || "The request could not be completed.");
    Object.assign(error, { status: response.status, code: payload.code });
    throw error;
  }
  return payload;
}

function downloadPdf(data: ArrayBuffer, filename: string) {
  const blob = new Blob([data], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function embedFilename(filename: string) {
  const stem = filename.replace(/\.pdf$/i, "");
  return `${stem}-markroom-review.pdf`;
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

async function loadEmbedPdfModule() {
  if (window.__markroomEmbedPdfModule) return window.__markroomEmbedPdfModule;
  return new Promise<typeof import("@embedpdf/snippet")>((resolve, reject) => {
    const ready = () => {
      cleanup();
      if (window.__markroomEmbedPdfModule) resolve(window.__markroomEmbedPdfModule);
      else reject(new Error("The EmbedPDF module loaded without registering itself."));
    };
    const failed = () => {
      cleanup();
      reject(new Error("The self-hosted EmbedPDF module could not be loaded."));
    };
    const cleanup = () => {
      window.removeEventListener("markroom:embedpdf-module-ready", ready);
    };
    window.addEventListener("markroom:embedpdf-module-ready", ready, { once: true });
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${viewerLoaderUrl}"]`,
    );
    if (existing) {
      existing.addEventListener("error", failed, { once: true });
      return;
    }
    const script = document.createElement("script");
    script.type = "module";
    script.src = viewerLoaderUrl;
    script.addEventListener("error", failed, { once: true });
    document.head.appendChild(script);
  });
}

function reviveTransfer(
  transfer: EmbedAnnotationTransfer,
  ownershipLocked: boolean,
): AnnotationTransferItem {
  const annotation = structuredClone(transfer.annotation) as unknown as PdfAnnotationObject;
  if (typeof annotation.created === "string") annotation.created = new Date(annotation.created);
  if (typeof annotation.modified === "string") annotation.modified = new Date(annotation.modified);
  const flags = (annotation.flags ?? []).filter((flag) => flag !== "readOnly");
  if (ownershipLocked) {
    annotation.flags = [...new Set([...flags, "locked", "lockedContents"])] as typeof annotation.flags;
  } else if (flags.length !== (annotation.flags ?? []).length) {
    annotation.flags = flags as typeof annotation.flags;
  }
  return { annotation };
}

function serializeTransfer(event: Exclude<AnnotationEvent, { type: "loaded" }>) {
  return JSON.parse(JSON.stringify({
    annotation: event.annotation,
  })) as EmbedAnnotationTransfer;
}

function annotationPatch(annotation: PdfAnnotationObject) {
  const patch = { ...annotation } as Partial<PdfAnnotationObject> & {
    id?: string;
    pageIndex?: number;
    type?: number;
  };
  delete patch.id;
  delete patch.pageIndex;
  delete patch.type;
  return patch;
}

function stableJson(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([left], [right]) => left.localeCompare(right),
    );
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function annotationFingerprint(
  annotation: PdfAnnotationObject | EmbedAnnotationTransfer["annotation"],
  stripOwnershipLock = false,
) {
  const serialized = JSON.parse(JSON.stringify(annotation)) as Record<string, unknown>;
  if (Array.isArray(serialized.flags)) {
    serialized.flags = serialized.flags.filter(
      (flag) =>
        flag !== "readOnly" &&
        (!stripOwnershipLock || (flag !== "locked" && flag !== "lockedContents")),
    );
  }
  return stableJson(serialized);
}

async function waitForDocument(
  manager: Readonly<ReturnType<DocumentManagerPlugin["provides"]>>,
) {
  const current = manager.getActiveDocumentId();
  if (current && manager.getDocument(current)) return current;
  return new Promise<string>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      unsubscribeOpened();
      unsubscribeError();
      reject(new Error("The PDF took too long to open."));
    }, 30_000);
    const unsubscribeOpened = manager.onDocumentOpened((document) => {
      window.clearTimeout(timeout);
      unsubscribeOpened();
      unsubscribeError();
      resolve(document.id);
    });
    const unsubscribeError = manager.onDocumentError((event) => {
      window.clearTimeout(timeout);
      unsubscribeOpened();
      unsubscribeError();
      reject(new Error(event.message || "The PDF could not be opened."));
    });
  });
}

async function waitForAnnotationCommit(
  annotations: Readonly<AnnotationCapability>,
  documentId: string,
) {
  const started = Date.now();
  while (annotations.forDocument(documentId).getState().hasPendingChanges) {
    if (Date.now() - started > 30_000) {
      throw new Error("The PDF engine took too long to finish an annotation change.");
    }
    await delay(40);
  }
}

export function EmbedReviewRoom({ reviewId }: { reviewId: string }) {
  const viewerElementRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<EmbedPdfContainer | null>(null);
  const registryRef = useRef<PluginRegistry | null>(null);
  const annotationRef = useRef<Readonly<AnnotationCapability> | null>(null);
  const exportRef = useRef<Readonly<ExportCapability> | null>(null);
  const documentIdRef = useRef("");
  const viewerStartedRef = useRef(false);
  const revisionMapRef = useRef(new Map<string, number>());
  const managedIdsRef = useRef(new Set<string>());
  const remoteCommitIdsRef = useRef(new Set<string>());
  const ownershipLockedIdsRef = useRef(new Set<string>());
  const serverRowsRef = useRef(new Map<string, EmbedAnnotationRecord>());
  const serverFingerprintRef = useRef(new Map<string, string>());
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const failedSavesRef = useRef(new Map<string, EmbedAnnotationMutation>());
  const invalidRowsRef = useRef(new Set<string>());
  const isClosedRef = useRef(false);
  const isOwnerRef = useRef(false);
  const operationRef = useRef(false);
  const pendingViewerDeletesRef = useRef(new Map<string, { id: string; inReplyToId?: unknown }>());
  const blockedThreadDeletesRef = useRef(new Set<string>());
  const restoringThreadRef = useRef(false);

  const [snapshot, setSnapshot] = useState<ReviewSnapshot | null>(null);
  const [participant, setParticipant] = useState<EmbedAnnotationSnapshot["participant"]>(null);
  const [participantToken, setParticipantToken] = useState<string | null>(null);
  const [ownerToken, setOwnerToken] = useState<string | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [identityReady, setIdentityReady] = useState(false);
  const [dataReady, setDataReady] = useState(false);
  const [viewerReady, setViewerReady] = useState(false);
  const [fatalError, setFatalError] = useState("");
  const [actionError, setActionError] = useState("");
  const [joinName, setJoinName] = useState("");
  const [joining, setJoining] = useState(false);
  const [checking, setChecking] = useState(false);
  const [closing, setClosing] = useState(false);
  const [savingCount, setSavingCount] = useState(0);
  const [failedSaveCount, setFailedSaveCount] = useState(0);
  const [invalidRowCount, setInvalidRowCount] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [syncMessage, setSyncMessage] = useState("Preparing shared annotations…");
  const [copyMessage, setCopyMessage] = useState("");

  const fileUrl = `/api/reviews/${reviewId}/file`;
  const roomUrl = typeof window === "undefined"
    ? ""
    : `${window.location.origin}/review/${reviewId}`;
  const isClosed = snapshot?.review.status === "closed";
  const canOpenViewer = Boolean(participant) || isClosed;
  const busy = checking || closing || downloading || retrying;
  const shouldJoin = Boolean(
    identityReady && dataReady && snapshot && !participant && !isClosed,
  );

  async function fetchEmbedRows(token = participantToken ?? "") {
    const response = await fetch(`/api/reviews/${reviewId}/embed-annotations`, {
      cache: "no-store",
      headers: {
        ...(token ? { "x-markroom-participant-token": token } : {}),
        ...(ownerToken ? { "x-markroom-owner-token": ownerToken } : {}),
      },
    });
    return parseJson<EmbedAnnotationSnapshot>(response);
  }

  async function sendMutation(mutation: EmbedAnnotationMutation) {
    const response = await fetch(`/api/reviews/${reviewId}/embed-annotations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...mutation,
        participantToken,
        ownerToken,
      }),
    });
    return parseJson<{
      annotationId: string;
      revision: number;
      deleted: boolean;
      updatedAt: string;
      transfer: EmbedAnnotationTransfer | null;
      authorId: string;
      authorName: string;
    }>(response);
  }

  function setViewerReadOnly(readOnly: boolean) {
    const embedModule = window.__markroomEmbedPdfModule;
    const registry = registryRef.current;
    const annotations = annotationRef.current;
    if (!embedModule || !registry || !annotations || !documentIdRef.current) return;
    const scope = annotations.forDocument(documentIdRef.current);
    scope.setLocked({ type: readOnly ? embedModule.LockModeType.All : embedModule.LockModeType.None });
    if (readOnly) scope.setActiveTool(null);
    const commands = registry.getPlugin<CommandsPlugin>("commands")?.provides();
    const ui = registry.getPlugin<UIPlugin>("ui")?.provides();
    if (readOnly) {
      commands?.disableCategory("annotation");
      ui?.disableCategory("annotation");
    } else {
      commands?.enableCategory("annotation");
      ui?.enableCategory("annotation");
    }
  }

  function observeReviewStatus(status: "open" | "closed") {
    if (status !== "closed") return;
    isClosedRef.current = true;
    setViewerReadOnly(true);
    setSnapshot((current) => current && ({
      ...current,
      review: { ...current.review, status: "closed" },
    }));
  }

  async function rememberSaved(saved: Awaited<ReturnType<typeof sendMutation>>) {
    const id = saved.annotationId;
    const previous = serverRowsRef.current.get(id);
    revisionMapRef.current.set(id, saved.revision);
    serverRowsRef.current.set(id, {
      id, authorId: saved.authorId, authorName: saved.authorName,
      revision: saved.revision, deleted: saved.deleted, transfer: saved.transfer,
      createdAt: previous?.createdAt ?? saved.updatedAt, updatedAt: saved.updatedAt,
    });
    if (saved.deleted || !saved.transfer) {
      managedIdsRef.current.delete(id);
      ownershipLockedIdsRef.current.delete(id);
      serverFingerprintRef.current.delete(id);
    } else {
      managedIdsRef.current.add(id);
      serverFingerprintRef.current.set(id, annotationFingerprint(saved.transfer.annotation));
    }
    failedSavesRef.current.delete(id);
    setFailedSaveCount(failedSavesRef.current.size);
    // Keep the viewer and exported PDF aligned with server-owned author metadata.
    const current = annotationRef.current?.forDocument(documentIdRef.current).getAnnotationById(id)?.object;
    if (saved.transfer && current && current.author !== saved.authorName) {
      remoteCommitIdsRef.current.add(id);
      annotationRef.current!.forDocument(documentIdRef.current).updateAnnotation(
        current.pageIndex, id, { author: saved.authorName },
      );
      await waitForAnnotationCommit(annotationRef.current!, documentIdRef.current);
      remoteCommitIdsRef.current.delete(id);
    }
  }

  async function flushLocalChanges() {
    const annotations = annotationRef.current;
    const documentId = documentIdRef.current;
    if (annotations && documentId) {
      await annotations.forDocument(documentId).commit().toPromise();
      await waitForAnnotationCommit(annotations, documentId);
    }
    // Committing the PDF engine can enqueue HTTP saves. Wait for the final queue.
    let queue;
    do {
      queue = saveQueueRef.current;
      await queue;
    } while (queue !== saveQueueRef.current);
    if (failedSavesRef.current.size) {
      throw new Error("Some changes have not been saved. Retry or discard them before syncing, closing, or exporting.");
    }
  }

  async function withSavedAnnotations(work: () => Promise<void>) {
    if (operationRef.current) return;
    operationRef.current = true;
    setViewerReadOnly(true);
    try {
      await flushLocalChanges();
      await work();
    } finally {
      operationRef.current = false;
      setViewerReadOnly(isClosedRef.current);
    }
  }

  function removeUnsupportedAnnotation(event: Exclude<AnnotationEvent, { type: "loaded" }>) {
    const annotations = annotationRef.current;
    if (!annotations || event.type === "delete") return;
    remoteCommitIdsRef.current.add(event.annotation.id);
    annotations.deleteAnnotation(event.pageIndex, event.annotation.id);
  }

  function queueLocalChange(event: Exclude<AnnotationEvent, { type: "loaded" }>) {
    const annotationId = event.annotation.id;
    if (!annotationId) return;
    if (ownershipLockedIdsRef.current.has(annotationId)) {
      setActionError(
        "You can reply to this comment, but only its author or the review owner can edit or delete it.",
      );
      const serverRow = serverRowsRef.current.get(annotationId);
      if (serverRow && !serverRow.deleted) {
        void applyServerRows([serverRow], true).catch((error) => {
          setActionError(`The protected annotation could not be restored: ${errorMessage(error)}`);
        });
      }
      return;
    }
    if (
      unsupportedAnnotationTypes.has(event.annotation.type) ||
      ("ctx" in event && Boolean(event.ctx))
    ) {
      removeUnsupportedAnnotation(event);
      setActionError(
        "That tool is not available in this review room because its appearance data cannot yet be synchronized safely.",
      );
      return;
    }

    setSavingCount((count) => count + 1);
    saveQueueRef.current = saveQueueRef.current
      .then(async () => {
        const knownRevision = revisionMapRef.current.get(annotationId);
        const action: EmbedAnnotationAction = event.type === "delete"
          ? "delete"
          : !knownRevision
            ? "add"
            : "modify";
        const mutation: EmbedAnnotationMutation = {
          action,
          annotationId,
          expectedRevision: knownRevision,
          transfer: action === "delete" ? undefined : serializeTransfer(event),
        };
        // Retain both the change and its original revision until the server confirms it.
        failedSavesRef.current.set(annotationId, mutation);
        await rememberSaved(await sendMutation(mutation));
        if (!failedSavesRef.current.size) {
          setActionError("");
          setSyncMessage(`Saved · ${new Date().toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
          })}`);
        }
      })
      .catch(async (error: unknown) => {
        if (error instanceof Error && "code" in error && error.code === "thread_has_replies") {
          try {
            const next = await fetchEmbedRows();
            observeReviewStatus(next.reviewStatus);
            const parent = next.annotations.find((row) => row.id === annotationId);
            if (!parent || parent.deleted || parent.invalid) throw new Error("The comment could not be restored.");
            await applyServerRows(next.annotations, true);
            if (invalidRowsRef.current.has(annotationId)) throw new Error("The comment could not be restored.");
            failedSavesRef.current.delete(annotationId);
            setFailedSaveCount(failedSavesRef.current.size);
            setActionError(`${errorMessage(error)} The comment has been restored.`);
            setSyncMessage("Comment restored · replies preserved");
            return;
          } catch {
            // Keep the rejected change visible in recovery controls if restoring fails.
          }
        }
        setFailedSaveCount(failedSavesRef.current.size);
        setActionError(
          `${errorMessage(error)} Your changes remain in this tab. Retry saving before leaving.`,
        );
        setSyncMessage("One or more changes need attention");
      })
      .finally(() => {
        setSavingCount((count) => Math.max(0, count - 1));
      });
  }

  async function applyServerRows(rows: EmbedAnnotationRecord[], initial = false) {
    const annotations = annotationRef.current;
    const documentId = documentIdRef.current;
    if (!annotations || !documentId) return 0;
    const scope = annotations.forDocument(documentId);
    const appliedIds = new Set<string>();
    let changed = 0;

    for (const row of rows) {
      serverRowsRef.current.set(row.id, row);
      const transfer = row.deleted ? null : validateEmbedTransfer(row.transfer, {
        annotationId: row.id,
        pageCount: snapshot?.review.pageCount,
        authorName: row.authorName,
      });
      if (!row.deleted && (row.invalid || !transfer)) {
        invalidRowsRef.current.add(row.id);
        continue;
      }
      invalidRowsRef.current.delete(row.id);
      const ownershipLocked = !isOwnerRef.current && row.authorId !== participant?.id;
      if (row.deleted || !ownershipLocked) {
        ownershipLockedIdsRef.current.delete(row.id);
      } else {
        ownershipLockedIdsRef.current.add(row.id);
      }
      const knownRevision = revisionMapRef.current.get(row.id);
      if (!initial && knownRevision === row.revision) continue;
      const existing = scope.getAnnotationById(row.id)?.object;
      appliedIds.add(row.id);
      remoteCommitIdsRef.current.add(row.id);

      if (row.deleted) {
        revisionMapRef.current.set(row.id, row.revision);
        managedIdsRef.current.delete(row.id);
        serverFingerprintRef.current.delete(row.id);
        if (existing) {
          scope.deleteAnnotation(existing.pageIndex, row.id);
          changed += 1;
        } else if (!pendingViewerDeletesRef.current.has(row.id)) {
          remoteCommitIdsRef.current.delete(row.id);
        }
        continue;
      }

      try {
        const revived = reviveTransfer(transfer!, ownershipLocked);
        if (existing) {
          scope.updateAnnotation(
            existing.pageIndex,
            row.id,
            annotationPatch(revived.annotation),
          );
        } else {
          scope.importAnnotations([revived]);
        }
        managedIdsRef.current.add(row.id);
        serverFingerprintRef.current.set(
          row.id,
          annotationFingerprint(transfer!.annotation, ownershipLocked),
        );
        revisionMapRef.current.set(row.id, row.revision);
        if (!initial) changed += 1;
      } catch {
        invalidRowsRef.current.add(row.id);
        revisionMapRef.current.delete(row.id);
        remoteCommitIdsRef.current.delete(row.id);
      }
    }

    setInvalidRowCount(invalidRowsRef.current.size);
    await waitForAnnotationCommit(annotations, documentId);
    for (const id of appliedIds) remoteCommitIdsRef.current.delete(id);
    return changed;
  }

  async function synchronizeRows() {
    const next = await fetchEmbedRows();
    if (next.participant) setParticipant(next.participant);
    isOwnerRef.current = next.isOwner;
    setIsOwner(next.isOwner);
    observeReviewStatus(next.reviewStatus);
    const changed = await applyServerRows(next.annotations);
    setSyncMessage(
      changed
        ? `${changed} shared ${changed === 1 ? "change" : "changes"} loaded`
        : `Up to date · ${new Date().toLocaleTimeString([], {
            hour: "numeric", minute: "2-digit",
          })}`,
    );
    return changed;
  }

  async function checkForUpdates() {
    const annotations = annotationRef.current;
    if (!annotations) return 0;
    setChecking(true);
    setActionError("");
    try {
      let changed = 0;
      await withSavedAnnotations(async () => { changed = await synchronizeRows(); });
      return changed;
    } catch (error) {
      setActionError(errorMessage(error));
      setSyncMessage("Could not check shared changes");
      throw error;
    } finally {
      setChecking(false);
    }
  }

  async function retryFailedSaves() {
    if (operationRef.current) return;
    operationRef.current = true;
    setViewerReadOnly(true);
    setRetrying(true);
    setActionError("");
    try {
      await saveQueueRef.current;
      const next = await fetchEmbedRows();
      observeReviewStatus(next.reviewStatus);
      for (const [id, mutation] of failedSavesRef.current) {
        const remote = next.annotations.find((row) => row.id === id);
        const local = mutation.transfer && validateEmbedTransfer(mutation.transfer, {
          annotationId: id, authorName: remote?.authorName ?? participant?.displayName,
          pageCount: snapshot?.review.pageCount,
        });
        const alreadySaved = mutation.action === "delete"
          ? !remote || remote.deleted
          : remote?.transfer && local && annotationFingerprint(remote.transfer.annotation) === annotationFingerprint(local.annotation);
        if (alreadySaved) {
          failedSavesRef.current.delete(id);
          if (remote) await applyServerRows([remote], true);
          continue;
        }
        if ((remote?.revision ?? 0) !== (mutation.expectedRevision ?? 0)) {
          throw new Error("Someone changed the same annotation. Copy any text you need, then discard the unsaved change to load their version.");
        }
        await rememberSaved(await sendMutation(mutation));
      }
      await synchronizeRows();
      setSyncMessage("All changes saved");
    } catch (error) {
      setActionError(errorMessage(error));
      setSyncMessage("One or more changes need attention");
    } finally {
      setFailedSaveCount(failedSavesRef.current.size);
      setRetrying(false);
      operationRef.current = false;
      setViewerReadOnly(isClosedRef.current);
    }
  }

  async function joinReview(event: React.FormEvent) {
    event.preventDefault();
    setJoining(true);
    setActionError("");
    try {
      const response = await fetch(`/api/reviews/${reviewId}/participants`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName: joinName }),
      });
      const joined = await parseJson<{
        participantId: string;
        participantToken: string;
        displayName: string;
      }>(response);
      localStorage.setItem(
        `markroom:participant:${reviewId}`,
        joined.participantToken,
      );
      setParticipantToken(joined.participantToken);
      const identity = await fetchEmbedRows(joined.participantToken);
      setParticipant(identity.participant);
      isOwnerRef.current = identity.isOwner;
      setIsOwner(identity.isOwner);
      const next = await fetch(`/api/reviews/${reviewId}`, { cache: "no-store" });
      setSnapshot(await parseJson<ReviewSnapshot>(next));
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setJoining(false);
    }
  }

  async function downloadEditablePdf() {
    const annotations = annotationRef.current;
    const exporter = exportRef.current;
    const documentId = documentIdRef.current;
    if (!annotations || !exporter || !documentId || !snapshot || !isOwner) return;
    setDownloading(true);
    setActionError("");
    try {
      await withSavedAnnotations(async () => {
        await synchronizeRows();
        if (invalidRowsRef.current.size) {
          throw new Error("Some shared annotations or reply threads are incomplete or unreadable. Export is blocked to avoid leaving them out.");
        }
        await flushLocalChanges();
        const data = await exporter.forDocument(documentId).saveAsCopy().toPromise();
        downloadPdf(data, embedFilename(snapshot.review.filename));
        setSyncMessage("Editable PDF downloaded");
      });
    } catch (error) {
      setActionError(errorMessage(error));
      setSyncMessage("PDF was not downloaded");
    } finally {
      setDownloading(false);
    }
  }

  async function closeReview() {
    if (!isOwner || !ownerToken || !snapshot || isClosed) return;
    const approved = window.confirm(
      "Close this review? Anyone with the link can still read the review and access the original PDF. Only the owner has the reviewed-PDF download button. No one will be able to add or change comments.",
    );
    if (!approved) return;
    setClosing(true);
    setActionError("");
    try {
      await withSavedAnnotations(async () => {
        await synchronizeRows();
        const response = await fetch(`/api/reviews/${reviewId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "close", ownerToken }),
        });
        await parseJson(response);
        observeReviewStatus("closed");
        // Include writes that won the race immediately before the server froze the room.
        await synchronizeRows();
        setSyncMessage("Review closed · comments are now read-only");
      });
    } catch (error) {
      setActionError(errorMessage(error));
    } finally {
      setClosing(false);
    }
  }

  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const fragmentOwnerToken = fragment.get("owner");
    if (fragmentOwnerToken) {
      localStorage.setItem(`markroom:owner:${reviewId}`, fragmentOwnerToken);
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
    }
    queueMicrotask(() => {
      setOwnerToken(
        fragmentOwnerToken || localStorage.getItem(`markroom:owner:${reviewId}`),
      );
      setParticipantToken(localStorage.getItem(`markroom:participant:${reviewId}`));
      setIdentityReady(true);
    });
  }, [reviewId]);

  useEffect(() => {
    if (!identityReady) return;
    let active = true;
    void Promise.all([
      fetch(`/api/reviews/${reviewId}`, { cache: "no-store" }).then((response) =>
        parseJson<ReviewSnapshot>(response),
      ),
      fetchEmbedRows(),
    ])
      .then(([reviewSnapshot, embedSnapshot]) => {
        if (!active) return;
        setSnapshot(reviewSnapshot);
        isClosedRef.current = reviewSnapshot.review.status === "closed";
        setParticipant(embedSnapshot.participant);
        isOwnerRef.current = embedSnapshot.isOwner;
        setIsOwner(embedSnapshot.isOwner);
        document.title = `${reviewSnapshot.review.title} — Markroom`;
        setDataReady(true);
      })
      .catch((error) => {
        if (active) setFatalError(errorMessage(error));
      });
    return () => {
      active = false;
    };
    // Identity is deliberately loaded once for this immutable review id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identityReady, reviewId]);

  useEffect(() => {
    if (
      !dataReady ||
      !snapshot ||
      (!participant && !isClosed) ||
      !viewerElementRef.current ||
      viewerStartedRef.current
    ) {
      return;
    }

    let disposed = false;
    let unsubscribeAnnotations: (() => void) | null = null;
    viewerStartedRef.current = true;
    setSyncMessage("Loading PDF annotation tools…");

    void loadEmbedPdfModule()
      .then(async (embedModule) => {
        if (disposed || !viewerElementRef.current) return;
        const container = embedModule.default.init({
          type: "container",
          target: viewerElementRef.current,
          src: fileUrl,
          worker: false,
          wasmUrl: "/lib/embedpdf/pdfium.wasm",
          fontFallback: null,
          fonts: { ui: null, signature: null },
          theme: { preference: "light" },
          tabBar: "never",
          disabledCategories: [
            "document-export",
            "document-open",
            "document-print",
            "document-protect",
            "insert-rubber-stamp",
            "insert-signature",
            "insert-image",
            "insert-attachment",
            "insert",
            "stamp",
            "signature",
            "redaction",
            "form",
            ...(isClosed ? ["annotation"] : []),
          ],
          annotations: {
            annotationAuthor: participant?.displayName ?? "Guest reviewer",
            autoCommit: true,
            deactivateToolAfterCreate: false,
            editAfterCreate: true,
            locked: isClosed
              ? { type: embedModule.LockModeType.All }
              : { type: embedModule.LockModeType.None },
          },
          stamp: {
            defaultLibrary: false,
            libraries: [],
            manifests: [],
          },
          export: { defaultFileName: embedFilename(snapshot.review.filename) },
        });
        if (!container) throw new Error("The PDF viewer did not start.");
        viewerRef.current = container;
        const registry = await container.registry;
        await registry.pluginsReady();
        if (disposed) {
          container.remove();
          await registry.destroy();
          return;
        }
        registryRef.current = registry;
        const annotationPlugin = registry.getPlugin<AnnotationPlugin>("annotation");
        const exportPlugin = registry.getPlugin<ExportPlugin>("export");
        const documentPlugin = registry.getPlugin<DocumentManagerPlugin>("document-manager");
        if (!annotationPlugin || !exportPlugin || !documentPlugin) {
          throw new Error("One or more PDF annotation services did not initialize.");
        }
        const annotations = annotationPlugin.provides();
        const exporter = exportPlugin.provides();
        const manager = documentPlugin.provides();
        annotationRef.current = annotations;
        exportRef.current = exporter;
        unsubscribeAnnotations = annotations.onAnnotationEvent((event) => {
          if (event.type === "loaded") return;
          if (!event.committed) {
            if (event.type === "delete") {
              pendingViewerDeletesRef.current.set(event.annotation.id, event.annotation);
              if (remoteCommitIdsRef.current.has(event.annotation.id)) {
                // A server-applied root deletion can cascade through children
                // whose tombstones occur later in the same snapshot.
                for (const child of pendingViewerDeletesRef.current.values()) {
                  if (child.inReplyToId === event.annotation.id) remoteCommitIdsRef.current.add(child.id);
                }
              } else {
                for (const id of protectedThreadIds(event.annotation.id, serverRowsRef.current.values(), pendingViewerDeletesRef.current.values())) {
                  blockedThreadDeletesRef.current.add(id);
                }
              }
            }
            return;
          }
          pendingViewerDeletesRef.current.delete(event.annotation.id);
          if (event.type === "delete" && blockedThreadDeletesRef.current.has(event.annotation.id)) {
            if (!restoringThreadRef.current) {
              restoringThreadRef.current = true;
              setSavingCount((count) => count + 1);
              // Wait until the entire PDF-engine commit finishes. Never send
              // its cascading child deletions to the server as separate edits.
              saveQueueRef.current = saveQueueRef.current.then(async () => {
                await waitForAnnotationCommit(annotations, documentIdRef.current);
                const next = await fetchEmbedRows();
                observeReviewStatus(next.reviewStatus);
                await applyServerRows(next.annotations, true);
                setActionError("This comment has replies. The thread has been restored; remove replies individually before deleting the comment.");
                setSyncMessage("Comment restored · replies preserved");
              }).catch(() => {
                for (const id of blockedThreadDeletesRef.current) invalidRowsRef.current.add(id);
                setInvalidRowCount(invalidRowsRef.current.size);
                setActionError("The shared thread is unchanged, but it could not be restored in this tab. Reload the room before continuing.");
                setViewerReadOnly(true);
              }).finally(() => {
                blockedThreadDeletesRef.current.clear();
                restoringThreadRef.current = false;
                setSavingCount((count) => Math.max(0, count - 1));
              });
            }
            return;
          }
          if (remoteCommitIdsRef.current.has(event.annotation.id)) {
            remoteCommitIdsRef.current.delete(event.annotation.id);
            return;
          }
          if (
            event.type !== "delete" &&
            serverFingerprintRef.current.get(event.annotation.id) ===
              annotationFingerprint(
                event.annotation,
                ownershipLockedIdsRef.current.has(event.annotation.id),
              )
          ) {
            return;
          }
          if (isClosedRef.current || !participant) return;
          queueLocalChange(event);
        });

        const documentId = await waitForDocument(manager);
        if (disposed) return;
        documentIdRef.current = documentId;
        // A fresh snapshot also covers changes made while the viewer was loading.
        const current = await fetchEmbedRows();
        if (disposed) return;
        observeReviewStatus(current.reviewStatus);
        isOwnerRef.current = current.isOwner;
        setIsOwner(current.isOwner);
        revisionMapRef.current.clear();
        managedIdsRef.current.clear();
        serverRowsRef.current.clear();
        serverFingerprintRef.current.clear();
        ownershipLockedIdsRef.current.clear();
        invalidRowsRef.current.clear();
        await applyServerRows(current.annotations, true);
        if (disposed) return;
        window.__markroomEmbedPdf = {
          annotations,
          checkForUpdates,
          container,
          documentId,
          exporter,
          registry,
        };
        setViewerReady(true);
        setViewerReadOnly(isClosedRef.current);
        setSyncMessage(
          `${managedIdsRef.current.size} shared ${
            managedIdsRef.current.size === 1 ? "annotation" : "annotations"
          } loaded`,
        );
      })
      .catch((error) => {
        viewerStartedRef.current = false;
        setFatalError(`The PDF viewer could not start: ${errorMessage(error)}`);
      });

    return () => {
      disposed = true;
      unsubscribeAnnotations?.();
      delete window.__markroomEmbedPdf;
      const container = viewerRef.current;
      const registry = registryRef.current;
      viewerRef.current = null;
      registryRef.current = null;
      annotationRef.current = null;
      exportRef.current = null;
      documentIdRef.current = "";
      viewerStartedRef.current = false;
      container?.remove();
      if (registry && !registry.isDestroyed()) void registry.destroy();
    };
    // The viewer is intentionally initialized once after identity and document data settle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataReady, canOpenViewer]);

  if (fatalError) {
    return (
      <main className="room-state-screen">
        <span className="brand-mark">M</span>
        <h1>This review room could not open.</h1>
        <p>{fatalError}</p>
        <a className="primary-action compact" href={`/review/${reviewId}`}>
          Try the review room again
        </a>
      </main>
    );
  }

  return (
    <main className="native-review-shell embed-review-shell">
      <header className="native-review-header">
        <a className="brand brand-compact" href={`/review/${reviewId}`}>
          <span className="brand-mark" aria-hidden="true">M</span>
          <span>MARKROOM</span>
        </a>
        <div className="native-document-identity">
          <span className="native-lab-label embed-lab-label">SHARED PDF REVIEW</span>
          <strong>{snapshot?.review.title ?? "Opening review…"}</strong>
          <small>Comments and replies remain editable in the exported PDF</small>
        </div>
        <div className="native-header-actions">
          <span className={`native-sync-state ${actionError ? "has-error" : ""}`}>
            <i aria-hidden="true" />
            {savingCount ? `Saving ${savingCount}…` : syncMessage}
          </span>
          <button
            className="secondary-button"
            type="button"
            onClick={() => void checkForUpdates().catch(() => {})}
            disabled={!viewerReady || busy || savingCount > 0}
          >
            {checking ? "Checking…" : "Check for updates"}
          </button>
          {isOwner ? (
            <button
              className="primary-button native-download-button"
              type="button"
              onClick={() => void downloadEditablePdf()}
              disabled={!viewerReady || busy || savingCount > 0}
            >
              {downloading ? "Building PDF…" : "Download editable PDF"}
              <span aria-hidden="true">↓</span>
            </button>
          ) : null}
        </div>
      </header>

      <section className="native-info-bar embed-info-bar" aria-label="Shared PDF review status">
        <span><b>TOOLS</b> Highlights, notes, free text, shapes, ink, links, and threaded replies</span>
        <span><b>NOT INCLUDED</b> Stamps, signatures, attachments, redaction, and forms</span>
        <div className="review-room-actions">
          <button
            type="button"
            onClick={() =>
              navigator.clipboard
                .writeText(roomUrl)
                .then(() => setCopyMessage("Room link copied"))
                .catch(() => setCopyMessage("Copy the address from your browser"))
            }
          >
            {copyMessage || "Copy room link"}
          </button>
          {isOwner && !isClosed ? (
            <button
              type="button"
              onClick={() => void closeReview()}
              disabled={!viewerReady || busy || savingCount > 0}
            >
              {closing ? "Closing…" : "Close review"}
            </button>
          ) : null}
        </div>
      </section>

      <section className="review-trust-bar" aria-label="Review identity and document safety">
        <span>
          {participant ? <>Reviewing as <strong>{participant.displayName}</strong></> : "Read-only visitor"}
          {isOwner ? <span className="review-owner-badge">Owner</span> : null}
          {isClosed ? " · Review closed" : null}
        </span>
        {snapshot ? (
          <details className="review-participant-list">
            <summary>{snapshot.participants.length} participants</summary>
            <ul>
              {snapshot.participants.map((person) => (
                <li key={person.id}>
                  {person.displayName}
                  {person.isOwner ? <span className="review-owner-badge">Owner</span> : null}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        <span>Only open PDFs from people you trust. Files are not sanitized.</span>
      </section>

      <div className="native-alert-stack">
      {actionError ? (
        <div className="room-alert native-room-alert" role="alert">
          <span>{actionError}</span>
          <button type="button" onClick={() => setActionError("")} aria-label="Dismiss">×</button>
        </div>
      ) : null}

      {failedSaveCount > 0 ? (
        <div className="room-alert native-room-alert native-recovery-alert" role="alert">
          <span>{failedSaveCount} unsaved {failedSaveCount === 1 ? "change" : "changes"}. Keep this tab open until saved or discarded.</span>
          <button type="button" disabled={busy || savingCount > 0} onClick={() => void retryFailedSaves()}>
            {retrying ? "Retrying…" : "Retry saving"}
          </button>
          <button type="button" disabled={busy || savingCount > 0} onClick={() => {
            if (window.confirm("Discard unsaved changes in this tab and reload the shared review?")) window.location.reload();
          }}>Discard unsaved changes</button>
        </div>
      ) : null}

      {invalidRowCount > 0 ? (
        <div className="room-alert native-room-alert" role="alert">
          {invalidRowCount} shared {invalidRowCount === 1 ? "annotation could" : "annotations could"} not be read or belong to an incomplete reply thread. The rest of the review is available; export is blocked until this data is repaired or removed.
        </div>
      ) : null}
      </div>

      <div className="native-viewer-frame embed-viewer-frame">
        {!viewerReady ? (
          <div className="native-viewer-loading" role="status">
            <span className="brand-mark" aria-hidden="true">M</span>
            <strong>{shouldJoin ? "Join to open the annotation tools" : "Loading the PDF workspace…"}</strong>
            <p>The PDF engine is self-hosted and runs in this browser.</p>
          </div>
        ) : null}
        <div ref={viewerElementRef} className="native-viewer embed-viewer" aria-label="Shared PDF annotation workspace" />
      </div>

      {shouldJoin ? (
        <div className="modal-backdrop">
          <form
            className="join-dialog"
            onSubmit={joinReview}
            role="dialog"
            aria-modal="true"
            aria-labelledby="embed-join-title"
          >
            <span className="brand-mark" aria-hidden="true">M</span>
            <p className="eyebrow">SHARED PDF REVIEW</p>
            <h2 id="embed-join-title">Join “{snapshot?.review.title}”</h2>
            <p>
              Your name will be written into every PDF annotation you add and will
              remain visible when the initiator opens the export in Acrobat.
            </p>
            <label className="field">
              <span>Your display name</span>
              <input
                value={joinName}
                onChange={(event) => setJoinName(event.target.value)}
                maxLength={60}
                autoFocus
                required
                placeholder="Your name"
              />
            </label>
            {actionError ? <p className="form-error" role="alert">{actionError}</p> : null}
            <button className="primary-action" type="submit" disabled={joining}>
              {joining ? "Joining…" : "Open review room"}
              <span aria-hidden="true">→</span>
            </button>
            <small>No account required. Your edit key stays in this browser.</small>
          </form>
        </div>
      ) : null}
    </main>
  );
}
