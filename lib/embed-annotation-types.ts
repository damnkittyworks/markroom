export type EmbedAnnotationAction = "add" | "modify" | "delete";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface SerializedEmbedAnnotation {
  id: string;
  pageIndex: number;
  type: number;
  rect: {
    origin: { x: number; y: number };
    size: { width: number; height: number };
  };
  [key: string]: JsonValue;
}

export interface EmbedAnnotationTransfer {
  annotation: SerializedEmbedAnnotation;
}

export interface EmbedAnnotationRecord {
  id: string;
  authorId: string;
  authorName: string;
  revision: number;
  deleted: boolean;
  transfer: EmbedAnnotationTransfer | null;
  invalid?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EmbedAnnotationSnapshot {
  reviewStatus: "open" | "closed";
  annotations: EmbedAnnotationRecord[];
  participant: {
    id: string;
    displayName: string;
  } | null;
}

export interface EmbedAnnotationMutation {
  action: EmbedAnnotationAction;
  annotationId: string;
  expectedRevision?: number;
  ownerToken?: string;
  participantToken?: string;
  transfer?: EmbedAnnotationTransfer;
}
