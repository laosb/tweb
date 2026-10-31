// Workers and players read these shapes even with diagnostic collection disabled.
export function readThreadMemory(thread: string) { return {thread}; }
export function createPeakRecorder() { return {events: [] as never[], observe() {}, reset() {}}; }
export function canvasBytes() { return 0; }
