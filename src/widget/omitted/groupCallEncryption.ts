// Calls are off in the widget, so it ships without group calls' encryption worker.
export class EncryptWorkerHost {
  constructor() {
    throw new Error('Group calls are not available in the support widget');
  }
}
