/* ============================================================
   Wetalk - shared UI helpers (window.WetalkUI)

   Loaded after js/auth.js. Every helper is defensive: if
   WetalkAuth is missing (or a page loads ui.js without auth),
   nothing throws and the page keeps working.
   ============================================================ */
(function (global) {
  "use strict";

  var doc = global.document;

  function auth() { return global.WetalkAuth || null; }

  function ready(fn) {
    if (!doc) return;
    if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  function prefersReducedMotion() {
    try {
      return !!(global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches);
    } catch (e) { return false; }
  }

  function escapeHtml(value) {
    return String(value === null || value === undefined ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function initials(name) {
    var text = String(name === null || name === undefined ? "" : name).trim();
    if (!text) return "?";
    var parts = text.split(/[\s._-]+/).filter(Boolean);
    if (!parts.length) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
  }

  function getSession() {
    var a = auth();
    if (!a || typeof a.getSession !== "function") return null;
    try { return a.getSession() || null; } catch (e) { return null; }
  }

  function displayName(session) {
    var s = session || {};
    if (s.username) return String(s.username);
    if (s.email) return String(s.email).split("@")[0];
    return "there";
  }

  function isPreview() {
    var a = auth();
    if (a && typeof a.isPreviewMode === "function") {
      try { return !!a.isPreviewMode(); } catch (e) { return true; }
    }
    // No auth module or no flag exposed: the static site is in preview mode.
    return true;
  }

  function relativeTime(value) {
    var t = typeof value === "number" ? value : Date.parse(value);
    if (!t || isNaN(t)) return "";
    var diff = Date.now() - t;
    if (diff < 0) diff = 0;
    var min = Math.round(diff / 60000);
    if (min < 1) return "just now";
    if (min < 60) return min + " min ago";
    var hrs = Math.round(min / 60);
    if (hrs < 24) return hrs + (hrs === 1 ? " hour ago" : " hours ago");
    var days = Math.round(hrs / 24);
    if (days === 1) return "yesterday";
    if (days < 7) return days + " days ago";
    try { return new Date(t).toLocaleDateString(); } catch (e) { return ""; }
  }

  /* ---------- toast ---------- */
  var toastTimer = null;

  function toastElement() {
    var el = doc.getElementById("toast");
    if (!el) {
      el = doc.createElement("div");
      el.id = "toast";
      el.className = "toast";
      doc.body.appendChild(el);
    }
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    el.setAttribute("aria-atomic", "true");
    return el;
  }

  function showToast(message) {
    var el = toastElement();
    el.textContent = String(message === null || message === undefined ? "" : message);
    el.classList.add("is-visible");
    if (toastTimer) global.clearTimeout(toastTimer);
    toastTimer = global.setTimeout(function () {
      el.classList.remove("is-visible");
    }, 3400);
  }

  function toast(message) {
    // Important: auth.js delegates its toast() to WetalkUI.toast() when it
    // exists, so this function must NOT call back into WetalkAuth.toast()
    // (that would recurse forever). We always render the toast here.
    if (!doc || !doc.body) return;
    showToast(message);
  }

  /* ---------- user chip ---------- */
  function signOut() {
    var a = auth();
    if (a && typeof a.signOut === "function") {
      try { a.signOut(); return; } catch (e) { /* fall through */ }
    }
    try { global.localStorage.removeItem("wetalk.session"); } catch (e) { /* ignore */ }
    global.location.href = "index.html";
  }

  function mountUserChip(container) {
    var host = typeof container === "string" ? doc.querySelector(container) : container;
    if (!host) return null;
    host.innerHTML = "";
    host.className = "user-chip" + (host.className && host.className !== "user-chip" ? " " + host.className.replace(/\buser-chip\b/g, "").trim() : "");
    var session = getSession();

    if (!session) {
      var signIn = doc.createElement("a");
      signIn.className = "btn btn--ghost";
      signIn.href = "signin.html";
      signIn.textContent = "Sign in";
      host.appendChild(signIn);
      return host;
    }

    var name = displayName(session);
    var link = doc.createElement("a");
    link.className = "user-chip__link";
    link.href = "app.html";
    link.setAttribute("aria-label", "Open your dashboard");

    var avatar = doc.createElement("span");
    avatar.className = "avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = initials(name);

    var label = doc.createElement("span");
    label.className = "user-chip__name";
    label.textContent = name;

    link.appendChild(avatar);
    link.appendChild(label);
    host.appendChild(link);

    var out = doc.createElement("button");
    out.type = "button";
    out.className = "btn btn--ghost user-chip__out";
    out.textContent = "Sign out";
    out.addEventListener("click", signOut);
    host.appendChild(out);
    return host;
  }

  /* ---------- confirm dialog ---------- */
  function nativeConfirm(message) {
    try { return !!(global.confirm && global.confirm(message)); } catch (e) { return false; }
  }

  function confirmDialog(options) {
    var opts = options || {};
    var title = opts.title || "Are you sure?";
    var message = opts.message || "";
    var confirmText = opts.confirmText || "Confirm";
    var cancelText = opts.cancelText || "Cancel";

    return new Promise(function (resolve) {
      if (!doc || !doc.body) { resolve(nativeConfirm(message)); return; }
      var test = doc.createElement("dialog");
      if (typeof test.showModal !== "function") { resolve(nativeConfirm(message)); return; }

      var dialog = doc.createElement("dialog");
      dialog.className = "confirm-dialog";
      dialog.setAttribute("aria-labelledby", "wetalk-confirm-title");

      var body = doc.createElement("div");
      body.className = "confirm-dialog__body";

      var heading = doc.createElement("h2");
      heading.className = "confirm-dialog__title";
      heading.id = "wetalk-confirm-title";
      heading.textContent = title;

      var text = doc.createElement("p");
      text.className = "confirm-dialog__text";
      text.textContent = message;

      var actions = doc.createElement("div");
      actions.className = "confirm-dialog__actions";

      var cancel = doc.createElement("button");
      cancel.type = "button";
      cancel.className = "btn btn--secondary";
      cancel.textContent = cancelText;

      var ok = doc.createElement("button");
      ok.type = "button";
      ok.className = "btn btn--primary";
      ok.textContent = confirmText;

      var settled = false;
      function finish(value) {
        if (settled) return;
        settled = true;
        try { if (dialog.open) dialog.close(); } catch (e) { /* ignore */ }
        try { dialog.remove(); } catch (e) { /* ignore */ }
        resolve(value);
      }

      cancel.addEventListener("click", function () { finish(false); });
      ok.addEventListener("click", function () { finish(true); });
      dialog.addEventListener("cancel", function (e) {
        if (e && e.preventDefault) e.preventDefault();
        finish(false);
      });
      dialog.addEventListener("click", function (e) {
        if (e.target === dialog) finish(false);
      });

      body.appendChild(heading);
      body.appendChild(text);
      actions.appendChild(cancel);
      actions.appendChild(ok);
      dialog.appendChild(body);
      dialog.appendChild(actions);
      doc.body.appendChild(dialog);

      try { dialog.showModal(); } catch (e) { finish(nativeConfirm(message)); return; }
      try { cancel.focus(); } catch (e) { /* ignore */ }
    });
  }

  /* ---------- skeleton ---------- */
  function skeleton(lines) {
    var count = Math.max(1, Math.min(6, Number(lines) || 3));
    var wrap = doc.createElement("div");
    wrap.className = "skeleton";
    wrap.setAttribute("aria-hidden", "true");
    for (var i = 0; i < count; i++) {
      var line = doc.createElement("div");
      line.className = "skeleton__line";
      wrap.appendChild(line);
    }
    return wrap;
  }

  /* ---------- link prefetch ---------- */
  function setupPrefetch() {
    var seen = {};
    function prefetch(url) {
      if (!url || seen[url]) return;
      seen[url] = true;
      try {
        var link = doc.createElement("link");
        link.rel = "prefetch";
        link.href = url;
        (doc.head || doc.documentElement).appendChild(link);
      } catch (e) { /* ignore */ }
    }
    function maybePrefetch(target) {
      if (!target || typeof target.closest !== "function") return;
      var anchor = target.closest("a[href]");
      if (!anchor) return;
      if (anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      var href = anchor.getAttribute("href") || "";
      if (!href || href.charAt(0) === "#") return;
      if (/^(mailto:|tel:|javascript:|https?:)/i.test(href)) {
        if (!/^https?:/i.test(href)) return;
        try {
          if (new URL(href, global.location.href).origin !== global.location.origin) return;
        } catch (e) { return; }
      }
      var absolute = anchor.href;
      if (!/\.html?($|[?#])/.test(absolute) && !/\/$/.test(absolute)) return;
      prefetch(absolute);
    }
    doc.addEventListener("mouseover", function (e) { maybePrefetch(e.target); }, { passive: true });
    doc.addEventListener("touchstart", function (e) { maybePrefetch(e.target); }, { passive: true });
    doc.addEventListener("focusin", function (e) { maybePrefetch(e.target); });
  }

  /* ---------- page transitions + scroll reveals + sticky bars ---------- */
  function setupPageTransitions() {
    var root = doc.documentElement;
    if (!root) return;
    if (!prefersReducedMotion()) root.classList.add("motion-ok");

    // Native cross-document view transitions are declared in css/styles.css
    // (@view-transition { navigation: auto }); no click interception needed.
    var bars = doc.querySelectorAll(".site-nav, .shell__bar");
    if (!bars.length) return;

    var ticking = false;
    function update() {
      ticking = false;
      var scrolled = (global.scrollY || root.scrollTop || 0) > 6;
      for (var i = 0; i < bars.length; i++) {
        if (scrolled) bars[i].classList.add("is-scrolled");
        else bars[i].classList.remove("is-scrolled");
      }
    }
    function onScroll() {
      if (ticking) return;
      ticking = true;
      if (global.requestAnimationFrame) global.requestAnimationFrame(update);
      else update();
    }
    global.addEventListener("scroll", onScroll, { passive: true });
    update();
  }

  function setupReveal() {
    var items = doc.querySelectorAll(".reveal");
    if (!items.length) return;
    if (prefersReducedMotion() || typeof global.IntersectionObserver !== "function") {
      for (var i = 0; i < items.length; i++) items[i].classList.add("is-in");
      return;
    }
    var observer = new global.IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].isIntersecting) {
          entries[i].target.classList.add("is-in");
          observer.unobserve(entries[i].target);
        }
      }
    }, { rootMargin: "0px 0px -6% 0px", threshold: 0.1 });
    for (var j = 0; j < items.length; j++) {
      items[j].style.setProperty("--reveal-delay", (Math.min(j % 4, 3) * 70) + "ms");
      observer.observe(items[j]);
    }
  }

  function mountAllUserChips() {
    var hosts = doc.querySelectorAll("[data-wetalk-user]");
    for (var i = 0; i < hosts.length; i++) {
      try { mountUserChip(hosts[i]); } catch (e) { /* ignore */ }
    }
  }

  /* ---------- boot ---------- */
  ready(function () {
    try { setupPrefetch(); } catch (e) { /* ignore */ }
    try { setupPageTransitions(); } catch (e) { /* ignore */ }
    try { setupReveal(); } catch (e) { /* ignore */ }
    try { mountAllUserChips(); } catch (e) { /* ignore */ }

    var a = auth();
    if (a && typeof a.onChange === "function") {
      try {
        a.onChange(function () { try { mountAllUserChips(); } catch (e) { /* ignore */ } });
      } catch (e) { /* ignore */ }
    }
  });

  global.WetalkUI = {
    toast: toast,
    mountUserChip: mountUserChip,
    initials: initials,
    escapeHtml: escapeHtml,
    confirmDialog: confirmDialog,
    skeleton: skeleton,
    setupPrefetch: setupPrefetch,
    setupPageTransitions: setupPageTransitions,
    // extras used by the dashboard/landing pages
    getSession: getSession,
    displayName: displayName,
    isPreview: isPreview,
    relativeTime: relativeTime
  };
})(window);
