export async function fetchCompanyProfile(ticker) {
  const res = await fetch(
    `${window.location.origin}/api/stores/company-profiles/${encodeURIComponent(ticker)}`,
    { credentials: "same-origin" }
  );
  if (res.status === 404) return null;
  if (res.status === 401 || res.status === 403) {
    const err = new Error("UNAUTHENTICATED");
    err.code = "UNAUTHENTICATED";
    throw err;
  }
  if (!res.ok) throw new Error(`Failed to load profile (${res.status})`);
  const body = await res.json();
  return body?.document?.payload ?? null;
}
