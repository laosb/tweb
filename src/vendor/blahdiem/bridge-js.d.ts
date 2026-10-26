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
export interface DCEndpointInfo {
    host: string;
    port: number;
    tls: boolean;
    transport: string;
    path: string | null;
}
export interface DCDiscoveryResult {
    id: string;
    generation: string;
    revision: string;
    digest: string;
    namespaceGeneration: string;
    expiresAt: string;
    endpoints: DCEndpointInfo[];
    transportPublicKey: string;
}
export interface DCSetupRequest {
    data: number[];
    profile: number[] | null;
    now: number;
    profileLifetime: number;
    deviceLifetime: number;
}
export interface DCSetupResult {
    id: string;
    profile: number[];
    expiresAt: number;
    devices: DeviceInfo[];
}
export interface DeviceLinkInspection {
    device: number[];
    label: string;
    verifies: number[];
}
export interface DeviceLinkBeginning {
    request: number[];
    parameter: string;
    session: string;
}
export interface DeviceLinkOpening {
    profile: number[];
    domain: string;
    identityKey: boolean;
    metadata: number[] | null;
    keyFileContents: number[];
}
export interface DeviceLinkApproval {
    parameter: string;
    request: number[];
    profile: number[];
    domain: string;
    transferIdentity: boolean;
    metadata: number[] | null;
    now: number;
}
export interface HostingWorkInfo {
    algorithm: string;
    baseBits: number;
    bitsPerShorterCharacter: number;
    referenceLength: number;
}
export interface HostingPolicyInfo {
    domain: string;
    labelPattern: string;
    maxClaimsPerIdentity: number;
    maxUpdatesPerIdentityPerHour: number;
    claimGraceAfterExpiry: number;
    proofOfWork: HostingWorkInfo;
}
export interface HostingPuzzleInfo {
    label: string;
    input: number[];
    requiredBits: number;
}
export interface HostingNameInfo {
    label: string;
    status: string;
    requiredBits: number | null;
    puzzle: HostingPuzzleInfo | null;
}
export interface HostingProofInfo {
    label: string;
    nonce: number[];
}
export interface HostingPublishedInfo {
    identity: string;
    revision: string;
    domains: string[];
}
export interface KeyFileInfo {
    id: string;
    salt: number[];
}
export interface KeyFilePayload {
    profile: number[];
    identity: number[] | null;
    device: number[] | null;
    domain: string;
    publisher: string;
    token: string;
    profileDays: number;
    deviceDays: number;
    autoRenew: boolean;
    publicationPending: boolean;
    hostingDomain: string | null;
    hostingHeld: string[];
    hostingProofs: HostingProofInfo[];
}
/**
 * A paper device key's canonical words, the Ed25519 seed WebCrypto signs with and the
 * encoded Diem device public key to certify.
 */
export interface PaperKeyResult {
    phrase: string;
    seed: number[];
    device: number[];
}
/**
 * Public profile facts. Decimal strings preserve all wire integers exactly.
 */
export interface ProfileInfo {
    id: string;
    kind: string;
    generation: string;
    revision: string;
    notBefore: string;
    expiresAt: string;
    lapsed: boolean;
    domains: string[];
    home: ProfileHomeInfo | null;
}
export interface ProfileHomeInfo {
    dc: string;
    account: string | null;
    epoch: string;
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
    profileLifetime: number;
    deviceLifetime: number;
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
    domains: string[] | null;
}
export interface DeviceInfo {
    id: string;
    key: number[];
    current: boolean;
    notBefore: number;
    expiresAt: number;
}
export interface IdentityResult {
    id: string;
    namespace: string;
    domains: string[];
    profile: number[];
    proof: number[];
    account: string;
    notBefore: number;
    expiresAt: number;
    devices: DeviceInfo[];
}
export type Exports = {
    /**
     * Decodes a DC challenge for the caller to compare with its session or display for consent.
     */
    inspectChallenge(kind: string, encoding: number[]): ChallengeInfo;
    /**
     * Verifies public discovery bytes without requesting any private key material.
     */
    verifyDCProfile(domain: string, encoding: number[], now: number, crypto: any): Promise<DCDiscoveryResult>;
    /**
     * Creates or renews a DC profile entirely in the operator's browser.
     */
    dcSetup(input: DCSetupRequest, crypto: any): Promise<DCSetupResult>;
    inspectDeviceLink(parameter: string, request: number[]): DeviceLinkInspection;
    destroyDeviceLink(session: string): void;
    beginDeviceLink(label: string, crypto: any): Promise<DeviceLinkBeginning>;
    openDeviceLink(session: string, response: number[], expectedDC: number[], now: number): Promise<DeviceLinkOpening>;
    respondToDeviceLink(input: DeviceLinkApproval, keyFile: number[], crypto: any): Promise<number[]>;
    hostingPolicy(domain: string, callbacks: any): Promise<HostingPolicyInfo>;
    hostingPlan(domain: string, labels: string[], identity: number[], callbacks: any): Promise<HostingNameInfo[]>;
    hostingPublish(domain: string, encoding: number[], via: string | null, proofs: HostingProofInfo[], solve: boolean, callbacks: any): Promise<HostingPublishedInfo>;
    keyFileInfo(encoding: number[]): KeyFileInfo;
    sealKeyFile(input: KeyFilePayload, salt: number[], crypto: any): Promise<number[]>;
    /**
     * Installs native custody bytes returned by device linking without exporting individual keys.
     */
    sealKeyFileContents(encoding: number[], salt: number[], crypto: any): Promise<number[]>;
    openKeyFile(encoding: number[], crypto: any): Promise<KeyFilePayload>;
    /**
     * The paper key that 32 bytes of random `entropy` encode.
     */
    newPaperKey(entropy: number[], crypto: any): Promise<PaperKeyResult>;
    /**
     * The paper key that written words encode; checks the word list, count and checksum.
     */
    paperKey(phrase: string, crypto: any): Promise<PaperKeyResult>;
    /**
     * Verifies public profiles without a discovery domain or any private keys.
     */
    verifyProfile(encoding: number[], now: number, crypto: any): Promise<ProfileInfo>;
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