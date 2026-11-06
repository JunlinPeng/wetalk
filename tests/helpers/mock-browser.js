/* ============================================================
   Wetalk QA - mock browser helper

   Loads the site's classic (IIFE-style) scripts into a fake
   window backed by an in-memory localStorage, so unit tests can
   exercise pure browser logic without a real browser or network.

   Usage:
     const { createWindow, loadScripts } = require("../helpers/mock-browser");
     const win = createWindow();
     loadScripts(win, ["js/config.js", "js/auth.js"]);
     const auth = win.WetalkAuth;
   ============================================================ */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

// ---------- in-memory storage ----------
function createStorage(seed) {
  const map = new Map();
  if (seed) {
    for (const key of Object.keys(seed)) {
      const value = seed[key];
      map.set(String(key), typeof value === "string" ? value : JSON.stringify(value));
    }
  }
  return {
    getItem(key) {
      key = String(key);
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(String(key), String(value));
    },
    removeItem(key) {
      map.delete(String(key));
    },
    clear() {
      map.clear();
    },
    key(index) {
      const keys = Array.from(map.keys());
      return index >= 0 && index < keys.length ? keys[index] : null;
    },
    get length() {
      return map.size;
    },
    // test helper
    _dump() {
      return Object.fromEntries(map.entries());
    },
  };
}

