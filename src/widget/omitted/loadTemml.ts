// The widget ships no math renderer: formulas appear only in rich messages and Instant View,
// which Blah does not serve, and src/components/instantViewMath.tsx shows the source instead.
export default function loadTemml(): Promise<never> {
  return Promise.reject(new Error('Math rendering is not available in the support widget'));
}
