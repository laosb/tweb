// ChatInput constructs these together. Do not register with the controller or
// create a suggestion panel; mention and command helpers have boolean contracts.
export default class OmittedAutocompleteHelper {
  hidden = true;
  addSibling() {}
  attachStickersHelper() {}
  checkEmoticon() {}
  checkQuery() { return Promise.resolve({user: {}, renderPromise: Promise.resolve()}); }
  toggle() {}
}
