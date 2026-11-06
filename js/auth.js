/* ============================================================
   Wetalk — shared auth logic

   This is a FRONT-END ONLY reference implementation. Account data is
   stored in localStorage so the sign-up → sign-in → home flow works
   end-to-end in the browser for preview. A production build should
   replace createAccount()/authenticate() with real backend API calls
   and replace the OAuth stubs with real Google / GitHub OAuth redirects.
   ============================================================ */
(function (global) {
  "use strict";

  var ACCOUNTS_KEY = "wetalk.accounts";
  var SESSION_KEY = "wetalk.session";

  // OAuth providers. Add a real clientId to enable the actual redirect flow.
  var OAUTH = {
    google: { clientId: "", name: "Google" },
    github: { clientId: "", name: "GitHub" },
  };

  // ---------- storage helpers ----------
  function readJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function getAccounts() { return readJSON(ACCOUNTS_KEY, []); }
  function saveAccounts(list) { writeJSON(ACCOUNTS_KEY, list); }

  // ---------- password hashing (demo-grade only) ----------
  function hashPassword(pw) {
    var data = new TextEncoder().encode("wetalk::" + pw);
    if (global.crypto && global.crypto.subtle && global.crypto.subtle.digest) {
      return global.crypto.subtle.digest("SHA-256", data).then(function (buf) {
        var bytes = new Uint8Array(buf);
        var out = "";
        for (var i = 0; i < bytes.length; i++) {
          out += bytes[i].toString(16).padStart(2, "0");
        }
        return "sha256-" + out;
      });
    }
    // Fallback for non-secure contexts (e.g. file://) — NOT secure.
    var h = 5381;
    for (var i = 0; i < pw.length; i++) { h = ((h << 5) + h + pw.charCodeAt(i)) >>> 0; }
    return Promise.resolve("djb2-" + h.toString(16));
  }

  // ---------- validation ----------
  function identifyIdentifier(value) {
    var v = (value || "").trim();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return "email";
    if (/^\+?[0-9][0-9\s\-()]{5,17}$/.test(v)) return "phone";
    return null;
  }

  function normalizeIdentifier(value) { return (value || "").trim(); }

  // ---------- session ----------
  function getSession() { return readJSON(SESSION_KEY, null); }
  function setSession(user) { writeJSON(SESSION_KEY, user); }
  function clearSession() { localStorage.removeItem(SESSION_KEY); }

  function requireAuth() {
    if (!getSession()) {
      window.location.replace("signin.html");
      return false;
    }
    return true;
  }

  function signOut() {
    clearSession();
    window.location.replace("index.html");
  }

  // ---------- account CRUD ----------
  function createAccount(fields) {
    return hashPassword(fields.password).then(function (hash) {
      var accounts = getAccounts();
      var identifier = normalizeIdentifier(fields.identifier);

      var duplicate = accounts.some(function (a) {
        return a.identifier.toLowerCase() === identifier.toLowerCase();
      });
      if (duplicate) {
        return { ok: false, error: "That email or phone number is already registered. Try signing in." };
      }

      var account = {
        username: fields.username.trim(),
        identifier: identifier,
        identifierType: identifyIdentifier(identifier) || "email",
        passwordHash: hash,
        provider: "wetalk",
        createdAt: new Date().toISOString(),
      };
      accounts.push(account);
      saveAccounts(accounts);
      setSession({ username: account.username, identifier: account.identifier, provider: "wetalk" });
      return { ok: true };
    });
  }

  function authenticate(identifier, password) {
    var id = normalizeIdentifier(identifier);
    return hashPassword(password).then(function (hash) {
      var accounts = getAccounts();
      var match = accounts.find(function (a) {
        return a.identifier.toLowerCase() === id.toLowerCase();
      });
      if (!match) {
        return { ok: false, error: "No account found for that email or phone number." };
      }
      if (match.passwordHash !== hash) {
        return { ok: false, error: "Incorrect password. Please try again." };
      }
      setSession({ username: match.username, identifier: match.identifier, provider: "wetalk" });
      return { ok: true };
    });
  }

  // ---------- OAuth (one-click sign-in) ----------
  function oauthSignIn(provider) {
    // The desktop app's local server runs the real OAuth flow
    // (redirect -> callback -> token exchange -> session).
    if (global.WETALK_DESKTOP) {
      window.location.href = "/oauth/" + provider + "/start";
    } else {
      toast("Google/GitHub sign-in requires the Wetalk desktop app.");
    }
  }

  // ---------- toast ----------
  var toastTimer = null;
  function toast(message) {
    var el = document.getElementById("toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "toast";
      el.className = "toast";
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.classList.add("is-visible");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("is-visible"); }, 3200);
  }

  // ---------- exports ----------
  global.WetalkAuth = {
    identifyIdentifier: identifyIdentifier,
    normalizeIdentifier: normalizeIdentifier,
    getSession: getSession,
    setSession: setSession,
    clearSession: clearSession,
    requireAuth: requireAuth,
    signOut: signOut,
    createAccount: createAccount,
    authenticate: authenticate,
    oauthSignIn: oauthSignIn,
    toast: toast,
  };
})(window);