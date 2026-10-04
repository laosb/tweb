// Runs inside page.evaluate so profile fixtures use the real browser/WASM signer.
export async function makeDCProfile({data, rotatedData = data, identityKey, runtimeURL, now = Math.floor(Date.now() / 1000)}) {
  const {createDiem} = await import(runtimeURL);
  const diem = await createDiem();
  const identity = await crypto.subtle.importKey('jwk', identityKey, 'Ed25519', true, ['sign']);
  const device = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  const publicKeys = {identity: Uint8Array.from(atob(identityKey.x.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)),
    device: new Uint8Array(await crypto.subtle.exportKey('raw', device.publicKey))};
  const backend = {
    random: length => crypto.getRandomValues(new Uint8Array(length)),
    publicKey: role => publicKeys[role],
    sign: async(role, bytes) => new Uint8Array(await crypto.subtle.sign('Ed25519', role === 'identity' ? identity : device.privateKey, new Uint8Array(bytes))),
    verify: async(key, bytes, signature) => crypto.subtle.verify('Ed25519',
      await crypto.subtle.importKey('raw', new Uint8Array(key), 'Ed25519', false, ['verify']), new Uint8Array(signature), new Uint8Array(bytes))
  };
  const current = await diem.dcSetup({data, profile: null, now}, backend);
  const rotated = await diem.dcSetup({data: rotatedData, profile: current.profile, now}, backend);
  const next = await diem.dcSetup({data: rotatedData, profile: rotated.profile, now}, backend);
  return {...current, rotatedProfile: rotated.profile, nextProfile: next.profile};
}
