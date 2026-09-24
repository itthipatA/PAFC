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
  if (!g.maps?.places?.PlaceAutocompleteElement) {
    throw new Error('Places library unavailable (check key restrictions and API enablement)');
  }
  return new g.maps.places.PlaceAutocompleteElement({
    requestedRegion: 'TH',
    requestedLanguage: 'th',
    includedRegionCodes: ['TH'],
    placeholder: 'ค้นหาสถานที่...',
  });
}
