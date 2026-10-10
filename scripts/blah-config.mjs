import {createPublicKey} from 'node:crypto';
import {isIP} from 'node:net';
import {readFileSync} from 'node:fs';
import {loadEnv} from 'vite';
import blahBrandingPlugin from './blah-branding.mjs';

const domainNamePattern = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Keep the release path pinned while allowing an operator's HTTPS CDN hostname. */
export function blahDiemRuntimeURL(cdnHost = '') {
  const host = (cdnHost || 'bd-cdn.blahim.com').toLowerCase();
  if(host.trim() !== host || host.length > 253 || !domainNamePattern.test(host)) {
    throw new Error('BLAH_DIEM_CDN_HOST must be a DNS hostname without a scheme, port or path');
  }
  return `https://${host}/bd-web/20261010-5cb5/diem.js`;
}

/**
 * Legacy operator bootstrap parser. Domain discovery uses verified profiles at runtime.
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
  const runtime = {
    __BLAH_DIEM_RUNTIME_URL__: JSON.stringify(blahDiemRuntimeURL(env.BLAH_DIEM_CDN_HOST)),
    __BLAH_WIDGET__: JSON.stringify(mode === 'widget')
  };
  if(mode === 'widget') {
    // The support widget reads its DC and application pins from its own index.html.
    return {...runtime, __BLAH_CONFIG__: 'undefined', ...blahTransportDefines('', '', '')};
  }
  if(env.VITE_BLAH !== '1') {
    return {...runtime, __BLAH_CONFIG__: 'undefined'};
  }

  if(!/^[1-9]\d*$/.test(env.BLAH_API_ID || '') || !env.BLAH_API_HASH?.trim()) {
    throw new Error('Blah builds require BLAH_API_ID and BLAH_API_HASH from your home DC application');
  }
  let config;
  if(env.BLAH_BOOTSTRAP_FILE) {
    config = parseBlahBootstrap(JSON.parse(readFileSync(env.BLAH_BOOTSTRAP_FILE, 'utf8')));
  } else if(env.BLAH_SERVER_CONFIG_URL) {
    const url = new URL(env.BLAH_SERVER_CONFIG_URL);
    if(url.protocol !== 'https:' || url.username || url.password) {
      throw new Error('BLAH_SERVER_CONFIG_URL must be an HTTPS URL without credentials');
    }
    const response = await fetch(url, {redirect: 'error', signal: AbortSignal.timeout(15_000)});
    if(!response.ok) {
      throw new Error(`Blah bootstrap request failed: HTTP ${response.status}`);
    }
    config = parseBlahBootstrap(await response.json());
  } else {
    config = {discovery: true, defaultDcId: 1, dcs: []};
  }

  return {
    ...runtime,
    __BLAH_CONFIG__: JSON.stringify(config),
    ...blahTransportDefines(env.BLAH_API_ID, env.BLAH_API_HASH, env.BLAH_VAPID_PUBLIC_KEY || '')
  };
}

function blahTransportDefines(apiId, apiHash, pushServerKey) {
  return Object.fromEntries(Object.entries({
    VITE_API_ID: apiId,
    VITE_API_HASH: apiHash,
    // Never inherit Telegram's push key or its HTTP fallback from .env.
    VITE_PUSH_SERVER_KEY: pushServerKey,
    VITE_MTPROTO_HAS_WS: '1',
    VITE_MTPROTO_HAS_HTTP: '',
    VITE_MTPROTO_AUTO: '',
    VITE_MTPROTO_HTTP: '',
    VITE_MTPROTO_HTTP_UPLOAD: ''
  }).map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)]));
}

/** An operator-provided trust anchor for one independent home, never a directory. */
export function parseBlahBootstrap(value) {
  const config = parseBlahServerConfig(value);
  const home = value.home;
  if(config.dcs.length !== 1 || config.defaultDcId !== 1 ||
    typeof home?.domain !== 'string' || home.domain.length > 253 ||
    !domainNamePattern.test(home.domain) ||
    !/^[a-f0-9]{64}$/.test(home?.identity || '') || typeof home?.generation !== 'string' ||
    !/^[1-9][0-9]*$/.test(home?.generation || '') || BigInt(home.generation) > 9223372036854775807n) {
    throw new Error('Blah bootstrap requires one DC1 and a pinned home domain, identity and generation');
  }
  return {...config, home: {domain: home.domain, identity: home.identity, generation: home.generation}};
}

/** @returns {import('vite').Plugin[]} */
export function blahPlugin(root) {
  return [{
    name: 'blah-config',
    async config(_config, {mode}) {
      return {
        define: await blahBuildDefines(mode, root),
        worker: {plugins: () => [blahBrandingPlugin(root)]}
      };
    }
  }, blahBrandingPlugin(root)];
}
