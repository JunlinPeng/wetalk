/* ============================================================
   Wetalk - LLM module

   AI order:
     1. Platform mode - the account's AI proxy (Supabase Edge
        Function, signed-in users, daily quota). No key needed.
     2. Personal mode - the account's own OpenAI-compatible API key
        (CC Switch style provider picker), called from the browser.
     3. Otherwise reject; callers fall back to offline heuristics.

   Platform mode turns on when js/config.js has aiProxyUrl, the
   visitor is signed in to Supabase, and auth.js provides an access
   token. Users can opt out of the included AI with the secondary
   "Use my own key" toggle, which sets config.useOwnKey = true.

   NOTE (personal mode): the key is stored in localStorage (per
   account) and is only ever sent to the provider the user selected.
   Some providers block browser (CORS) requests; use a CORS-enabled
   provider or the platform proxy for those.
   ============================================================ */
(function (global) {
  "use strict";

  var PROVIDERS = [
    { id: "openai",     name: "OpenAI",                   baseUrl: "https://api.openai.com/v1",            model: "gpt-4o-mini" },
    { id: "deepseek",   name: "DeepSeek",                 baseUrl: "https://api.deepseek.com/v1",          model: "deepseek-chat" },
    { id: "moonshot",   name: "Moonshot (Kimi)",          baseUrl: "https://api.moonshot.cn/v1",           model: "moonshot-v1-8k" },
    { id: "zhipu",      name: "Zhipu GLM",                baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-flash" },
    { id: "qwen",       name: "Alibaba Qwen (DashScope)", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus" },
    { id: "groq",       name: "Groq",                     baseUrl: "https://api.groq.com/openai/v1",       model: "llama-3.3-70b-versatile" },
    { id: "together",   name: "Together AI",              baseUrl: "https://api.together.xyz/v1",          model: "meta-llama/Llama-3.3-70B-Instruct-Turbo" },
    { id: "openrouter", name: "OpenRouter",               baseUrl: "https://openrouter.ai/api/v1",         model: "openai/gpt-4o-mini" },
    { id: "mistral",    name: "Mistral",                  baseUrl: "https://api.mistral.ai/v1",            model: "mistral-small-latest" },
    { id: "siliconflow",name: "SiliconFlow",              baseUrl: "https://api.siliconflow.cn/v1",        model: "Qwen/Qwen2.5-7B-Instruct" },
    { id: "ollama",     name: "Ollama (local)",           baseUrl: "http://localhost:11434/v1",            model: "llama3.2" },
    { id: "lmstudio",   name: "LM Studio (local)",        baseUrl: "http://localhost:1234/v1",             model: "local-model" },
    { id: "custom",     name: "Custom (OpenAI-compatible)", baseUrl: "", model: "" }
  ];

  var QUOTA_KEY = "wetalk.aiQuota";
  var DEFAULT_DAILY_LIMIT = 20;
  var PROXY_MAX_INPUT_CHARS = 12000;
  var PROXY_MAX_TOKENS = 1200;
  var PROXY_MAX_TEMPERATURE = 0.7;

  function logWarn() {
    try {
      if (global.console && global.console.warn) {
        global.console.warn.apply(global.console, ["[WetalkLLM]"].concat(
          Array.prototype.slice.call(arguments)
        ));
      }
    } catch (e) { /* ignore */ }
  }

  /* ---------- per-account personal-key config ---------- */

  function configKey() {
    var s = (global.WetalkAuth && WetalkAuth.getSession) ? WetalkAuth.getSession() : null;
    var u = (s && s.username) ? s.username : "default";
    return "wetalk.llm." + u;
  }

  function getConfig() {
    try { return JSON.parse(localStorage.getItem(configKey()) || "null"); }
    catch (e) { return null; }
  }

  function saveConfig(cfg) {
    localStorage.setItem(configKey(), JSON.stringify(cfg || {}));
  }

  function clearConfig() {
    localStorage.removeItem(configKey());
  }

  function hasPersonalKey() {
    var c = getConfig();
    return !!(c && c.apiKey);
  }

  // True when the user explicitly switched away from the included AI.
  function prefersOwnKey() {
    var c = getConfig();
    return !!(c && c.apiKey && c.useOwnKey === true);
  }

  function findProvider(id) {
    for (var i = 0; i < PROVIDERS.length; i++) if (PROVIDERS[i].id === id) return PROVIDERS[i];
    return null;
  }

  /* ---------- platform proxy ---------- */

  function publicConfig() { return global.WETALK_CONFIG || {}; }

  function proxyUrl() {
    return String(publicConfig().aiProxyUrl || "").trim();
  }

  function anonKey() {
    return String(publicConfig().supabaseAnonKey || "").trim();
  }

  function authSession() {
    var a = global.WetalkAuth;
    if (!a || typeof a.getSession !== "function") return null;
    try { return a.getSession() || null; } catch (e) { return null; }
  }

  // A real Supabase session carries the auth user id; Preview sessions do not.
  function hasAccountSession() {
    var s = authSession();
    return !!(s && typeof s.id === "string" && s.id);
  }

  function isPreviewAuth() {
    var a = global.WetalkAuth;
    if (!a || typeof a.isPreviewMode !== "function") return false;
    try { return !!a.isPreviewMode(); } catch (e) { return false; }
  }

  // Is the included AI deployed and usable for this visitor right now?
  function isPlatformAvailable() {
    var a = global.WetalkAuth;
    if (!a || typeof a.getAccessToken !== "function" || typeof a.getClient !== "function") return false;
    if (isPreviewAuth()) return false;
    var client = null;
    try { client = a.getClient(); } catch (e) { client = null; }
    return !!(proxyUrl() && hasAccountSession() && client);
  }

  // Is the included AI the mode actually in use (available AND not opted out)?
  function isPlatformMode() {
    return isPlatformAvailable() && !prefersOwnKey();
  }

  /* ---------- daily quota tracking (platform mode) ---------- */

  function todayKey() {
    return new Date().toISOString().slice(0, 10);
  }

  function readQuota() {
    try {
      var q = JSON.parse(localStorage.getItem(QUOTA_KEY) || "null");
      if (q && typeof q === "object") return q;
    } catch (e) {}
    return null;
  }

  function quotaLimit() {
    var q = readQuota();
    if (q && typeof q.limit === "number" && q.limit > 0) return q.limit;
    return DEFAULT_DAILY_LIMIT;
  }

  // -> { remaining: number|null, limit: number, day: "YYYY-MM-DD" }
  // remaining is null until the first platform response tells us the real value.
  function getQuota() {
    var day = todayKey();
    var q = readQuota();
    var limit = quotaLimit();
    if (q && q.day === day) {
      return {
        remaining: typeof q.remaining === "number" ? Math.max(0, q.remaining) : null,
        limit: limit,
        day: day
      };
    }
    return { remaining: null, limit: limit, day: day };
  }

  function getRemainingQuota() {
    return getQuota().remaining;
  }

  function setQuota(remaining, limit) {
    var lim = (typeof limit === "number" && limit > 0) ? limit : quotaLimit();
    var rem = (typeof remaining === "number" && isFinite(remaining)) ? Math.max(0, Math.round(remaining)) : null;
    try {
      localStorage.setItem(QUOTA_KEY, JSON.stringify({ remaining: rem, limit: lim, day: todayKey() }));
    } catch (e) { /* ignore */ }
  }

  /* ---------- errors + events ---------- */

  function aiError(code, message) {
    var err = new Error(message);
    err.code = code;
    err.friendly = true;
    return err;
  }

  function notify(name, detail) {
    try {
      if (typeof global.CustomEvent === "function") {
        global.dispatchEvent(new global.CustomEvent(name, { detail: detail }));
      } else if (typeof global.Event === "function") {
        global.dispatchEvent(new global.Event(name));
      }
    } catch (e) { /* listeners are optional */ }
  }

  function mapPlatformError(status, data) {
    var code = data && data.error;
    if (code === "quota_exceeded" || status === 429) {
      return aiError("quota_exceeded", "Daily AI limit reached - using offline scoring.");
    }
    if (code === "unauthorized" || status === 401 || status === 403) {
      return aiError("unauthorized", "Your session expired - sign in again to use the included AI.");
    }
    if (code === "no_key" || status === 503) {
      return aiError("no_key", "Included AI is not configured on the server yet - use your own API key or offline mode.");
    }
    if (code === "bad_request" || status === 413) {
      return aiError("bad_request", "This request is too big for the included AI - try a shorter speech.");
    }
    return aiError("upstream", "The included AI is temporarily unavailable - try again or use offline mode.");
  }

  function clampNumber(value, fallback, min, max) {
    var n = Number(value);
    if (!isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  /* ---------- request builders ---------- */

  function platformChat(messages, opts) {
    if (!isPlatformAvailable()) {
      return Promise.reject(aiError("unavailable", "The included AI is not available - sign in first."));
    }

    var tokenPromise;
    try {
      tokenPromise = Promise.resolve(global.WetalkAuth.getAccessToken());
    } catch (e) {
      tokenPromise = Promise.reject(e);
    }

    return tokenPromise.then(function (token) {
      if (!token) throw aiError("unauthorized", "Your session expired - sign in again to use the included AI.");

      var payload = {
        messages: messages,
        temperature: clampNumber(opts.temperature, 0.7, 0, PROXY_MAX_TEMPERATURE),
        max_tokens: Math.round(clampNumber(opts.max_tokens, PROXY_MAX_TOKENS, 1, PROXY_MAX_TOKENS))
      };
      var headers = {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + token
      };
      var key = anonKey();
      if (key) headers.apikey = key;

      return fetch(proxyUrl(), {
        method: "POST",
        headers: headers,
        body: JSON.stringify(payload)
      });
    }).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) {}
        if (!res.ok) {
          var mapped = mapPlatformError(res.status, data);
          if (mapped.code === "quota_exceeded") setQuota(0);
          throw mapped;
        }
        if (!data || typeof data.content !== "string" || !data.content.trim()) {
          throw aiError("upstream", "The included AI returned an empty response - try again or use offline mode.");
        }
        if (typeof data.remaining === "number") setQuota(data.remaining, data.limit);
        notify("wetalk:ai", {
          remaining: getQuota().remaining,
          limit: getQuota().limit,
          source: "platform"
        });
        return data.content;
      });
    }).catch(function (err) {
      var mapped = err;
      if (!err || !err.code) {
        mapped = aiError("upstream", "Could not reach the included AI - check your connection or use offline mode.");
      }
      notify("wetalk:ai-error", {
        code: mapped.code,
        message: mapped.message,
        source: "platform"
      });
      throw mapped;
    });
  }

  function personalEndpoint(cfg) {
    var base = (cfg.baseUrl || "").trim().replace(/\/+$/, "");
    if (base.indexOf("/chat/completions") !== -1) return base;
    return base + "/chat/completions";
  }

  function isDesktopMode() {
    return typeof window !== "undefined" && window.WETALK_DESKTOP === true;
  }

  function handleResponse(res) {
    if (!res.ok) {
      return res.text().then(function (t) {
        throw new Error("API error " + res.status + (t ? ": " + t.slice(0, 300) : ""));
      });
    }
    return res.json().then(function (data) {
      var choice = data.choices && data.choices[0];
      var msg = choice && choice.message;
      var content = msg ? (msg.content || "") : "";
      if (!content && choice && choice.text) content = choice.text;
      if (!content && data.output_text) content = data.output_text;
      if (!content) throw new Error("Empty response from the model.");
      return content;
    });
  }

  function personalChat(messages, opts) {
    var cfg = getConfig();
    if (!cfg || !cfg.apiKey) return Promise.reject(new Error("No API key configured."));
    if (!cfg.baseUrl) return Promise.reject(new Error("No API base URL configured."));

    opts = opts || {};
    var payload = {
      model: cfg.model,
      messages: messages,
      temperature: (opts.temperature != null ? opts.temperature : 0.7),
      max_tokens: (opts.max_tokens != null ? opts.max_tokens : 2000)
    };

    if (isDesktopMode()) {
      // Native app: route through the local relay (same origin, no CORS).
      return fetch("/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Wetalk-Base-Url": cfg.baseUrl,
          "X-Wetalk-Api-Key": cfg.apiKey
        },
        body: JSON.stringify(payload)
      }).then(handleResponse);
    }

    // Browser mode: call the provider directly.
    return fetch(personalEndpoint(cfg), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + cfg.apiKey
      },
      body: JSON.stringify(payload)
    }).then(handleResponse);
  }

  /* ---------- public chat ---------- */

  // true when at least one AI mode is ready (included AI or personal key).
  function hasConfig() {
    if (isPlatformMode()) return true;
    return hasPersonalKey();
  }

  function chat(messages, opts) {
    opts = opts || {};
    if (!Array.isArray(messages) || !messages.length) {
      return Promise.reject(new Error("No messages to send."));
    }

    if (isPlatformMode()) {
      return platformChat(messages, opts).catch(function (err) {
        // Do not silently spend the personal key when the account AI said no;
        // pages already fall back to offline heuristics.
        if (err && (err.code === "quota_exceeded" || err.code === "unauthorized")) throw err;
        if (hasPersonalKey()) return personalChat(messages, opts);
        throw err;
      });
    }

    if (hasPersonalKey()) return personalChat(messages, opts);

    return Promise.reject(aiError("no_config",
      "AI is not connected - sign in to use the included AI or add your own API key."));
  }

  function testConnection() {
    var cfg = getConfig();
    if (!cfg || !cfg.apiKey) return Promise.reject(new Error("Enter an API key first."));
    return personalChat([{ role: "user", content: "Reply with the single word: ok" }], { max_tokens: 8 });
  }

  // Pull in a provider configured by the old native app (llm_config.json),
  // so the user does not have to re-enter their key in the web UI.
  function importLegacyConfig() {
    if (hasPersonalKey()) return Promise.resolve(true);
    // /api/config only exists in the Wetalk desktop app's local server; the
    // static web build must not probe it (it would 404 on every page load).
    if (!isDesktopMode()) return Promise.resolve(false);
    return fetch("/api/config").then(function (r) { return r.json(); }).then(function (data) {
      if (data && data.api_key && data.base_url) {
        saveConfig({
          provider: data.provider || "custom",
          baseUrl: data.base_url,
          model: data.model || "",
          apiKey: data.api_key,
          useOwnKey: true
        });
        return true;
      }
      return false;
    }).catch(function () { return false; });
  }

  /* ---------- offline helper used by the UI ---------- */

  function quotaSummary() {
    var q = getQuota();
    var remaining = (q.remaining === null) ? q.limit : q.remaining;
    return remaining + " of " + q.limit + " requests left today";
  }

  global.WetalkLLM = {
    PROVIDERS: PROVIDERS,
    getProviders: function () { return PROVIDERS; },
    findProvider: findProvider,
    getConfig: getConfig,
    saveConfig: saveConfig,
    clearConfig: clearConfig,
    hasConfig: hasConfig,
    hasPersonalKey: hasPersonalKey,
    importLegacyConfig: importLegacyConfig,
    chat: chat,
    testConnection: testConnection,
    // platform mode + quota
    isPlatformAvailable: isPlatformAvailable,
    isPlatformMode: isPlatformMode,
    getQuota: getQuota,
    getRemainingQuota: getRemainingQuota,
    quotaLimit: quotaLimit,
    quotaSummary: quotaSummary,
    // limits mirrored from the Edge Function (for UI hints)
    PLATFORM_MAX_INPUT_CHARS: PROXY_MAX_INPUT_CHARS,
    PLATFORM_MAX_TOKENS: PROXY_MAX_TOKENS
  };
})(typeof window !== "undefined" ? window : this);
