export async function getJson<T>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(url, { ...options, cache: "no-store" });
  const json: unknown = await response.json();
  if (!response.ok) {
    const error =
      json &&
      typeof json === "object" &&
      "error" in json &&
      typeof json.error === "string"
        ? json.error
        : "The service could not complete this request. Try again.";
    throw new Error(error);
  }
  return json as T;
}
export async function postJson<T>(path: string, body: object): Promise<T> {
  const { token } = await getJson<{ token: string }>("/api/session", {
    signal: AbortSignal.timeout(8000),
  });
  return getJson<T>(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Merge-Monitor-Token": token,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  });
}
