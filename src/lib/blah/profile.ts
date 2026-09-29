const maximumProfileBytes = 100_000;

export async function fetchProfile(domain: string): Promise<Uint8Array> {
  const response = await fetch(`https://${domain}/.well-known/blah/profile.cbor`, {
    credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer',
    headers: {Accept: 'application/cbor'}, signal: AbortSignal.timeout(15_000)
  });
  if(response.status === 404) { await response.body?.cancel(); return undefined; }
  if(!response.ok) throw new Error('Profile request failed: HTTP ' + response.status);
  if(response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/cbor') {
    await response.body?.cancel();
    throw new Error('The domain must serve its profile as application/cbor.');
  }
  if(Number(response.headers.get('content-length')) > maximumProfileBytes) {
    await response.body?.cancel();
    throw new Error('Profile is too large.');
  }
  const reader = response.body?.getReader();
  if(!reader) throw new Error('The domain returned an empty profile.');
  const bytes = new Uint8Array(maximumProfileBytes);
  let size = 0;
  try {
    while(true) {
      const {done, value} = await reader.read();
      if(done) return bytes.slice(0, size);
      if(size + value.length > maximumProfileBytes) throw new Error('Profile is too large.');
      bytes.set(value, size);
      size += value.length;
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

