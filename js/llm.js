/* ============================================================
   Wetalk — LLM provider module

   Lets each account bring their own API key and choose from a
   wide variety of OpenAI-compatible providers (CC Switch style).
   Calls the user's provider directly from the browser.

   NOTE: the key is stored in localStorage (per account) and is only
   ever sent to the provider the user selected. Some providers block
   browser (CORS) requests; use a CORS-enabled provider or a backend
   proxy for those. A production build should proxy through a backend
   so the key never lives in the browser.
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

  function hasConfig() {
    var c = getConfig();
    return !!(c && c.apiKey);
  }

  function findProvider(id) {
    for (var i = 0; i < PROVIDERS.length; i++) if (PROVIDERS[i].id === id) return PROVIDERS[i];
    return null;
  }

  function endpointFor(cfg) {
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

  function chat(messages, opts) {
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
    return fetch(endpointFor(cfg), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + cfg.apiKey
      },
      body: JSON.stringify(payload)
    }).then(handleResponse);
  }

  function testConnection() {
    var cfg = getConfig();
    if (!cfg || !cfg.apiKey) return Promise.reject(new Error("Enter an API key first."));
    return chat([{ role: "user", content: "Reply with the single word: ok" }], { max_tokens: 8 });
  }

  // Pull in a provider configured by the old native app (llm_config.json),
  // so the user does not have to re-enter their key in the web UI.
  function importLegacyConfig() {
    if (hasConfig()) return Promise.resolve(true);
    return fetch("/api/config").then(function (r) { return r.json(); }).then(function (data) {
      if (data && data.api_key && data.base_url) {
        saveConfig({
          provider: data.provider || "custom",
          baseUrl: data.base_url,
          model: data.model || "",
          apiKey: data.api_key
        });
        return true;
      }
      return false;
    }).catch(function () { return false; });
  }

  global.WetalkLLM = {
    PROVIDERS: PROVIDERS,
    getProviders: function () { return PROVIDERS; },
    findProvider: findProvider,
    getConfig: getConfig,
    saveConfig: saveConfig,
    clearConfig: clearConfig,
    hasConfig: hasConfig,
    importLegacyConfig: importLegacyConfig,
    chat: chat,
    testConnection: testConnection
  };
})(window);
