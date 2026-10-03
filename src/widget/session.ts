import bytesToHex from '@helpers/bytes/bytesToHex';
import {validateConfig, type WidgetConfig} from '@/widget/config';

export type SessionSnapshot = {
  version: 1,
  config: WidgetConfig,
  tokenDigest: string,
  authKey: string,
  salt: string,
  timeOffset: number
};

export interface WidgetSession {
  authenticate(token: string): Promise<void>;
  logout(): Promise<void>;
  destroy(): void;
}

export function readSnapshot(value: string | null): SessionSnapshot | undefined {
  if(!value) return;
  const snapshot = JSON.parse(value) as SessionSnapshot;
  validateConfig(snapshot.config);
  if(snapshot.version !== 1 || !/^[\da-f]{64}$/.test(snapshot.tokenDigest) ||
    !/^[\da-f]{512}$/.test(snapshot.authKey) || !/^[\da-f]{16}$/.test(snapshot.salt) ||
    !Number.isFinite(snapshot.timeOffset)) throw new Error('WIDGET_SESSION_INVALID');
  return snapshot;
}

/** One iframe owns one transport. Identity transitions are serialized, including
 * transitions during login. Old history is hidden synchronously by the caller. */
export class WidgetSessionController<T extends WidgetSession> {
  private sequence = Promise.resolve();
  private generation = 0;
  private transportGeneration = 0;
  private current?: T;
  private ready = false;

  constructor(
    private snapshot: SessionSnapshot | undefined,
    private save: (snapshot?: SessionSnapshot) => void,
    private create: (config: WidgetConfig, digest: string, snapshot: SessionSnapshot | undefined,
      save: (snapshot: SessionSnapshot) => void) => T
  ) {}

  get active() { return this.ready ? this.current : undefined; }

  replace(config: WidgetConfig | undefined, token: string | undefined): Promise<T | undefined> {
    const generation = ++this.generation;
    this.ready = false;
    const operation = this.sequence.then(async() => {
      if(generation !== this.generation) return;
      const digest = token && bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))));
      if(generation !== this.generation) return;
      const compatible = config && token && this.snapshot?.tokenDigest === digest &&
        JSON.stringify(this.snapshot.config) === JSON.stringify(config);
      if(!compatible && this.snapshot) {
        const current = this.current ?? this.createCurrent(this.snapshot.config, this.snapshot.tokenDigest);
        try {
          await current.logout();
          if(this.current === current) this.persist(undefined);
        } finally {
          if(this.current === current) this.destroyCurrent();
        }
      }
      if(!config || !token || generation !== this.generation) return;
      // A retry replaces a possibly disconnected transport using the saved key.
      this.destroyCurrent();
      const current = this.createCurrent(config, digest);
      try {
        // Revalidate even a restored key: a revoked token must never restore UI.
        await current.authenticate(token);
        if(generation !== this.generation) return;
        this.ready = true;
        return current;
      } catch(error) {
        if(this.current !== current) return;
        // Keep a failed logout's snapshot so retry/reload can finish revocation.
        try {
          await current.logout();
          if(this.current === current) this.persist(undefined);
        } catch{}
        if(this.current !== current) return;
        this.destroyCurrent();
        throw error;
      }
    });
    this.sequence = operation.then(() => {}, () => {});
    return operation;
  }

  private persist = (snapshot?: SessionSnapshot) => {
    this.save(snapshot);
    this.snapshot = snapshot;
  };

  private createCurrent(config: WidgetConfig, digest: string) {
    const generation = ++this.transportGeneration;
    return this.current = this.create(config, digest, this.snapshot, (snapshot) => {
      // A destroyed transport must not overwrite a resumed session's key.
      if(generation === this.transportGeneration) this.persist(snapshot);
    });
  }

  private destroyCurrent() {
    const current = this.current;
    this.current = undefined;
    ++this.transportGeneration;
    current?.destroy();
  }

  suspend() {
    ++this.generation;
    this.ready = false;
    this.destroyCurrent();
  }
}
