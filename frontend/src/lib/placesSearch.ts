// Official Google PlaceAutocompleteElement wrapper (<gmp-place-autocomplete>).
// Loads the Maps JS API with the places library and builds the element
// biased to Thailand. Throws on any load failure so the caller can
// silently fall back to the Nominatim geocoder.

import { loadGoogleMaps } from './googleMaps';

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
