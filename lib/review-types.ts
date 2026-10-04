export type ReviewStatus = "open" | "closed";
export type AnnotationStatus = "open" | "resolved";
export type AnnotationKind = "pin" | "area";

export interface ReviewSummary {
  id: string;
  title: string;
  filename: string;
  fileSize: number;
  pageCount: number;
  ownerName: string;
  status: ReviewStatus;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

export interface ReviewParticipant {
  id: string;
  displayName: string;
  createdAt: string;
}

export interface ReviewReply {
  id: string;
  annotationId: string;
  authorName: string;
  body: string;
  createdAt: string;
}

export interface ReviewAnnotation {
  id: string;
  pageNumber: number;
  kind: AnnotationKind;
  x: number;
  y: number;
  width: number;
  height: number;
  pdfX: number;
  pdfY: number;
  pdfWidth: number;
  pdfHeight: number;
  color: string;
  body: string;
  status: AnnotationStatus;
  authorName: string;
  createdAt: string;
  updatedAt: string;
  replies: ReviewReply[];
}

export interface ReviewSnapshot {
  review: ReviewSummary;
  participants: ReviewParticipant[];
  annotations: ReviewAnnotation[];
}

export interface AnnotationDraft {
  pageNumber: number;
  kind: AnnotationKind;
  x: number;
  y: number;
  width: number;
  height: number;
  pdfX: number;
  pdfY: number;
  pdfWidth: number;
  pdfHeight: number;
  color: string;
  body: string;
}
