// appImManager appends the returned container. An empty fragment leaves no UI,
// playback listeners or floating-height reservation; inline media still plays.
export default function createChatAudio() {
  return {container: document.createDocumentFragment(), destroy() {}};
}
