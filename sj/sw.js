// Scramjet worker entry. Served as a static file (workers can't be
// bundled). Scope is the worker's own directory: /sj/ locally (the app
// shell worker keeps root scope; longest-prefix match routes /sj/** here)
// or /gh/<repo>@<pin>/sj/ on the CDN mirrors. See src/lib/scramjet.ts.
//
// Mirror fallback (same pattern as the reference kit): try the sibling
// bundle first (dev/prod/full mirror), then the pinned npm copy. The last
// working import wins; a total miss fails install loudly.
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
  importScripts(
    "https://cdn.jsdelivr.net/npm/@mercuryworkshop/scramjet-controller@0.0.14/dist/controller.sw.js",
  );
}

addEventListener("fetch", (e) => {
  if ($scramjetController.shouldRoute(e)) {
    e.respondWith($scramjetController.route(e));
  }
});
