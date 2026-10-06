/** Names are chosen by participants, not verified identities. */
export function participantNameKey(displayName: string) {
  return displayName.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

/** A full participant ID keeps even legacy duplicate names distinct in PDF metadata. */
export function participantAuthorLabel(participant: { id: string; displayName: string; isOwner: number | boolean }) {
  const suffix = ` [${participant.isOwner ? "owner" : "reviewer"} ${participant.id}]`;
  const name = participant.displayName.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, "").trim();
  return `${name.slice(0, Math.max(0, 60 - suffix.length)).trimEnd()}${suffix}`;
}
