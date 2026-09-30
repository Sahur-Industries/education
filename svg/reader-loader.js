// reader-loader.js — vanilla in-SVG reader proxy (no React, no iframes,
// no new tabs). Fetched at runtime from CDN mirrors (see reader.svg) and
// injected as a classic script. Plain JS, no imports, no modules.
  // Self-contained reader proxy (no React, no iframes, no new tabs).
  // Pages are fetched through public CORS relays, rewritten (scripts
  // stripped, base retargeted, links/forms captured), and injected into
  // the content div. JS-heavy apps can't run here by design — Chromium
  // never navigates iframes inside SVG documents, so this reader is the
  // most proxy that can physically live inside an SVG file.
  var WISP_URL = "wss://definitelyscience.com/wisp/";
  var WISP_TIMEOUT_MS = 12000;
  // Named mirror list (cors.lol was dropped — it sends no ACAO header,
  // so browsers refuse it outright; cors.eu.org takes the raw URL as
  // path, the rest take an encoded ?url=/quest). The winning base is
  // exposed as window.relayBase for subsequent loads.
  var RELAYS = [
    { name: "allorigins", build: function (t) { return "https://api.allorigins.win/raw?url=" + encodeURIComponent(t); } },
    { name: "codetabs", build: function (t) { return "https://api.codetabs.com/v1/proxy?quest=" + encodeURIComponent(t); } },
    { name: "corseu", build: function (t) { return "https://cors.eu.org/" + t; } }
  ];
  window.relayBase = null;
  var RELAY_TIMEOUT_MS = 20000;
  var ENGINE = "https://html.duckduckgo.com/html/?q=";
  var backStack = [];
  var fwdStack = [];
  var currentUrl = null;

  function normalizeUrl(input) {
    var t = (input || "").trim();
    if (!t) return null;
    if (/^https?:\/\//i.test(t)) return t;
    if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/i.test(t)) return "https://" + t;
    return ENGINE + encodeURIComponent(t);
  }

  function fetchViaWisp(target) {
    // Minimal WISP client (packet layout from wisp-js): CONNECT a TCP
    // stream, speak raw HTTP/1.0, collect DATA until CLOSE.
    // Hard limit, stated plainly: WISP carries TCP bytes, and the web is
    // https — TLS can't be done in vanilla page JS, so only plain-http
    // URLs can go through the relay. Everything else rejects instantly
    // and falls through to the CORS race below.
    return new Promise(function (resolve, reject) {
      var u;
      try {
        u = new URL(target);
      } catch (e) {
        reject(e);
        return;
      }
      if (u.protocol !== "http:") {
        reject(new Error("wisp is TCP-only; https needs TLS"));
        return;
      }
      var host = u.hostname;
      var port = u.port ? parseInt(u.port, 10) : 80;
      var path = (u.pathname || "/") + (u.search || "");
      var ws = null;
      var done = false;
      var streamId = 1;
      var gotContinue = false;
      var stash = new Uint8Array(0);
      var chunks = [];
      var timer = setTimeout(function () { fail(new Error("wisp timeout")); }, WISP_TIMEOUT_MS);
      function cleanup() {
        clearTimeout(timer);
        try { if (ws) ws.close(); } catch (e) {}
      }
      function fail(err) {
        if (done) return;
        done = true;
        cleanup();
        reject(err);
      }
      function win(text) {
        if (done) return;
        done = true;
        cleanup();
        try { window.__fetchVia = "wisp"; } catch (e) {}
        resolve(text);
      }
      function sendPacket(type, payload) {
        var b = new Uint8Array(5 + payload.length);
        b[0] = type;
        b[1] = streamId & 255;
        b[2] = (streamId >> 8) & 255;
        b[3] = (streamId >> 16) & 255;
        b[4] = (streamId >>> 24) & 255;
        b.set(payload, 5);
        ws.send(b);
      }
      function sendConnect() {
        var hb = new TextEncoder().encode(host);
        var p = new Uint8Array(3 + hb.length);
        p[0] = 1; // TCP
        p[1] = port & 255;
        p[2] = (port >> 8) & 255;
        p.set(hb, 3);
        sendPacket(1, p); // CONNECT
      }
      function sendHttp() {
        var req = "GET " + path + " HTTP/1.0\r\n" +
          "Host: " + host + "\r\n" +
          "User-Agent: Mozilla/5.0\r\n" +
          "Accept: text/html,application/xhtml+xml\r\n" +
          "Connection: close\r\n\r\n";
        sendPacket(2, new TextEncoder().encode(req)); // DATA
      }
      function onPacket(type, sid, payload) {
        if (sid !== 0 && sid !== streamId) return;
        if (type === 3) { // CONTINUE — server opened the window
          if (sid === streamId && !gotContinue) {
            gotContinue = true;
            try { sendHttp(); } catch (e) { fail(e); }
          }
          return;
        }
        if (type === 2) { // DATA
          if (sid === streamId) chunks.push(payload);
          return;
        }
        if (type === 4) { // CLOSE — stream done, assemble body
          var total = 0, i;
          for (i = 0; i < chunks.length; i++) total += chunks[i].length;
          var all = new Uint8Array(total);
          var off = 0;
          for (i = 0; i < chunks.length; i++) { all.set(chunks[i], off); off += chunks[i].length; }
          var text = "";
          try { text = new TextDecoder().decode(all); } catch (e) { fail(e); return; }
          var cut = text.indexOf("\r\n\r\n");
          win(cut >= 0 ? text.slice(cut + 4) : text);
          return;
        }
        // INFO (0x05) and anything else: ignore.
      }
      function onBytes(arr) {
        var nb = new Uint8Array(stash.length + arr.length);
        nb.set(stash, 0);
        nb.set(arr, stash.length);
        stash = nb;
        // Parse: type u8 | stream u32LE | payload (fixed by type, DATA/INFO = rest).
        while (stash.length >= 5) {
          var type = stash[0];
          var sid = stash[1] | (stash[2] << 8) | (stash[3] << 16) | (stash[4] * 16777216);
          var bodyLen;
          if (type === 3) bodyLen = 4;       // CONTINUE
          else if (type === 4) bodyLen = 1;  // CLOSE
          else bodyLen = stash.length - 5;   // DATA / INFO / CONNECT-echo: rest
          if (type !== 3 && type !== 4 && stash.length <= 5) break; // need more
          var payload = stash.slice(5, 5 + bodyLen);
          stash = stash.slice(5 + bodyLen);
          try { onPacket(type, sid >>> 0, payload); } catch (e) { fail(e); return; }
          if (done) return;
        }
      }
      try {
        ws = new WebSocket(WISP_URL);
      } catch (e) {
        fail(e);
        return;
      }
      ws.binaryType = "arraybuffer";
      ws.onopen = function () { try { sendConnect(); } catch (e) { fail(e); } };
      ws.onmessage = function (ev) {
        try {
          var arr = ev.data instanceof ArrayBuffer
            ? new Uint8Array(ev.data)
            : new Uint8Array([]);
          if (!arr.length) return;
          onBytes(arr);
        } catch (e) { fail(e); }
      };
      ws.onerror = function () { fail(new Error("wisp socket error")); };
      ws.onclose = function () {
        // Server hung up mid-stream with content already collected.
        if (!done && chunks.length) {
          try {
            var total = 0, i;
            for (i = 0; i < chunks.length; i++) total += chunks[i].length;
            var all = new Uint8Array(total);
            var off = 0;
            for (i = 0; i < chunks.length; i++) { all.set(chunks[i], off); off += chunks[i].length; }
            var text = new TextDecoder().decode(all);
            var cut = text.indexOf("\r\n\r\n");
            win(cut >= 0 ? text.slice(cut + 4) : text);
          } catch (e) { fail(e); }
        } else if (!done) {
          fail(new Error("wisp closed early"));
        }
      };
    });
  }

  function fetchPage(target) {
    // WISP attempt and CORS race run concurrently; first success wins.
    // https URLs reject out of the wisp path instantly (TCP-only), so
    // they cost nothing there.
    return new Promise(function (resolve, reject) {
      var pending = 2;
      var done = false;
      function win(v) {
        if (done) return;
        done = true;
        resolve(v);
      }
      function lose() {
        pending -= 1;
        if (pending === 0 && !done) reject(new Error("all relays failed"));
      }
      fetchViaWisp(target).then(win, lose);
      fetchViaRelay(target).then(
        function (v) {
          try { if (!window.__fetchVia) window.__fetchVia = "cors"; } catch (e) {}
          win(v);
        },
        lose
      );
    });
  }

  function fetchViaRelay(target) {
    // Fastest relay wins; the rest are abandoned. Each attempt times out
    // so a hung relay fails over instead of spinning forever.
    return new Promise(function (resolve, reject) {
      var pending = RELAYS.length;
      var done = false;
      RELAYS.forEach(function (entry) {
        var ctrl = null;
        var timer = null;
        try {
          if (typeof AbortController !== "undefined") {
            ctrl = new AbortController();
            timer = setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, RELAY_TIMEOUT_MS);
          }
        } catch (e) {}
        var relayUrl = "";
        try {
          relayUrl = entry.build(target);
        } catch (e2) {
          pending -= 1;
          if (pending === 0 && !done) reject(new Error("all relays failed"));
          return;
        }
        fetch(relayUrl, {
          cache: "no-store",
          signal: ctrl ? ctrl.signal : undefined
        })
          .then(function (res) {
            if (timer) clearTimeout(timer);
            if (!res.ok) throw new Error("bad status");
            return res.text().then(function (txt) {
              if (!done) {
                done = true;
                try { window.relayBase = entry.name; } catch (e3) {}
                resolve(txt);
              }
            });
          })
          .catch(function () {
            if (timer) clearTimeout(timer);
            pending -= 1;
            if (pending === 0 && !done) reject(new Error("all relays failed"));
          });
      });
    });
  }

  function setBar(url) {
    try { document.getElementById("proxyurl").value = url; } catch (e) {}
  }

  function loadingInto(box) {
    if (box) box.innerHTML = "<p style='color:#ab987e;text-align:center;margin-top:8vh;font-family:system-ui,sans-serif;'>Loading…</p>";
  }

  function showError(url, err) {
    var box = document.getElementById("proxycontent");
    if (!box) return;
    box.innerHTML = "<div style='max-width:520px;margin:8vh auto;padding:0 20px;text-align:center;color:#e4e8f4;font-family:system-ui,sans-serif;'>" +
      "<h2>Couldn't load that page</h2>" +
      "<p id='proxyerrdetail' style='color:#ab987e;font-size:0.9rem;word-break:break-all;'></p>" +
      "<button id='proxyretry' style='background:#f59e0b;border:none;border-radius:12px;color:#fff;font-weight:700;padding:10px 22px;cursor:pointer;'>Retry</button></div>";
    try {
      document.getElementById("proxyerrdetail").textContent =
        url + " (" + (err && err.message ? err.message : err) + ")";
      document.getElementById("proxyretry").onclick = function () { navigate(url); };
    } catch (e2) {}
  }

  function render(html, baseUrl) {
    var box = document.getElementById("proxycontent");
    if (!box) return;
    var parser = new DOMParser();
    var doc = parser.parseFromString(html, "text/html");
    // Scripts can't run safely out-of-origin here — strip them, and kill
    // meta refresh escapes.
    var kill = doc.querySelectorAll("script, meta[http-equiv='refresh' i]");
    for (var i = 0; i < kill.length; i++) {
      if (kill[i].parentNode) kill[i].parentNode.removeChild(kill[i]);
    }
    var title = "";
    try { title = (doc.querySelector("title") || {}).textContent || ""; } catch (e) {}
    if (title) { try { document.title = title.trim().slice(0, 80); } catch (e2) {} }
    var base = doc.querySelector("base");
    if (!base) {
      base = doc.createElement("base");
      doc.head.insertBefore(base, doc.head.firstChild);
    }
    base.setAttribute("href", baseUrl);
    box.innerHTML = "";
    var src = doc.body || doc.documentElement;
    var frag = document.createDocumentFragment();
    var kids = [];
    for (var n = src.firstChild; n; n = n.nextSibling) kids.push(n);
    for (var k = 0; k < kids.length; k++) {
      try { frag.appendChild(document.importNode(kids[k], true)); }
      catch (e3) { /* skip unimportable nodes */ }
    }
    box.appendChild(frag);
    try { box.scrollTop = 0; } catch (e4) {}
  }

  function loadInto(url, pushHist) {
    if (pushHist && currentUrl && currentUrl !== url) {
      backStack.push(currentUrl);
      fwdStack = [];
    }
    currentUrl = url;
    setBar(url);
    loadingInto(document.getElementById("proxycontent"));
    fetchPage(url).then(
      function (html) { render(html, url); },
      function (err) { showError(url, err); }
    );
  }

  function navigate(input) {
    var url = normalizeUrl(input);
    if (!url) return;
    loadInto(url, true);
  }

  function goBack() {
    if (!backStack.length) return;
    if (currentUrl) fwdStack.push(currentUrl);
    var url = backStack.pop();
    currentUrl = url;
    setBar(url);
    loadingInto(document.getElementById("proxycontent"));
    fetchPage(url).then(
      function (html) { render(html, url); },
      function (err) { showError(url, err); }
    );
  }

  function goForward() {
    if (!fwdStack.length) return;
    if (currentUrl) backStack.push(currentUrl);
    var url = fwdStack.pop();
    currentUrl = url;
    setBar(url);
    loadingInto(document.getElementById("proxycontent"));
    fetchPage(url).then(
      function (html) { render(html, url); },
      function (err) { showError(url, err); }
    );
  }

  function reloadPage() {
    if (currentUrl) {
      var u = currentUrl;
      currentUrl = null;
      fwdStack = [];
      loadInto(u, false);
    }
  }

  // Capture clicks + form submits inside proxied content so navigation
  // stays in the SVG instead of escaping.
  function trapContent() {
    var box = document.getElementById("proxycontent");
    if (!box || box.__trapped) return;
    box.__trapped = true;
    box.addEventListener("click", function (e) {
      if (e.defaultPrevented) return;
      var t = e.target;
      var a = t && t.closest ? t.closest("a[href]") : null;
      if (!a) return;
      var href = "";
      try { href = a.href; } catch (e2) { return; }
      if (!/^https?:\/\//i.test(href)) return;
      if (a.hasAttribute("download")) return;
      e.preventDefault();
      navigate(href);
    }, true);
    box.addEventListener("submit", function (e) {
      var f = e.target;
      if (!f || !f.action) return;
      e.preventDefault();
      try {
        var fd = new FormData(f);
        var qs = new URLSearchParams(fd).toString();
        var action = f.action;
        if ((f.method || "get").toLowerCase() === "get" && qs) {
          action += (action.indexOf("?") >= 0 ? "&" : "?") + qs;
        }
        navigate(action);
      } catch (e3) { /* keep the page as-is on weird forms */ }
    }, true);
  }

  function startPage() {
    var box = document.getElementById("proxycontent");
    if (!box) return;
    box.innerHTML = "<div style='max-width:520px;margin:10vh auto;padding:0 20px;text-align:center;font-family:system-ui,sans-serif;'>" +
      "<div style='font-weight:800;font-size:2rem;color:#f59e0b;margin-bottom:8px;'>Browse</div>" +
      "<p style='color:#ab987e;font-size:0.9rem;'>Type an address above, or try one of these:</p>" +
      "<button data-u='https://example.com' style='display:block;width:100%;margin:6px 0;background:rgba(255,170,100,0.12);border:1px solid rgba(255,170,100,0.3);border-radius:12px;color:#faf1e4;padding:10px;cursor:pointer;font-size:0.9rem;'>example.com</button>" +
      "<button data-u='https://en.wikipedia.org' style='display:block;width:100%;margin:6px 0;background:rgba(255,170,100,0.12);border:1px solid rgba(255,170,100,0.3);border-radius:12px;color:#faf1e4;padding:10px;cursor:pointer;font-size:0.9rem;'>en.wikipedia.org</button>" +
      "<button data-u='https://duckduckgo.com' style='display:block;width:100%;margin:6px 0;background:rgba(255,170,100,0.12);border:1px solid rgba(255,170,100,0.3);border-radius:12px;color:#faf1e4;padding:10px;cursor:pointer;font-size:0.9rem;'>duckduckgo.com</button></div>";
    try {
      var btns = box.querySelectorAll("button[data-u]");
      for (var i = 0; i < btns.length; i++) {
        (function (b) {
          b.onclick = function () { navigate(b.getAttribute("data-u")); };
        })(btns[i]);
      }
    } catch (e) {}
  }

  function init() {
    try {
      // Public handle (debugging + parity with the reference kit, which
      // exposes its loader API on window). The loader runs scoped via
      // `new Function`, so without this nothing outside can drive it.
      try {
        window.proxyNav = { go: navigate, back: goBack, fwd: goForward, reload: reloadPage };
      } catch (e0) {}
      // Toolbar wiring lives here (not inline): this file runs scoped via
      // `new Function`, so template markup uses data attributes.
      var acts = { back: goBack, forward: goForward, reload: reloadPage };
      var btns = document.querySelectorAll("button[data-act]");
      for (var i = 0; i < btns.length; i++) {
        (function (b) {
          var fn = acts[b.getAttribute("data-act")];
          if (fn) b.addEventListener("click", function (e) { e.preventDefault(); fn(); });
        })(btns[i]);
      }
      var form = document.getElementById("proxyform");
      if (form) {
        form.addEventListener("submit", function (e) {
          e.preventDefault();
          navigate(document.getElementById("proxyurl").value);
        });
      }
      trapContent();
      startPage();
      try { document.title = "Browse"; } catch (e) {}
    } catch (e) {}
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
