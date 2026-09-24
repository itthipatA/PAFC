// Google Map Tiles API session helper (MapLibre raster path).
// Obtains a short-lived session token, then builds 2D tile URLs.
// Requires the Map Tiles API to be enabled on the API key.

export type GoogleMapType = 'roadmap' | 'satellite';

function getApiKey(): string {
  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
  if (!key) throw new Error('Missing VITE_GOOGLE_MAPS_API_KEY');
  return key;
}

// Creates a tile session and returns the session token.
// Throws with the server message text when the request fails
// (e.g. Map Tiles API not enabled on the key).
export async function createTileSession(mapType: GoogleMapType): Promise<string> {
  const key = getApiKey();
  const res = await fetch(`https://tile.googleapis.com/v1/createSession?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mapType, language: 'th', region: 'TH' }),
  });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`createTileSession failed (${res.status}): ${msg}`);
  }
  const data = await res.json();
  if (!data.session) throw new Error('createTileSession: missing session token in response');
  return data.session as string;
}

// Builds a 2D tile URL template for MapLibre raster sources.
export function getGoogleTileUrl(session: string): string {
  const key = getApiKey();
  return `https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session=${session}&key=${key}`;
}
