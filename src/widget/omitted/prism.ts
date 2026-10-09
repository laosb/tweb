// Code blocks render as plain text: the widget ships without syntax highlighting.
// Stands in for src/vendor/prism.ts with the part src/codeLanguages.ts uses.
const encode = (code: string) => code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/ /g, ' ');

export default {
  languages: new Proxy({}, {get: () => ({})}),
  hooks: {add() {}},
  highlight: encode
};
