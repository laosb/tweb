// Runs inside page.evaluate so profile fixtures use the real browser/WASM signer.
export async function makeDCProfile({data, identitySeed, runtimeURL, now = Math.floor(Date.now() / 1000)}) {
  const {createDiem} = await import(runtimeURL);
  const diem = await createDiem();
  const seed = Uint8Array.from(identitySeed);
  try {
    return await diem.dcSetup({data, seed, device: await diem.deviceKeys.generate(), now});
  } finally {
    seed.fill(0);
  }
}
