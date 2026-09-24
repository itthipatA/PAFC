// Google Maps JS API loader (PREP phase only).
// MapLibre GL remains the active map provider. This module only wires
// the Google Maps script loader so a later phase can port layers when
// the user supplies their own API key. No visible behavior changes.

export type MapProvider = 'google' | 'maplibre';

// Reads the active map provider from env. Defaults to 'maplibre' so
// existing behavior is unchanged unless explicitly opted in.
export function getMapProvider(): MapProvider {
  const raw = import.meta.env.VITE_MAP_PROVIDER as string | undefined;
  return raw === 'google' ? 'google' : 'maplibre';
}

// Returns true only when a plausible API key is configured.
export function isGoogleMapsConfigured(): boolean {
  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
  return typeof key === 'string' && key.length > 10;
}

let cachedPromise: Promise<typeof google> | null = null;

// Injects the Google Maps JS API script exactly once and reuses the
// cached promise on subsequent calls. Resolves with window.google.
export function loadGoogleMaps(): Promise<typeof google> {
  if (cachedPromise) return cachedPromise;

  cachedPromise = new Promise((resolve, reject) => {
    // Reuse the global if the script was already loaded elsewhere.
    if (typeof window !== 'undefined' && window.google) {
      resolve(window.google);
      return;
    }

    const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
    if (!key) {
      reject(new Error('Missing VITE_GOOGLE_MAPS_API_KEY'));
      return;
    }

    const script = document.createElement('script');
    const params = new URLSearchParams({
      key,
      language: 'th',
      region: 'TH',
      loading: 'async',
    });
    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.google) resolve(window.google);
      else reject(new Error('Google Maps script loaded without window.google'));
    };
    script.onerror = () => reject(new Error('Failed to load Google Maps script'));
    document.head.appendChild(script);
  });

  return cachedPromise;
}
