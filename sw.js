// Scramjet worker entry. Served as a static file (workers can't be
// bundled). Scope is the worker's own directory: /sj/ locally (the app
// shell worker keeps root scope; longest-prefix match routes /sj/** here)
// or /gh/<repo>@<pin>/sj/ on the CDN mirrors. See src/lib/scramjet.ts.
//
// Mirror fallback: try the sibling bundle first (dev/prod/full mirror),
// then the pinned npm copy across CDN hosts. The last working import wins;
// a total miss fails install loudly.
let __sjOk = false;
try {
  importScripts("./controller.sw.js");
  __sjOk =
    typeof $scramjetController !== "undefined" &&
    !!$scramjetController.shouldRoute;
} catch (e) {
  __sjOk = false;
}
if (!__sjOk) {
  const __sjHosts = [
    "https://cdn.jsdelivr.net",
    "https://fastly.jsdelivr.net",
    "https://origin-fastly.jsdelivr.net",
  ];
  const __sjFile =
    "/npm/@mercuryworkshop/scramjet-controller@0.0.14/dist/controller.sw.js";
  let __sjErr = null;
  for (const __sjHost of __sjHosts) {
    try {
      importScripts(__sjHost + __sjFile);
      __sjOk =
        typeof $scramjetController !== "undefined" &&
        !!$scramjetController.shouldRoute;
      if (__sjOk) break;
    } catch (e2) {
      __sjErr = e2;
    }
  }
  if (!__sjOk) throw __sjErr || new Error("no scramjet worker bundle reachable");
}

addEventListener("fetch", (e) => {
  if ($scramjetController.shouldRoute(e)) {
    e.respondWith($scramjetController.route(e));
  }
});

// Take control of already-open documents on first install, so a fresh
// visit is proxied immediately instead of waiting for a navigation.
// Harmless where the controller bundle manages its own lifecycle — claim
// only affects documents under this worker's scope.
addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      try {
        await self.clients.claim();
      } catch {
        // Older browsers proceed uncontrolled; callers reload once.
      }
    })(),
  );
});
