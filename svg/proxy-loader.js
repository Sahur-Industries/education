// proxy-loader.js — gate + launcher for proxy.svg / browse.svg.
// Fetched at runtime from CDN mirrors (see template) and injected as a
// classic script. Plain JS, no imports, no modules: must run unmodified
// inside an SVG document.
(function () {
  // Baked by build-proxy-svg.py; also readable for debugging.
  var APP_URL = "https://studyhall-discussion.web.app";

  function appUrl() {
    var sameOriginOk = false;
    try {
      sameOriginOk =
        /^https?:$/.test(location.protocol) &&
        location.origin !== "null" &&
        !/jsdelivr/i.test(location.hostname || "") &&
        !/^cdn\./i.test(location.hostname || "");
    } catch (e) {}
    var root = sameOriginOk
      ? location.origin.replace(/\/$/, "")
      : APP_URL.replace(/\/$/, "");
    try {
      var forced = new URLSearchParams(location.search).get("app");
      if (forced && /^https?:\/\//i.test(forced)) root = forced.replace(/\/$/, "");
    } catch (e2) {}
    // #svg marks SVG-launched context (namespaced storage, public relay).
    return root + "/?cloaked=1&page=proxy#svg";
  }

  function showError(msg) {
    try {
      var err = document.getElementById("gateerror");
      if (err) {
        err.textContent = msg;
        err.style.display = "block";
      }
    } catch (e) {}
  }

  function openProxy() {
    var btn = null;
    try {
      btn = document.getElementById("gatebtn");
      if (btn) btn.disabled = true;
    } catch (e) {}
    var tab = null;
    try {
      tab = window.open(appUrl(), "_blank");
    } catch (e2) {
      tab = null;
    }
    try {
      if (btn) btn.disabled = false;
    } catch (e3) {}
    if (!tab) {
      showError("Popup blocked — allow popups for this site, then try again.");
      return;
    }
    try {
      tab.focus();
    } catch (e4) {}
    try {
      location.replace("https://www.deltamath.com/");
    } catch (e5) {}
  }

  function init() {
    try {
      document.getElementById("gatebtn").addEventListener("click", openProxy);
    } catch (e) {}
    try {
      document.title = "Browse";
    } catch (e2) {}
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
