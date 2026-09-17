import {createPublicKey} from 'node:crypto';
import {isIP} from 'node:net';
import {loadEnv} from 'vite';

/**
 * C3 is the release-time trust root, as in laosb/telegram-tt. Embed only transport
 * addresses and public RSA keys; never fetch new trust anchors in the browser.
 */
export function parseBlahServerConfig(value) {
  if(!Array.isArray(value?.dcs) || !value.dcs.length) {
    throw new Error('Blah C3 returned no DCs');
  }

  const ids = new Set();
  const dcs = value.dcs.map((dc) => {
    // Blah reserves one byte for the DC id; zero is not a routable DC.
    if(!Number.isInteger(dc.id) || dc.id < 1 || dc.id > 255 || ids.has(dc.id)) {
      throw new Error('Blah C3 returned an unsupported or duplicate DC id');
    }
    ids.add(dc.id);

    if(!Array.isArray(dc.endpoints) || !dc.endpoints.length) {
      throw new Error(`Blah DC ${dc.id} has no endpoints`);
    }
    const endpoints = dc.endpoints.map(({ip, port, wsTlsOnly}) => {
      if(typeof ip !== 'string' || !ip || (
        !isIP(ip) && !/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(ip)
      ) || !Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`Blah DC ${dc.id} has an invalid endpoint`);
      }
      const host = isIP(ip) === 6 ? `[${ip}]` : ip;
      const tls = wsTlsOnly === true || port === 443;
      return {url: new URL(`${tls ? 'wss' : 'ws'}://${host}:${port}/apiws`).href, tls};
    });
    // Prefer TLS, just like Web A. HTTPS deployments cannot dial a ws:// fallback.
    const endpoint = endpoints.find(({tls}) => tls);
    if(!endpoint) {
      throw new Error(`Blah DC ${dc.id} needs a TLS WebSocket endpoint`);
    }

    const key = createPublicKey(dc.rsaPublicKey);
    if(key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails.modulusLength !== 2048) {
      throw new Error(`Blah DC ${dc.id} needs a 2048-bit RSA public key`);
    }
    const {n, e} = key.export({format: 'jwk'});
    return {
      id: dc.id,
      url: endpoint.url,
      rsaKey: {
        modulus: Buffer.from(n, 'base64url').toString('hex'),
        exponent: Buffer.from(e, 'base64url').toString('hex')
      }
    };
  });

  return {defaultDcId: dcs[0].id, dcs};
}

/** @returns {Promise<Record<string, string>>} */
export default async function blahBuildDefines(mode, root) {
  const env = loadEnv(mode, root, '');
  if(env.VITE_BLAH !== '1') {
    return {__BLAH_CONFIG__: 'undefined'};
  }

  if(!/^[1-9]\d*$/.test(env.BLAH_API_ID || '') || !env.BLAH_API_HASH?.trim()) {
    throw new Error('Blah builds require BLAH_API_ID and BLAH_API_HASH from your C3 application');
  }
  const url = new URL(env.BLAH_SERVER_CONFIG_URL);
  if(url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('BLAH_SERVER_CONFIG_URL must be an HTTPS URL without credentials');
  }
  const response = await fetch(url, {redirect: 'error', signal: AbortSignal.timeout(15_000)});
  if(!response.ok) {
    throw new Error(`Blah C3 request failed: HTTP ${response.status}`);
  }
  const config = parseBlahServerConfig(await response.json());

  return {
    __BLAH_CONFIG__: JSON.stringify(config),
    ...Object.fromEntries(Object.entries({
      VITE_API_ID: env.BLAH_API_ID,
      VITE_API_HASH: env.BLAH_API_HASH,
      // Never inherit Telegram's push key or its HTTP fallback from .env.
      VITE_PUSH_SERVER_KEY: env.BLAH_VAPID_PUBLIC_KEY || '',
      VITE_MTPROTO_HAS_WS: '1',
      VITE_MTPROTO_HAS_HTTP: '',
      VITE_MTPROTO_AUTO: '',
      VITE_MTPROTO_HTTP: '',
      VITE_MTPROTO_HTTP_UPLOAD: ''
    }).map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)]))
  };
}

/** @returns {import('vite').Plugin} */
export function blahPlugin(root) {
  return {
    name: 'blah-config',
    async config(_config, {mode}) {
      return {define: await blahBuildDefines(mode, root)};
    }
  };
}
