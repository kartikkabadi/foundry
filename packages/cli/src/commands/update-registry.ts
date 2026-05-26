export interface RegistryVersion {
  latest: string | null;
  error?: string;
}

export async function fetchNpmRegistryVersion(
  packageName: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RegistryVersion> {
  try {
    const response = await fetchImpl(`https://registry.npmjs.org/${packageName}/latest`);
    if (!response.ok) {
      return { latest: null, error: `registry HTTP ${response.status}` };
    }
    const data = (await response.json()) as { version?: string };
    return { latest: data.version ?? null };
  } catch (error) {
    return {
      latest: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
