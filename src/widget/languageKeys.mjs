import manifest from './languageKeys.json' with {type: 'json'};

export const widgetPackKeys = [
  ...manifest.literal,
  ...Object.values(manifest.computed).flatMap((family) => family.keys),
  ...manifest.startup.lang,
  ...manifest.startup.langSign,
  ...manifest.serverErrors.keys
].sort();
export const widgetFallbackKeys = [...widgetPackKeys, ...manifest.hidden].sort();

function sameKeys(actual, expected, label) {
  if(JSON.stringify([...actual].sort()) !== JSON.stringify([...expected].sort())) {
    throw new Error('WIDGET_LANGUAGE_KEYS_DIVERGED: ' + label);
  }
}

/** Shared by the build and the language guard; exceptions never cover a visible label. */
export function assertWidgetLanguageKeys(packKeys, hiddenKeys) {
  if(new Set(widgetFallbackKeys).size !== widgetFallbackKeys.length) throw new Error('WIDGET_LANGUAGE_DUPLICATE_KEY');
  if(hiddenKeys) sameKeys(manifest.hidden, hiddenKeys, 'hidden construction exceptions');
  if(packKeys) sameKeys(widgetPackKeys, packKeys, 'English pack');
}

