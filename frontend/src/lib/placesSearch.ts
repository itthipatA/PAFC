// Official Google PlaceAutocompleteElement wrapper (<gmp-place-autocomplete>).
// Loads the Maps JS API with the places library and builds the element
// biased to Thailand. Throws on any load failure so the caller can
// silently fall back to the Nominatim geocoder.

import { loadGoogleMaps } from './googleMaps';

export interface PlaceHit {
  name: string;
  address: string;
  lat: number;
  lon: number;
}

// Text Search for the top match (used for Enter-key parity with Google Maps:
// the prediction rows live in closed shadow DOM, so Enter can't click them).
// Returns null when nothing matches. Throws on API failure.
export async function searchTextFirst(query: string): Promise<PlaceHit | null> {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
  if (!apiKey) {
    throw new Error('Missing VITE_GOOGLE_MAPS_API_KEY');
  }
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location',
    },
    body: JSON.stringify({
      textQuery: query,
      languageCode: 'th',
      regionCode: 'TH',
      maxResultCount: 1,
    }),
  });
  if (!res.ok) {
    throw new Error(`Places Text Search failed: ${res.status}`);
  }
  const data = (await res.json()) as {
    places?: Array<{
      displayName?: { text?: string };
      formattedAddress?: string;
      location?: { latitude?: number; longitude?: number };
    }>;
  };
  const top = data.places?.[0];
  const lat = top?.location?.latitude;
  const lon = top?.location?.longitude;
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  return {
    name: top?.displayName?.text ?? '',
    address: top?.formattedAddress ?? '',
    lat,
    lon,
  };
}

// Creates the official autocomplete web component with Thai language,
// Thailand region bias, and the standard Thai placeholder.
export async function createPlaceAutocompleteElement(): Promise<google.maps.places.PlaceAutocompleteElement> {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
  if (!apiKey) {
    throw new Error('Missing VITE_GOOGLE_MAPS_API_KEY');
  }
  const g = await loadGoogleMaps({ libraries: ['places'] });
  // importLibrary() can resolve before the custom-element class is attached
  // (lazy chunk) — poll briefly instead of trusting a single check.
  // Proven 2026-09-24: boot-time check threw while the class appeared later.
  const deadline = Date.now() + 5000;
  while (typeof g.maps?.places?.PlaceAutocompleteElement !== 'function') {
    if (Date.now() > deadline) {
      throw new Error('Places library unavailable (check key restrictions and API enablement)');
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return new g.maps.places.PlaceAutocompleteElement({
    requestedRegion: 'TH',
    requestedLanguage: 'th',
    includedRegionCodes: ['TH'],
    placeholder: 'ค้นหาสถานที่...',
  });
}