// ---------- minimal DOM ----------
function createElement(tagName) {
  const listeners = new Map();
  const element = {
    tagName: String(tagName || "div").toUpperCase(),
    id: "",
    className: "",
    textContent: "",
    innerHTML: "",
    type: "",
    value: "",
    disabled: false,
    style: {},
    dataset: {},
    children: [],
    parentNode: null,
    firstChild: null,
    classList: {
      _set: new Set(),
      add() {
        for (const c of arguments) this._set.add(String(c));
      },
      remove() {
        for (const c of arguments) this._set.delete(String(c));
      },
      toggle(c) {
        if (this._set.has(c)) this._set.delete(c);
        else this._set.add(c);
      },
      contains(c) {
        return this._set.has(c);
      },
    },
    appendChild(child) {
      element.children.push(child);
      element.firstChild = element.children[0];
      child.parentNode = element;
      return child;
    },
    insertBefore(child, ref) {
      const idx = ref ? element.children.indexOf(ref) : 0;
      if (idx === -1) element.children.push(child);
      else element.children.splice(idx, 0, child);
      element.firstChild = element.children[0];
      child.parentNode = element;
      return child;
    },
    prepend(child) {
      return element.insertBefore(child, element.children[0]);
    },
    removeChild(child) {
      const idx = element.children.indexOf(child);
      if (idx !== -1) element.children.splice(idx, 1);
      element.firstChild = element.children[0] || null;
      return child;
    },
    remove() {
      if (element.parentNode) element.parentNode.removeChild(element);
    },
    setAttribute(name, value) {
      if (name === "class") element.className = String(value);
      else if (name === "id") element.id = String(value);
      else element[name] = value;
    },
    getAttribute(name) {
      if (name === "class") return element.className;
      return element[name] === undefined ? null : element[name];
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const list = listeners.get(type) || [];
      const idx = list.indexOf(fn);
      if (idx !== -1) list.splice(idx, 1);
    },
    dispatchEvent(event) {
      const list = (listeners.get(event.type) || []).slice();
      for (const fn of list) fn(event);
      return true;
    },
    focus() {},
    blur() {},
    click() {
      element.dispatchEvent({ type: "click", target: element });
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    closest() {
      return null;
    },
    matches() {
      return false;
    },
  };
  return element;
}

function createDocument() {
  const byId = new Map();
  const documentListeners = new Map();
  const body = createElement("body");
  const doc = {
    readyState: "complete",
    body,
    head: createElement("head"),
    documentElement: createElement("html"),
    title: "",
    createElement,
    createTextNode(text) {
      return { nodeType: 3, textContent: String(text) };
    },
    getElementById(id) {
      return byId.get(String(id)) || null;
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    getElementsByTagName() {
      return [];
    },
    addEventListener(type, fn) {
      if (!documentListeners.has(type)) documentListeners.set(type, []);
      documentListeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const list = documentListeners.get(type) || [];
      const idx = list.indexOf(fn);
      if (idx !== -1) list.splice(idx, 1);
    },
    _register(id) {
      const element = createElement("div");
      element.id = String(id);
      byId.set(String(id), element);
      return element;
    },
    _fire(type) {
      for (const fn of (documentListeners.get(type) || []).slice()) fn({ type });
    },
  };
  return doc;
}

// ---------- fake window ----------
/**
 * Create a fake browser window. Pass a shared storage object to
 * simulate a page reload / second tab sharing localStorage.
 */
function createWindow(options) {
  options = options || {};
  const storage = options.storage || createStorage(options.storageSeed);
  const sessionStorage = options.sessionStorage || createStorage();
  const document = createDocument();
  const redirects = [];
  const win = {};
  Object.assign(win, {
    localStorage: storage,
    sessionStorage,
    document,
    navigator: {
      userAgent: "WetalkUnitTest/1.0",
      language: "en-US",
      onLine: true,
      clipboard: { writeText: async () => {} },
    },
    crypto: webcrypto,
    TextEncoder: TextEncoder,
    TextDecoder: TextDecoder,
    URL: URL,
    URLSearchParams: URLSearchParams,
    atob: (s) => Buffer.from(String(s), "base64").toString("binary"),
    btoa: (s) => Buffer.from(String(s), "binary").toString("base64"),
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    setInterval: setInterval,
    clearInterval: clearInterval,
    requestAnimationFrame: (fn) => setTimeout(() => fn(Date.now()), 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
    console: console,
    fetch: async () => {
      throw new Error("unit tests must not access the network");
    },
    alert: () => {},
    confirm: () => true,
    prompt: () => null,
    matchMedia: () => ({
      matches: false,
      media: "",
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
    }),
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => true,
    history: {
      state: null,
      replaceState() {},
      pushState() {},
    },
    // captured navigation requests (location.replace / location.href = ...)
    __redirects: redirects,
    __storage: storage,
    __document: document,
  });

  win.location = {
    href: "http://localhost:8104/",
    origin: "http://localhost:8104",
    protocol: "http:",
    host: "localhost:8104",
    hostname: "localhost",
    port: "8104",
    pathname: "/",
    search: "",
    hash: "",
    replace(url) {
      const target = String(url);
      redirects.push(target);
      this.href = target;
    },
    assign(url) {
      const target = String(url);
      redirects.push(target);
      this.href = target;
    },
    reload() {},
  };

  if (options.config) {
    win.WETALK_CONFIG = options.config;
  }

  // A contextified global needs window === globalThis. Run the scripts through
  // vm so browser-only globals resolve from this sandbox.
  const context = vm.createContext(win);
  vm.runInContext("globalThis.window = globalThis; globalThis.self = globalThis; globalThis.top = globalThis;", context, {
    filename: "wetalk-mock-bootstrap.js",
  });
  win.__context = context;
  return win;
}

/**
 * Evaluate one of the site's classic scripts inside the fake window.
 * Returns the fake window for chaining.
 */
function loadScript(win, relPath) {
  const absPath = path.resolve(REPO_ROOT, relPath);
  const source = fs.readFileSync(absPath, "utf8");
  vm.runInContext(source, win.__context, { filename: absPath });
  return win;
}

/** Evaluate several scripts in order (page script order matters). */
function loadScripts(win, relPaths) {
  for (const relPath of relPaths) loadScript(win, relPath);
  return win;
}

/** Returns the source of a site script (used by structural tests). */
function readScript(relPath) {
  return fs.readFileSync(path.resolve(REPO_ROOT, relPath), "utf8");
}

/** True when a relative site file exists. */
function siteFileExists(relPath) {
  return fs.existsSync(path.resolve(REPO_ROOT, relPath));
}

module.exports = {
  REPO_ROOT,
  createStorage,
  createWindow,
  loadScript,
  loadScripts,
  readScript,
  siteFileExists,
};
