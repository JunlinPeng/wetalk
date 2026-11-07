/* ============================================================
   Wetalk - shared auth logic

   Two modes, decided by js/config.js:

   * Preview mode (default): supabaseUrl / supabaseAnonKey are empty.
     Accounts and sessions are stored in this browser (localStorage),
     exactly like the original demo, so the public site always works
     with zero configuration.

   * Supabase mode: config.js has a URL + anon key. Sign-up, sign-in,
     OAuth and password reset go through Supabase Auth. A minimal
     profile is cached in localStorage["wetalk.session"] so
     getSession() and requireAuth() stay synchronous, while Supabase
     remains the source of truth and is re-checked in the background.

   Contract: docs/ARCHITECTURE.md (section "WetalkAuth contract").
   Classic script, loaded with <script src="js/auth.js"></script>.
   ============================================================ */
(function (global) {
  "use strict";

  // Captured while this script executes. It lets auth.js lazy-load the
  // vendored supabase-js bundle on pages that include js/config.js but
  // forgot js/vendor/supabase.js.
  var SCRIPT_SRC = (function () {
    try {
      if (document.currentScript && document.currentScript.src) {
        return document.currentScript.src;
      }
      var scripts = document.getElementsByTagName("script");
      for (var i = scripts.length - 1; i >= 0; i--) {
        var src = scripts[i].getAttribute("src") || "";
        if (src.indexOf("auth.js") !== -1) return scripts[i].src;
      }
    } catch (e) {}
    return "";
  })();

  function trim(value) {
    return value == null ? "" : String(value).trim();
  }

  var CONFIG = global.WETALK_CONFIG || {};
  var SUPABASE_URL = trim(CONFIG.supabaseUrl);
  var SUPABASE_ANON_KEY = trim(CONFIG.supabaseAnonKey);
  var PREVIEW = !(SUPABASE_URL && SUPABASE_ANON_KEY);

  var ACCOUNTS_KEY = "wetalk.accounts";
  var SESSION_KEY = "wetalk.session";
  var VENDOR_FILE = "vendor/supabase.js";
  var MIN_PASSWORD = 8;
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var USERNAME_RE = /^[a-z0-9_]{3,20}$/;

  // ---------- storage helpers ----------
  function readJSON(key, fallback) {
    try {
      var raw = global.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try { global.localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }

  function removeKey(key) {
    try { global.localStorage.removeItem(key); } catch (e) {}
  }

  // Stable non-cryptographic hash, used only for local preview ids.
  function simpleHash(value) {
    var str = String(value == null ? "" : value);
    var h = 5381;
    for (var i = 0; i < str.length; i++) {
      h = ((h * 33) + str.charCodeAt(i)) >>> 0;
    }
    return h.toString(16);
  }

  // ---------- validation ----------
  function identifyIdentifier(value) {
    var v = trim(value);
    if (EMAIL_RE.test(v)) return "email";
    if (/^\+?[0-9][0-9\s\-()]{5,17}$/.test(v)) return "phone";
    return null;
  }

  function normalizeIdentifier(value) { return trim(value); }
  function normalizeEmail(value) { return trim(value).toLowerCase(); }
  function normalizeUsername(value) { return trim(value).toLowerCase(); }

  function validateEmail(value) {
    var v = trim(value);
    if (!v) return "Enter your email address.";
    if (!EMAIL_RE.test(v)) return "Enter a valid email address, for example you@example.com.";
    return null;
  }

  function validateUsername(value) {
    var v = normalizeUsername(value);
    if (!v) return "Pick a username.";
    if (v.length < 3 || v.length > 20) return "Username must be 3-20 characters long.";
    if (!USERNAME_RE.test(v)) return "Username can only use lowercase letters, numbers and underscores.";
    return null;
  }

  function validatePassword(value) {
    var v = String(value == null ? "" : value);
    if (v.length < MIN_PASSWORD) return "Password must be at least 8 characters long.";
    return null;
  }

  // ---------- session cache ----------
  // The cached shape is exactly { id, username, email, provider, avatar }.
  // Old demo sessions ({ username, identifier, provider }) are migrated on
  // read, so visitors who signed up before this rewrite stay signed in.
  function sessionShape(raw) {
    if (!raw || typeof raw !== "object") return null;
    var email = trim(raw.email || raw.identifier || "");
    var username = trim(raw.username || raw.name || "");
    if (!username && email) username = email.split("@")[0].replace(/[^a-zA-Z0-9_]/g, "");
    if (!username) username = "there";
    var id = trim(raw.id || raw.user_id || "");
    if (!id) id = "local-" + simpleHash(email || username);
    return {
      id: id,
      username: username,
      email: email,
      provider: trim(raw.provider || "wetalk") || "wetalk",
      avatar: raw.avatar || raw.avatar_url || null
    };
  }

  function getSession() {
    var raw = readJSON(SESSION_KEY, null);
    if (!raw || typeof raw !== "object") return null;
    var shaped = sessionShape(raw);
    if (!shaped) return null;
    try {
      if (JSON.stringify(shaped) !== JSON.stringify(raw)) writeJSON(SESSION_KEY, shaped);
    } catch (e) {}
    return shaped;
  }

  function setSession(session) {
    var shaped = sessionShape(session);
    if (!shaped) { removeKey(SESSION_KEY); return; }
    writeJSON(SESSION_KEY, shaped);
  }

  function clearSession() { removeKey(SESSION_KEY); }

  // ---------- change listeners ----------
  var listeners = [];
  var authRequired = false;
  var redirecting = false;

  function emitChange(session) {
    setTimeout(function () {
      for (var i = 0; i < listeners.length; i++) {
        try { listeners[i](session); } catch (e) {}
      }
    }, 0);
  }

  function onChange(callback) {
    if (typeof callback !== "function") return function () {};
    listeners.push(callback);
    return function off() {
      var idx = listeners.indexOf(callback);
      if (idx !== -1) listeners.splice(idx, 1);
    };
  }

  // ---------- navigation helpers ----------
  function currentPagePath() {
    var path = "";
    try {
      var p = global.location.pathname || "";
      path = p.substring(p.lastIndexOf("/") + 1);
      if (!path) path = "index.html";
      // Never carry an auth token hash into a "next" parameter.
      if (global.location.search) path += global.location.search;
    } catch (e) {
      path = "";
    }
    return path;
  }

  function signinUrl(next) {
    return "signin.html" + (next ? "?next=" + encodeURIComponent(next) : "");
  }

  function redirectToSignin() {
    if (redirecting) return;
    var next = currentPagePath();
    if (next.indexOf("signin.html") === 0) return;
    redirecting = true;
    try {
      global.location.replace(signinUrl(next));
    } catch (e) {
      global.location.href = signinUrl(next);
    }
  }

  // Only allow same-site relative pages in ?next= (no open redirects).
  function safeNext(value, fallback) {
    var target = trim(value);
    var fallbackTarget = fallback || "app.html";
    if (!target) return fallbackTarget;
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(target)) return fallbackTarget;
    if (target.indexOf("//") === 0) return fallbackTarget;
    if (target.indexOf("/") !== -1) {
      target = target.substring(target.lastIndexOf("/") + 1);
    }
    if (!target) return fallbackTarget;
    if (/^(signin|signup|reset)(\.html|$)/.test(target)) return fallbackTarget;
    return target;
  }

  function siteBase() {
    var configured = trim(CONFIG.siteUrl);
    if (configured) return configured.replace(/\/+$/, "") + "/";
    try {
      var href = global.location.href;
      return href.substring(0, href.lastIndexOf("/") + 1);
    } catch (e) {
      return "";
    }
  }

  function absoluteUrl(page) {
    return siteBase() + String(page == null ? "" : page).replace(/^\/+/, "");
  }

  // ---------- toast ----------
  var toastTimer = null;
  function toast(message) {
    var text = String(message == null ? "" : message);
    if (global.WetalkUI && typeof global.WetalkUI.toast === "function") {
      try { global.WetalkUI.toast(text); return; } catch (e) {}
    }
    if (!document.body) return;
    var el = document.getElementById("toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "toast";
      el.className = "toast";
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.add("is-visible");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("is-visible"); }, 3600);
  }

  // ---------- friendly Supabase error mapping ----------
  function friendlyAuthError(err) {
    if (!err) return "Something went wrong. Please try again.";
    var msg = typeof err === "string" ? err : trim(err.message || err.error_description || err.msg || "");
    var code = trim(err.code || "").toLowerCase();
    var m = msg.toLowerCase();

    if (code === "invalid_credentials" || m.indexOf("invalid login credentials") !== -1) {
      return "Incorrect email or password. If you just signed up, confirm your email first.";
    }
    if (code === "email_not_confirmed" || m.indexOf("email not confirmed") !== -1) {
      return "Please confirm your email first. Check your inbox for the confirmation link.";
    }
    if (m.indexOf("user already registered") !== -1 || m.indexOf("already registered") !== -1) {
      return "An account with that email already exists. Try signing in instead.";
    }
    if (code === "weak_password" || m.indexOf("password should be") !== -1 || m.indexOf("weak password") !== -1) {
      return "That password is too weak. Use at least 8 characters.";
    }
    if (code === "over_email_send_rate_limit" || code === "over_request_rate_limit" ||
        m.indexOf("rate limit") !== -1 || m.indexOf("only request this after") !== -1 ||
        (m.indexOf("after ") !== -1 && m.indexOf("seconds") !== -1)) {
      return "Too many attempts. Please wait a minute and try again.";
    }
    if (m.indexOf("database error") !== -1) {
      return "That username is already taken. Try a different one.";
    }
    if (m.indexOf("unable to validate email") !== -1 || m.indexOf("invalid email") !== -1) {
      return "That email address does not look valid.";
    }
    if (m.indexOf("link is invalid") !== -1 || m.indexOf("token has expired") !== -1 ||
        m.indexOf("invalid or has expired") !== -1) {
      return "That link is invalid or has expired. Request a new email.";
    }
    if (m.indexOf("auth session missing") !== -1 || m.indexOf("session missing") !== -1) {
      return "Your session has expired. Request a new password reset email.";
    }
    if (m.indexOf("failed to fetch") !== -1 || m.indexOf("networkerror") !== -1 ||
        m.indexOf("network request failed") !== -1 || m.indexOf("load failed") !== -1) {
      return "Network problem. Check your connection and try again.";
    }
    return msg || "Something went wrong. Please try again.";
  }

  // ---------- Supabase client ----------
  var client = null;
  var authListenerBound = false;
  var hydratedProfileId = null;
  var vendorLoading = false;
  var vendorCallbacks = [];

  function loadVendor(callback) {
    if (global.supabase && typeof global.supabase.createClient === "function") {
      if (callback) callback();
      return;
    }
    if (callback) vendorCallbacks.push(callback);
    if (vendorLoading) return;
    vendorLoading = true;
    var base = "";
    var idx = SCRIPT_SRC ? SCRIPT_SRC.lastIndexOf("/") : -1;
    if (idx !== -1) base = SCRIPT_SRC.substring(0, idx + 1);
    if (!base) base = "js/";
    var el = document.createElement("script");
    el.src = base + VENDOR_FILE;
    el.async = false;
    el.onload = function () {
      vendorLoading = false;
      drainVendorCallbacks();
    };
    el.onerror = function () {
      vendorLoading = false;
      if (global.console && global.console.warn) {
        global.console.warn("WetalkAuth: could not load " + el.src + " - real accounts are unavailable on this page.");
      }
      drainVendorCallbacks();
    };
    document.head.appendChild(el);
  }

  function drainVendorCallbacks() {
    var callbacks = vendorCallbacks;
    vendorCallbacks = [];
    for (var i = 0; i < callbacks.length; i++) {
      try { callbacks[i](); } catch (e) {}
    }
  }

  function whenClientReady(callback) {
    var c = getClient();
    if (c) { callback(c); return; }
    if (PREVIEW) return;
    loadVendor(function () {
      var ready = getClient();
      if (ready) callback(ready);
    });
  }

  function getClient() {
    if (PREVIEW) return null;
    if (client) return client;
    var lib = global.supabase;
    if (!lib || typeof lib.createClient !== "function") return null;
    try {
      client = lib.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      });
      bindAuthListener();
    } catch (e) {
      client = null;
      if (global.console && global.console.warn) {
        global.console.warn("WetalkAuth: could not create the Supabase client.", e);
      }
    }
    return client;
  }

  function bindAuthListener() {
    if (!client || authListenerBound) return;
    authListenerBound = true;
    try {
      client.auth.onAuthStateChange(function (event, sbSession) {
        // Supabase warns against awaiting inside this callback; defer the
        // bookkeeping to a later tick so the auth lock is not held.
        setTimeout(function () { handleAuthStateChange(event, sbSession); }, 0);
      });
    } catch (e) {}
  }

  function handleAuthStateChange(event, sbSession) {
    if (event === "SIGNED_OUT") {
      var hadSession = !!getSession();
      clearSession();
      emitChange(null);
      if (authRequired && hadSession) redirectToSignin();
      return;
    }
    if (!sbSession) return;
    var forceEmit = event === "SIGNED_IN" || event === "TOKEN_REFRESHED" ||
                    event === "USER_UPDATED" || event === "PASSWORD_RECOVERY";
    cacheSupabaseSession(sbSession, forceEmit);
  }

  function sessionFromSupabaseSession(sbSession) {
    if (!sbSession || !sbSession.user) return null;
    var user = sbSession.user;
    var meta = user.user_metadata || {};
    var appMeta = user.app_metadata || {};
    var email = trim(user.email || "");
    var username = trim(meta.username || meta.preferred_username || meta.user_name || "");
    if (!username && email) username = email.split("@")[0].replace(/[^a-zA-Z0-9_]/g, "");
    if (!username) username = "user";
    username = username.substring(0, 20);
    return {
      id: user.id,
      username: username,
      email: email,
      provider: trim(appMeta.provider || "email") || "email",
      avatar: meta.avatar_url || meta.picture || null
    };
  }

  function cacheSupabaseSession(sbSession, forceEmit) {
    var shaped = sessionFromSupabaseSession(sbSession);
    if (!shaped) return null;
    var previous = getSession();
    var changed = true;
    try { changed = JSON.stringify(previous) !== JSON.stringify(shaped); } catch (e) {}
    if (changed) writeJSON(SESSION_KEY, shaped);
    if (changed || forceEmit) emitChange(shaped);
    hydrateProfile(shaped);
    return shaped;
  }

  // The profiles row is authoritative for the username (the sign-up trigger
  // creates it); replace the metadata guess once, in the background.
  function hydrateProfile(session) {
    if (!session || !session.id) return;
    if (hydratedProfileId === session.id) return;
    var c = getClient();
    if (!c) return;
    hydratedProfileId = session.id;
    try {
      c.from("profiles").select("username, email").eq("id", session.id).maybeSingle()
        .then(function (res) {
          if (!res || res.error || !res.data) return;
          var current = getSession();
          if (!current || current.id !== session.id) return;
          var next = {
            id: current.id,
            username: res.data.username || current.username,
            email: res.data.email || current.email,
            provider: current.provider,
            avatar: current.avatar
          };
          var changed = true;
          try { changed = JSON.stringify(next) !== JSON.stringify(current); } catch (e) {}
          if (changed) {
            writeJSON(SESSION_KEY, next);
            emitChange(next);
          }
        })
        .catch(function () {});
    } catch (e) {}
  }

  function bootstrapSupabase() {
    var c = getClient();
    if (!c) {
      whenClientReady(function () { bootstrapSupabase(); });
      return;
    }
    bindAuthListener();
    c.auth.getSession()
      .then(function (res) {
        var sbSession = res && res.data ? res.data.session : null;
        if (sbSession) {
          cacheSupabaseSession(sbSession, false);
          return;
        }
        var cached = getSession();
        if (cached) {
          // The cached profile belongs to a session Supabase no longer has
          // (expired, revoked, or a Preview-era demo session): sign out.
          clearSession();
          emitChange(null);
          if (authRequired) redirectToSignin();
        }
      })
      .catch(function (err) {
        if (global.console && global.console.warn) {
          global.console.warn("WetalkAuth: session check failed.", err);
        }
      });
  }

  function getAccessToken() {
    if (PREVIEW) return Promise.resolve(null);
    var c = getClient();
    if (!c) return Promise.resolve(null);
    return c.auth.getSession().then(function (res) {
      return res && res.data && res.data.session ? res.data.session.access_token : null;
    }).catch(function () { return null; });
  }

  // ---------- requireAuth ----------
  function requireAuth() {
    if (!getSession()) {
      redirectToSignin();
      return false;
    }
    authRequired = true;
    return true;
  }

  // Remove the supabase-js session from localStorage. This runs just before
  // the sign-out redirect so a slow or aborted network call can never leave a
  // stale Supabase session behind (which would silently sign the user back in
  // on the next page load). Only this project's key is touched: the storage
  // key embeds the project ref, so other apps on the same origin are safe.
  function clearSupabaseLocalSession() {
    var ref = "";
    try {
      var host = SUPABASE_URL.replace(/^https?:\/\//, "").split("/")[0];
      ref = host.split(".")[0];
    } catch (e) {}
    if (!ref) return;
    var prefix = "sb-" + ref + "-auth-token";
    try {
      var keys = [];
      for (var i = 0; i < global.localStorage.length; i++) {
        var key = global.localStorage.key(i);
        if (key && (key === prefix || key.indexOf(prefix + "-") === 0)) keys.push(key);
      }
      for (var j = 0; j < keys.length; j++) global.localStorage.removeItem(keys[j]);
    } catch (e) {}
  }

  function signOut() {
    clearSession();
    emitChange(null);
    var c = getClient();
    var done = false;
    function finish() {
      if (done) return;
      done = true;
      clearSupabaseLocalSession();
      try { global.location.replace("index.html"); } catch (e) { global.location.href = "index.html"; }
    }
    if (c) {
      try {
        var pending = c.auth.signOut();
        if (pending && pending.then) {
          pending.then(finish, finish);
        } else {
          finish();
        }
      } catch (e) {
        finish();
      }
      // Never let a slow sign-out call trap the user on the page.
      setTimeout(finish, 2000);
    } else {
      finish();
    }
  }

  // ---------- Preview mode accounts ----------
  function previewAccounts() {
    var list = readJSON(ACCOUNTS_KEY, []);
    return Object.prototype.toString.call(list) === "[object Array]" ? list : [];
  }

  function savePreviewAccounts(list) { writeJSON(ACCOUNTS_KEY, list); }

  function migratePreviewAccounts() {
    var accounts = previewAccounts();
    var changed = false;
    for (var i = 0; i < accounts.length; i++) {
      var account = accounts[i];
      if (!account || typeof account !== "object") continue;
      var identifier = trim(account.identifier || account.email || "");
      if (!account.id) {
        account.id = "local-" + simpleHash(identifier.toLowerCase() || account.username || ("account" + i));
        changed = true;
      }
      if (!account.email && identifier) { account.email = identifier; changed = true; }
      if (!account.identifier && identifier) { account.identifier = identifier; changed = true; }
    }
    if (changed) savePreviewAccounts(accounts);
    return accounts;
  }

  // Demo-grade password hashing. Preview mode is a local convenience store,
  // not a security boundary; real accounts use Supabase Auth.
  function hashPassword(password) {
    var pwd = String(password == null ? "" : password);
    if (global.crypto && global.crypto.subtle && global.crypto.subtle.digest &&
        typeof global.TextEncoder === "function") {
      try {
        var data = new global.TextEncoder().encode("wetalk::" + pwd);
        return global.crypto.subtle.digest("SHA-256", data).then(function (buffer) {
          var bytes = new Uint8Array(buffer);
          var out = "";
          for (var i = 0; i < bytes.length; i++) {
            out += ("0" + bytes[i].toString(16)).slice(-2);
          }
          return "sha256-" + out;
        });
      } catch (e) {}
    }
    return Promise.resolve("djb2-" + simpleHash("wetalk::" + pwd));
  }

  function previewSession(account) {
    return sessionShape({
      id: account.id || "local-" + simpleHash(normalizeEmail(account.identifier || account.email || "")),
      username: account.username,
      email: account.identifier || account.email || "",
      provider: "wetalk",
      avatar: account.avatar || null
    });
  }

  function previewCreateAccount(fields) {
    var email = trim(fields.email || fields.identifier);
    var username = trim(fields.username);
    var password = String(fields.password == null ? "" : fields.password);
    var error = validateEmail(email) ||
                validateUsername(username) ||
                validatePassword(password);
    if (!error && identifyIdentifier(email) !== "email") {
      error = "Enter a valid email address, for example you@example.com.";
    }
    if (!error) {
      var accounts = migratePreviewAccounts();
      var emailTaken = false;
      var nameTaken = false;
      for (var i = 0; i < accounts.length; i++) {
        var account = accounts[i] || {};
        if (normalizeEmail(account.email || account.identifier) === normalizeEmail(email)) emailTaken = true;
        if (normalizeUsername(account.username) === normalizeUsername(username)) nameTaken = true;
      }
      if (emailTaken) error = "An account with that email already exists. Try signing in instead.";
      else if (nameTaken) error = "That username is already taken. Try a different one.";
    }
    if (error) return Promise.resolve({ ok: false, error: error });

    return hashPassword(password).then(function (hash) {
      var list = migratePreviewAccounts();
      var normalizedEmail = normalizeEmail(email);
      var record = {
        id: "local-" + simpleHash(normalizedEmail),
        username: normalizeUsername(username),
        email: normalizedEmail,
        identifier: normalizedEmail,
        identifierType: "email",
        passwordHash: hash,
        provider: "wetalk",
        createdAt: new Date().toISOString()
      };
      list.push(record);
      savePreviewAccounts(list);
      var session = previewSession(record);
      writeJSON(SESSION_KEY, session);
      emitChange(session);
      return { ok: true };
    });
  }

  function previewAuthenticate(identifier, password) {
    var email = normalizeIdentifier(identifier);
    var pwd = String(password == null ? "" : password);
    if (!email) return Promise.resolve({ ok: false, error: "Enter your email address." });
    if (!pwd) return Promise.resolve({ ok: false, error: "Enter your password." });
    return hashPassword(pwd).then(function (hash) {
      var accounts = migratePreviewAccounts();
      var match = null;
      for (var i = 0; i < accounts.length; i++) {
        var account = accounts[i] || {};
        if (normalizeEmail(account.identifier || account.email) === normalizeEmail(email)) {
          match = account;
          break;
        }
      }
      if (!match) {
        return { ok: false, error: "No account found for that email. Create an account first." };
      }
      if (match.passwordHash !== hash) {
        return { ok: false, error: "Incorrect password. Please try again." };
      }
      var session = previewSession(match);
      writeJSON(SESSION_KEY, session);
      emitChange(session);
      return { ok: true };
    }).catch(function () {
      return { ok: false, error: "Could not sign in. Please try again." };
    });
  }

  // ---------- Supabase: createAccount ----------
  function usernameAvailable(c, username) {
    try {
      var pending = c.rpc("username_available", { candidate: username });
      if (!pending || typeof pending.then !== "function") return Promise.resolve(null);
      return pending.then(function (res) {
        if (res && !res.error && typeof res.data === "boolean") return res.data;
        return null;
      }).catch(function () { return null; });
    } catch (e) {
      return Promise.resolve(null);
    }
  }

  function supabaseCreateAccount(c, email, username, password) {
    return usernameAvailable(c, username).then(function (available) {
      if (available === false) {
        return { ok: false, error: "That username is already taken. Try a different one." };
      }
      return c.auth.signUp({
        email: email,
        password: password,
        options: {
          data: { username: username },
          emailRedirectTo: absoluteUrl("signin.html?confirmed=1")
        }
      });
    }).then(function (res) {
      if (!res || res.error) {
        return { ok: false, error: friendlyAuthError(res && res.error) };
      }
      var data = res.data || {};
      var user = data.user || null;
      // With email confirmation enabled Supabase obfuscates duplicate
      // sign-ups: an existing address comes back with no identities.
      if (user && user.identities && user.identities.length === 0) {
        return { ok: false, error: "An account with that email already exists. Try signing in instead." };
      }
      if (data.session) {
        cacheSupabaseSession(data.session, true);
        return { ok: true };
      }
      return { ok: true, needsConfirmation: true };
    }).catch(function (err) {
      return { ok: false, error: friendlyAuthError(err) };
    });
  }

  function createAccount(fields) {
    fields = fields || {};
    var email = normalizeEmail(fields.email || fields.identifier);
    var username = normalizeUsername(fields.username);
    var password = String(fields.password == null ? "" : fields.password);

    var error = validateEmail(email) || validateUsername(username) || validatePassword(password);
    if (error) return Promise.resolve({ ok: false, error: error });

    if (PREVIEW) return previewCreateAccount({ email: email, username: username, password: password });

    var c = getClient();
    if (!c) {
      return Promise.resolve({ ok: false, error: "Sign-up is still loading. Reload the page and try again." });
    }
    return supabaseCreateAccount(c, email, username, password);
  }

  // ---------- Supabase: authenticate ----------
  function authenticate(identifier, password) {
    var email = normalizeEmail(identifier);
    var pwd = String(password == null ? "" : password);

    if (PREVIEW) return previewAuthenticate(identifier, pwd);

    if (!email) return Promise.resolve({ ok: false, error: "Enter your email address." });
    var emailError = validateEmail(email);
    if (emailError) return Promise.resolve({ ok: false, error: emailError });
    if (!pwd) return Promise.resolve({ ok: false, error: "Enter your password." });

    var c = getClient();
    if (!c) {
      return Promise.resolve({ ok: false, error: "Sign-in is still loading. Reload the page and try again." });
    }
    return c.auth.signInWithPassword({ email: email, password: pwd })
      .then(function (res) {
        if (!res || res.error) {
          return { ok: false, error: friendlyAuthError(res && res.error) };
        }
        cacheSupabaseSession(res.data.session, true);
        return { ok: true };
      })
      .catch(function (err) {
        return { ok: false, error: friendlyAuthError(err) };
      });
  }

  // ---------- OAuth ----------
  function oauthSignIn(provider, nextPage) {
    var name = trim(provider).toLowerCase();
    if (name !== "google" && name !== "github") {
      toast("Unsupported sign-in provider.");
      return;
    }
    if (PREVIEW) {
      toast("Google and GitHub sign-in need real accounts (Supabase). In Preview mode, use email sign-up.");
      return;
    }
    var target = safeNext(nextPage, "app.html");
    var c = getClient();
    if (!c) {
      whenClientReady(function (ready) { startOAuth(ready, name, target); });
      return;
    }
    startOAuth(c, name, target);
  }

  function startOAuth(c, provider, target) {
    try {
      var redirectTo = absoluteUrl("signin.html?oauth=1&next=" + encodeURIComponent(target));
      var pending = c.auth.signInWithOAuth({ provider: provider, options: { redirectTo: redirectTo } });
      if (pending && typeof pending.then === "function") {
        pending.then(function (res) {
          if (res && res.error) toast(friendlyAuthError(res.error));
        }).catch(function (err) { toast(friendlyAuthError(err)); });
      }
    } catch (e) {
      toast(friendlyAuthError(e));
    }
  }

  // ---------- password reset ----------
  function resetPassword(email) {
    if (PREVIEW) {
      return Promise.resolve({
        ok: false,
        error: "Password reset needs a real Supabase project. In Preview mode accounts only exist in this browser - create a new account instead."
      });
    }
    var normalized = normalizeEmail(email);
    var emailError = validateEmail(normalized);
    if (emailError) return Promise.resolve({ ok: false, error: emailError });

    var c = getClient();
    if (!c) {
      return Promise.resolve({ ok: false, error: "Password reset is still loading. Reload the page and try again." });
    }
    return c.auth.resetPasswordForEmail(normalized, {
      redirectTo: absoluteUrl("reset-password.html")
    }).then(function (res) {
      if (res && res.error) return { ok: false, error: friendlyAuthError(res.error) };
      return { ok: true };
    }).catch(function (err) {
      return { ok: false, error: friendlyAuthError(err) };
    });
  }

  function updatePassword(newPassword) {
    var password = String(newPassword == null ? "" : newPassword);
    if (PREVIEW) {
      return Promise.resolve({
        ok: false,
        error: "Password reset needs a real Supabase project. In Preview mode accounts only exist in this browser."
      });
    }
    if (password.length < MIN_PASSWORD) {
      return Promise.resolve({ ok: false, error: "Password must be at least 8 characters long." });
    }
    var c = getClient();
    if (!c) {
      return Promise.resolve({ ok: false, error: "Password reset is still loading. Reload the page and try again." });
    }
    return c.auth.updateUser({ password: password }).then(function (res) {
      if (res && res.error) return { ok: false, error: friendlyAuthError(res.error) };
      return { ok: true };
    }).catch(function (err) {
      return { ok: false, error: friendlyAuthError(err) };
    });
  }

  // ---------- Preview banner + bootstrap ----------
  function injectPreviewBanner() {
    if (!PREVIEW) return;
    if (!document.body) return;
    if (document.querySelector(".preview-banner")) return;
    var banner = document.createElement("div");
    banner.className = "preview-banner";
    banner.textContent = "Preview mode - accounts are stored in this browser";
    if (document.body.firstChild) {
      document.body.insertBefore(banner, document.body.firstChild);
    } else {
      document.body.appendChild(banner);
    }
  }

  function init() {
    injectPreviewBanner();
    if (PREVIEW) {
      migratePreviewAccounts();
      getSession(); // normalises any old cached session
      return;
    }
    whenClientReady(function () { bootstrapSupabase(); });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // Keep other tabs in sync after sign-in / sign-out.
  if (global.addEventListener) {
    global.addEventListener("storage", function (event) {
      if (!event || event.key !== SESSION_KEY) return;
      emitChange(getSession());
    });
  }

  function isPreviewMode() { return PREVIEW; }

  // ---------- exports (contract: docs/ARCHITECTURE.md) ----------
  global.WetalkAuth = {
    // session + app integration
    getSession: getSession,
    requireAuth: requireAuth,
    isPreviewMode: isPreviewMode,
    getClient: getClient,
    getAccessToken: getAccessToken,
    onChange: onChange,
    // account lifecycle
    createAccount: createAccount,
    authenticate: authenticate,
    signOut: signOut,
    oauthSignIn: oauthSignIn,
    resetPassword: resetPassword,
    updatePassword: updatePassword,
    // helpers used by the auth pages
    validateEmail: validateEmail,
    validateUsername: validateUsername,
    validatePassword: validatePassword,
    normalizeEmail: normalizeEmail,
    normalizeUsername: normalizeUsername,
    safeNext: safeNext,
    // compatibility helpers kept from the Preview implementation
    identifyIdentifier: identifyIdentifier,
    normalizeIdentifier: normalizeIdentifier,
    setSession: setSession,
    clearSession: clearSession,
    toast: toast
  };
})(window);