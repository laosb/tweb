// NOTICE: This is auto-generated code by BridgeJS from JavaScriptKit,
// DO NOT EDIT.
//
// To update this file, just rebuild your project or run
// `swift package bridge-js`.

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