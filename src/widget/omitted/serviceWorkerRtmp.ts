// Calls cannot be opened in a widget. Keep the SW's fetch-event contract: a
// returned Response alone would leave the intercepted request unanswered.
export function onRtmpFetch(event: FetchEvent, _params: string, _search: string) {
  event.respondWith(new Response(null, {status: 404}));
}

export function onRtmpLeftCall(_call: [Long, boolean]) {}
