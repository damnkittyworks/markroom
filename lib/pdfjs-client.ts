"use client";

import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

let modulePromise: Promise<typeof import("pdfjs-dist")> | null = null;

export async function getPdfJs() {
  if (!modulePromise) {
    modulePromise = import("pdfjs-dist").then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      return pdfjs;
    });
  }
  return modulePromise;
}
