export type OwnerCandidateResolution = {
  acceptedFragment: boolean;
  token: string | null;
};

function plausibleOwnerToken(value: string) {
  return value.length >= 32 && value.length <= 180 && /^[A-Za-z0-9_-]+$/.test(value);
}

/** Keep an existing browser capability unless the server accepts the fragment for this room. */
export async function resolveOwnerCandidate(
  fragmentToken: string | null,
  storedToken: string | null,
  validate: (candidate: string) => Promise<boolean>,
): Promise<OwnerCandidateResolution> {
  if (!fragmentToken || !plausibleOwnerToken(fragmentToken)) {
    return { acceptedFragment: false, token: storedToken };
  }
  if (!await validate(fragmentToken)) {
    return { acceptedFragment: false, token: storedToken };
  }
  return { acceptedFragment: true, token: fragmentToken };
}
