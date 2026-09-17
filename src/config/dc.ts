import blah from '@config/blah';

// Keep the range in one place for URL validation, auth-key migration and cleanup.
export const MAX_DC_ID = blah ? 255 : 5;
export const DC_IDS = Array.from({length: MAX_DC_ID}, (_, i) => i + 1);
