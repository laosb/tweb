// NOTICE: This is auto-generated code by BridgeJS from JavaScriptKit,
// DO NOT EDIT.
//
// To update this file, just rebuild your project or run
// `swift package bridge-js`.

/**
 * All identifiers and timestamps are decimal strings; absent fields are nil.
 */
export interface ChallengeInfo {
    kind: string;
    dc: number[];
    dcDomain: string | null;
    domain: string | null;
    nonce: number[];
    expiresAt: string;
    operation: string | null;
    keyID: string | null;
    sessionID: string | null;
    identityID: number[] | null;
    deviceID: number[] | null;
    profileDigest: number[] | null;
    appID: string | null;
    appName: string | null;
    appVersion: string | null;
    redirectURI: string | null;
    scopes: string[] | null;
    codeChallenge: string | null;
    state: string | null;
    oidcNonce: string | null;
    revision: string | null;
    document: number[] | null;
    requestID: number[] | null;
    externalID: string | null;
    previousExternalID: string | null;
    label: string | null;
}
export interface DCSetupRequest {
    data: number[];
    serverDevice: number[];
    profile: number[] | null;
    now: number;
}
export interface DCSetupResult {
    id: string;
    profile: number[];
    expiresAt: number;
    devices: DeviceInfo[];
}
/**
 * Decimal strings preserve 64-bit identifiers across the JavaScript boundary.
 */
export interface IdentityRequest {
    operation: string;
    domain: string;
    profile: number[];
    now: number;
    dc: number[];
    dcDomain: string;
    generation: string;
    account: string | null;
    device: number[] | null;
    challenge: number[] | null;
    query: number[] | null;
    keyID: string | null;
    sessionID: string | null;
    expiresAt: number | null;
    kind: string;
    challengeKind: string | null;
    approvedChallenge: number[] | null;
}
export interface DeviceInfo {
    id: string;
    key: number[];
    current: boolean;
}
export interface IdentityResult {
    id: string;
    namespace: string;
    profile: number[];
    proof: number[];
    account: string;
    expiresAt: number;
    devices: DeviceInfo[];
}
export type Exports = {
    /**
     * Decodes a DC challenge for the caller to compare with its session or display for consent.
     */
    inspectChallenge(kind: string, encoding: number[]): ChallengeInfo;
    /**
     * Creates or renews a DC identity and certifies the server's separate signing device.
     */
    dcSetup(input: DCSetupRequest, crypto: any): Promise<DCSetupResult>;
    identityOperation(input: IdentityRequest, crypto: any): Promise<IdentityResult>;
}
export type Imports = {
}
export function createInstantiator(options: {
    imports: Imports;
}, swift: any): Promise<{
    addImports: (importObject: WebAssembly.Imports) => void;
    setInstance: (instance: WebAssembly.Instance) => void;
    createExports: (instance: WebAssembly.Instance) => Exports;
}>;