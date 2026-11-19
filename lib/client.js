window.__ModuleLoader__.load({ id: "dsh-interpret", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.js
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);
var import_react6 = require("react");

// src/client/audio.js
function resample(input, inputRate, outputRate = 16e3) {
  if (inputRate === outputRate || !input.length) return input;
  const ratio = inputRate / outputRate;
  const length = Math.max(1, Math.floor(input.length / ratio));
  const output = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const position = i * ratio;
    const index = Math.floor(position);
    const next = Math.min(index + 1, input.length - 1);
    const fraction = position - index;
    output[i] = input[index] * (1 - fraction) + input[next] * fraction;
  }
  return output;
}
function toPcm16(samples) {
  const output = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    const value = Math.max(-1, Math.min(1, samples[i]));
    output[i] = value < 0 ? Math.round(value * 32768) : Math.round(value * 32767);
  }
  return output;
}
var MicCapture = class {
  constructor({ onFrame, onLevel, onError }) {
    this.onFrame = onFrame;
    this.onLevel = onLevel;
    this.onError = onError;
    this.stream = null;
    this.ctx = null;
    this.source = null;
    this.processor = null;
    this.gain = null;
    this.active = false;
  }
  async start(deviceId, profile = "auto") {
    if (this.active) return;
    const profiles = {
      auto: { echoCancellation: false, noiseSuppression: true, autoGainControl: true },
      clean: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      raw: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
    };
    const audio = { channelCount: 1, ...profiles[profile] || profiles.auto };
    if (deviceId) audio.deviceId = { exact: deviceId };
    this.stream = await navigator.mediaDevices.getUserMedia({ audio, video: false });
    try {
      this.ctx = new AudioContext({ sampleRate: 16e3 });
    } catch {
      this.ctx = new AudioContext();
    }
    if (this.ctx.state === "suspended") await this.ctx.resume();
    this.sampleRate = this.ctx.sampleRate;
    this.frames = 0;
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.processor = this.ctx.createScriptProcessor(4096, 1, 1);
    this.processor.onaudioprocess = (event) => {
      try {
        const input = event.inputBuffer.getChannelData(0);
        const samples = this.ctx.sampleRate === 16e3 ? input : resample(input, this.ctx.sampleRate);
        const pcm = toPcm16(samples);
        let sum = 0;
        for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
        this.frames += 1;
        this.onLevel?.(Math.sqrt(sum / Math.max(1, samples.length)));
        this.onFrame?.(pcm.buffer);
      } catch (error) {
        this.onError?.(error);
      }
    };
    this.gain = this.ctx.createGain();
    this.gain.gain.value = 0;
    this.source.connect(this.processor);
    this.processor.connect(this.gain);
    this.gain.connect(this.ctx.destination);
    this.active = true;
  }
  stop() {
    this.active = false;
    try {
      this.processor?.disconnect();
    } catch {
    }
    try {
      this.source?.disconnect();
    } catch {
    }
    try {
      this.gain?.disconnect();
    } catch {
    }
    this.processor = null;
    this.source = null;
    this.gain = null;
    try {
      this.stream?.getTracks().forEach((track) => track.stop());
    } catch {
    }
    this.stream = null;
    try {
      this.ctx?.close();
    } catch {
    }
    this.ctx = null;
    this.onLevel?.(0);
  }
};

// src/client/controller.js
var EMPTY = {
  status: "loading",
  connection: "connecting",
  state: null,
  segments: [],
  busy: false,
  error: null,
  modelProgress: null,
  elapsed: 0,
  testBusy: false,
  testResult: null,
  audioInfo: null,
  dock: { available: false, registered: false, reason: "\u53F3\u4FA7\u680F\u52A0\u8F7D\u4E2D\u2026", mounted: false, expanded: false, open: false },
  draft: null,
  live: {},
  termSearch: { query: "", results: [], busy: false },
  glossary: null,
  history: null,
  historyView: null,
  models: null,
  mtRoutes: null,
  glossaryBusy: false
};
function messageOf(payload) {
  if (!payload) return "\u672A\u77E5\u9519\u8BEF";
  if (typeof payload === "string") return payload;
  return String(payload.message || payload.error?.message || "\u672A\u77E5\u9519\u8BEF");
}
var Controller = class {
  constructor() {
    this.snapshot = { ...EMPTY };
    this.listeners = /* @__PURE__ */ new Set();
    this.segmentMap = /* @__PURE__ */ new Map();
    this.es = null;
    this.timer = null;
    this.capture = new MicCapture({
      onFrame: (buffer) => this.postFrame(buffer),
      onLevel: (level) => this.setLevel(level),
      onError: (error) => this.fail(error)
    });
    this.inFlight = 0;
    this.lastReport = 0;
    this.disposed = false;
    this.resetting = false;
    this.resetEpoch = 0;
  }
  subscribe = (listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = () => this.snapshot;
  emit() {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
      }
    }
  }
  update(patch) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.emit();
  }
  setState(state, extra = {}) {
    this.update({ state, ...extra });
    this.syncTimer();
  }
  syncTimer() {
    const running = this.snapshot.state?.phase === "listening";
    if (running && !this.timer) {
      this.timer = setInterval(() => {
        const startedAt = this.snapshot.state?.startedAt;
        if (!startedAt) return;
        this.update({ elapsed: Date.now() - startedAt });
      }, 1e3);
    } else if (!running && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
  setLevel(level) {
    this.update({ level });
  }
  setDock(patch) {
    this.update({ dock: { ...this.snapshot.dock || {}, ...patch } });
  }
  report(type, extra = {}) {
    const now = Date.now();
    if (now - this.lastReport < 350) return;
    this.lastReport = now;
    fetch("/interpret/api/client-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type,
        connection: this.snapshot.connection,
        phase: this.snapshot.state?.phase || null,
        segments: this.snapshot.segments.length,
        draft: Boolean(this.snapshot.draft),
        error: this.snapshot.error || null,
        ...extra
      }),
      cache: "no-store"
    }).catch(() => {
    });
  }
  fail(error) {
    const message = error?.message ? messageOf(error) : messageOf(error);
    this.update({ error: message });
  }
  connect() {
    if (this.disposed || this.es) return;
    this.update({ connection: "connecting" });
    try {
      this.es = new EventSource("/interpret/api/events");
      this.es.onopen = () => {
        this.update({ connection: "open" });
      };
      this.es.onerror = () => {
        this.update({ connection: "closed" });
        this.startPolling();
      };
      this.es.onmessage = (event) => {
        let message;
        try {
          message = JSON.parse(event.data);
        } catch {
          return;
        }
        this.handleEvent(message?.type, message?.data);
      };
    } catch (error) {
      this.fail(error);
    }
    this.refresh();
    this.loadGlossary();
    this.loadSessions();
    this.loadModels();
    this.loadMtRoutes();
    this.startPolling(1800);
  }
  handleEvent(type, data) {
    if (!type) return;
    if (type === "state") {
      this.setState(data, { status: "ready", live: data?.live || this.snapshot.live });
      this.report("state");
      return;
    }
    if (type === "live") {
      const live = { ...this.snapshot.live };
      if (data?.cleared) delete live[data.track];
      else if (data?.track && data.en) live[data.track] = data;
      this.update({ live });
      return;
    }
    if (type === "draft") {
      if (data?.cleared) {
        if (!this.snapshot.draft || this.snapshot.draft.track === data.track) this.update({ draft: null });
      } else if (data?.en) {
        this.update({ draft: data });
      }
      return;
    }
    if (type === "caption") {
      if (!data?.id) return;
      if (this.snapshot.draft && this.snapshot.draft.track === data.track) this.update({ draft: null });
      if (this.snapshot.live[data.track]) {
        const live = { ...this.snapshot.live };
        delete live[data.track];
        this.update({ live });
      }
      this.segmentMap.set(data.id, data);
      const segments = [...this.segmentMap.values()].sort((a, b) => (a.seq || 0) - (b.seq || 0));
      if (segments.length > 800) {
        for (const segment of segments.slice(0, segments.length - 800)) this.segmentMap.delete(segment.id);
      }
      this.update({ segments: segments.slice(-800), status: "ready" });
      this.report("caption", { segmentStatus: data.status });
      return;
    }
    if (type === "stats") {
      const state = this.snapshot.state;
      if (state) this.update({ state: { ...state, stats: data } });
      return;
    }
    if (type === "model-progress") {
      this.update({ modelProgress: data });
      return;
    }
    if (type === "error") {
      this.update({ error: messageOf(data) });
      return;
    }
  }
  startPolling(intervalMs = 1200) {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      this.refresh();
    }, intervalMs);
  }
  stopPolling() {
    if (!this.pollTimer) return;
    clearInterval(this.pollTimer);
    this.pollTimer = null;
  }
  async request(path, options = {}) {
    const response = await fetch("/interpret/api" + path, {
      method: options.method || "GET",
      headers: options.body === void 0 ? void 0 : { "Content-Type": "application/json" },
      body: options.body === void 0 ? void 0 : JSON.stringify(options.body),
      cache: "no-store"
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch {
    }
    if (!response.ok || payload?.ok === false) {
      const error = new Error(messageOf(payload?.error));
      error.code = payload?.error?.code || "HTTP_" + response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }
  async refresh() {
    if (this.refreshing || this.resetting) return;
    this.refreshing = true;
    const epoch = this.resetEpoch;
    try {
      const payload = await this.request("/state");
      if (epoch !== this.resetEpoch) return;
      const map = /* @__PURE__ */ new Map();
      for (const segment of payload.segments || []) map.set(segment.id, segment);
      this.segmentMap = map;
      this.report("refresh", { count: payload.segments?.length || 0 });
      this.setState(payload.data, {
        status: "ready",
        segments: [...map.values()].sort((a, b) => (a.seq || 0) - (b.seq || 0)).slice(-800),
        error: payload.data?.error?.message || null,
        draft: null,
        live: payload.data?.live || {}
      });
    } catch (error) {
      this.update({ status: "error", error: messageOf(error) });
    } finally {
      this.refreshing = false;
    }
  }
  async start() {
    if (this.snapshot.busy) return;
    if (this.snapshot.state?.phase === "listening") return;
    this.update({ busy: true, error: null });
    try {
      await this.capture.start(void 0, this.snapshot.state?.config?.audioProfile || "auto");
      this.update({ audioInfo: { sampleRate: this.capture.sampleRate || 0, frames: this.capture.frames || 0 } });
      const payload = await this.request("/session/start", { method: "POST", body: { title: "" } });
      this.segmentMap = /* @__PURE__ */ new Map();
      this.setState(payload.data, { segments: [], draft: null, live: {}, error: null, status: "ready" });
    } catch (error) {
      this.capture.stop();
      this.update({ error: messageOf(error) });
    } finally {
      this.update({ busy: false });
    }
  }
  async stop() {
    if (this.snapshot.busy) return;
    this.update({ busy: true, error: null });
    this.capture.stop();
    try {
      const payload = await this.request("/session/stop", { method: "POST" });
      this.setState(payload.data, { status: "ready", live: {}, draft: null });
    } catch (error) {
      this.update({ error: messageOf(error) });
    } finally {
      this.update({ busy: false });
    }
  }
  async resetSession() {
    if (this.snapshot.busy) return;
    if (this.snapshot.state?.phase !== "completed") return;
    this.update({ busy: true, error: null });
    this.resetting = true;
    this.resetEpoch += 1;
    try {
      const payload = await this.request("/session/reset", { method: "POST" });
      this.segmentMap = /* @__PURE__ */ new Map();
      this.setState(payload.data, {
        status: "ready",
        segments: [],
        draft: null,
        live: {},
        historyView: null,
        error: null
      });
      await this.loadSessions();
    } catch (error) {
      this.update({ error: messageOf(error) });
    } finally {
      this.resetting = false;
      this.update({ busy: false });
    }
  }
  async prepare(providerId) {
    if (this.snapshot.busy) return;
    this.update({ busy: true, error: null, modelProgress: { phase: "starting" } });
    try {
      const payload = await this.request("/prepare", { method: "POST", body: { providerId } });
      this.setState(payload.data, { modelProgress: null, error: null, status: "ready" });
    } catch (error) {
      this.update({ error: messageOf(error) });
    } finally {
      this.update({ busy: false });
    }
  }
  async loadGlossary() {
    try {
      const payload = await this.request("/glossary");
      this.update({ glossary: payload.data });
      return payload.data;
    } catch (error) {
      this.update({ glossary: { count: 0, entries: [], error: messageOf(error) } });
      return null;
    }
  }
  async saveGlossary(entries) {
    this.update({ glossaryBusy: true });
    try {
      const payload = await this.request("/glossary", { method: "POST", body: { entries } });
      this.update({ glossary: payload.data, error: null });
      return payload.data;
    } catch (error) {
      this.update({ error: messageOf(error) });
      return null;
    } finally {
      this.update({ glossaryBusy: false });
    }
  }
  async importGlossary(text, format) {
    this.update({ glossaryBusy: true });
    try {
      const payload = await this.request("/glossary", { method: "POST", body: { text, format } });
      this.update({ glossary: payload.data, error: null });
      return payload.data;
    } catch (error) {
      this.update({ error: messageOf(error) });
      return null;
    } finally {
      this.update({ glossaryBusy: false });
    }
  }
  async saveConfig(patch) {
    try {
      const payload = await this.request("/config", { method: "POST", body: patch });
      await this.refresh();
      await this.loadMtRoutes();
      return payload.data;
    } catch (error) {
      this.update({ error: messageOf(error) });
      return null;
    }
  }
  exportUrl(format, sessionId) {
    const suffix = sessionId ? "&session=" + encodeURIComponent(sessionId) : "";
    return "/interpret/api/export?format=" + encodeURIComponent(format) + suffix;
  }
  async loadModels() {
    try {
      const payload = await this.request("/models");
      this.update({ models: payload.data });
      return payload.data;
    } catch {
      return null;
    }
  }
  async loadMtRoutes() {
    try {
      const payload = await this.request("/translate/routes");
      const state = this.snapshot.state;
      const enabled = state?.config?.autoTranslate !== false;
      this.update({
        mtRoutes: payload.data,
        state: state ? { ...state, mt: enabled ? payload.data.picked : null, mtWarning: enabled ? payload.data.warning || "" : "" } : state
      });
      return payload.data;
    } catch (error) {
      this.update({ mtRoutes: { routes: [], picked: null, warning: "", error: messageOf(error) } });
      return null;
    }
  }
  async prepareVad() {
    try {
      await this.request("/models/vad/prepare", { method: "POST", body: {} });
      await this.loadModels();
      await this.refresh();
    } catch (error) {
      this.update({ error: messageOf(error) });
    }
  }
  async searchTerminology(query, domain = "") {
    const value = String(query || "").trim();
    if (!value) {
      this.update({ termSearch: { query: "", results: [], busy: false } });
      return [];
    }
    this.update({ termSearch: { ...this.snapshot.termSearch, query: value, busy: true } });
    try {
      const params = new URLSearchParams({ q: value, limit: "12" });
      if (domain && domain !== "auto" && domain !== "all") params.set("domain", domain);
      const payload = await this.request("/terminology/search?" + params.toString());
      const results = payload.data || [];
      this.update({ termSearch: { query: value, results, busy: false } });
      return results;
    } catch (error) {
      this.update({ termSearch: { query: value, results: [], busy: false }, error: messageOf(error) });
      return [];
    }
  }
  async prepareStreaming() {
    try {
      await this.request("/models/streaming/prepare", { method: "POST", body: {} });
      await this.loadModels();
      await this.refresh();
    } catch (error) {
      this.update({ error: messageOf(error) });
    }
  }
  async loadSessions() {
    try {
      const payload = await this.request("/sessions");
      this.update({ history: payload.data || [] });
      return payload.data;
    } catch (error) {
      this.update({ history: [] });
      return null;
    }
  }
  async openSession(id) {
    try {
      const payload = await this.request("/sessions/" + encodeURIComponent(id));
      this.update({ historyView: payload.data });
    } catch (error) {
      this.update({ error: messageOf(error) });
    }
  }
  closeSession() {
    this.update({ historyView: null });
  }
  async deleteSession(id) {
    try {
      await this.request("/sessions/" + encodeURIComponent(id) + "?confirm=1", { method: "DELETE" });
      this.update({ historyView: null });
      await this.loadSessions();
    } catch (error) {
      this.update({ error: messageOf(error) });
    }
  }
  async renameSession(id, title) {
    try {
      await this.request("/sessions/" + encodeURIComponent(id), { method: "PATCH", body: { title } });
      await this.loadSessions();
    } catch (error) {
      this.update({ error: messageOf(error) });
    }
  }
  async cancelPrepare(providerId) {
    try {
      await this.request("/prepare/cancel", { method: "POST", body: { providerId } });
      await this.refresh();
    } catch (error) {
      this.update({ error: messageOf(error) });
    }
  }
  async translateTest(text) {
    const value = String(text || "").trim();
    if (!value || this.snapshot.testBusy) return;
    this.update({ testBusy: true, testResult: null });
    try {
      const payload = await this.request("/translate", { method: "POST", body: { text: value } });
      this.update({ testResult: { ok: true, ...payload.data } });
    } catch (error) {
      this.update({ testResult: { ok: false, message: messageOf(error) } });
    } finally {
      this.update({ testBusy: false });
    }
  }
  postFrame(buffer) {
    if (this.disposed || this.snapshot.state?.phase !== "listening") return;
    if (this.inFlight >= 3) return;
    this.inFlight += 1;
    fetch("/interpret/api/audio/mic", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: buffer,
      cache: "no-store"
    }).catch(() => {
    }).finally(() => {
      this.inFlight -= 1;
    });
  }
  dispose() {
    this.disposed = true;
    this.capture.stop();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    try {
      this.es?.close();
    } catch {
    }
    this.es = null;
    this.stopPolling();
    this.listeners.clear();
  }
};

// src/client/panel.js
var import_react4 = require("react");

// src/client/icon.js
var import_react = require("react");
function InterpretIcon(props = {}) {
  const size = props.size || 20;
  return (0, import_react.createElement)(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.8,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      "aria-hidden": true
    },
    (0, import_react.createElement)("rect", { x: 3, y: 5, width: 18, height: 14, rx: 3 }),
    (0, import_react.createElement)("path", { d: "M7 10h6M7 14h10M16 10h1" })
  );
}

// src/client/rows.js
var import_react2 = require("react");
function fmtClock(ms) {
  const total = Math.max(0, Math.round(Number(ms || 0) / 1e3));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0");
}
function fmtOffset(ms) {
  const total = Math.max(0, Number(ms || 0));
  const minutes = Math.floor(total / 6e4);
  const seconds = Math.floor(total % 6e4 / 1e3);
  const tenth = Math.floor(total % 1e3 / 100);
  return String(minutes).padStart(2, "0") + ":" + String(seconds).padStart(2, "0") + "." + tenth;
}
function StatusBadge({ segment }) {
  if (!segment) return null;
  if (segment.status === "done") return null;
  if (segment.status === "dropped") {
    return (0, import_react2.createElement)("span", { className: "di-meta di-badge dropped" }, "\u5DF2\u8FC7\u6EE4" + (segment.reason ? " \xB7 " + segment.reason : ""));
  }
  if (segment.status === "error") {
    return (0, import_react2.createElement)("span", { className: "di-meta di-badge error" }, "\u5931\u8D25");
  }
  if (segment.qa?.length) {
    return (0, import_react2.createElement)("span", { className: "di-meta di-badge", title: segment.qa.map((issue) => issue.code).join(", ") }, "\u9700\u6821\u5BF9");
  }
  if (segment.status === "translating") return (0, import_react2.createElement)("span", { className: "di-meta di-badge" }, "\u7FFB\u8BD1\u4E2D\u2026");
  if (segment.status === "asr") return (0, import_react2.createElement)("span", { className: "di-meta di-badge" }, "\u8BC6\u522B\u4E2D\u2026");
  return null;
}
function CaptionRow({ segment }) {
  return (0, import_react2.createElement)(
    "div",
    { className: "di-row" },
    (0, import_react2.createElement)(
      "div",
      { className: "di-meta" },
      (0, import_react2.createElement)("span", { className: "di-time" }, fmtOffset(segment.tStartMs)),
      (0, import_react2.createElement)("span", { className: "di-src" }, segment.track === "system" ? "\u7CFB\u7EDF\u97F3\u9891" : "\u9EA6\u514B\u98CE"),
      segment.asrMs ? (0, import_react2.createElement)("span", null, "ASR " + segment.asrMs + "ms") : null,
      segment.mtMs ? (0, import_react2.createElement)("span", null, "MT " + segment.mtMs + "ms") : null,
      segment.termCorrections?.length ? (0, import_react2.createElement)("span", {
        className: "di-badge",
        title: segment.termCorrections.map((item) => item.from + " \u2192 " + item.to).join("\n")
      }, "\u672F\u8BED\u6821\u6B63 \xD7" + segment.termCorrections.length) : null,
      (0, import_react2.createElement)(StatusBadge, { segment })
    ),
    (0, import_react2.createElement)("div", { className: "di-en" }, segment.en || "\u2026"),
    segment.zh ? (0, import_react2.createElement)("div", { className: "di-zh" }, segment.zh) : segment.status === "translating" ? (0, import_react2.createElement)("div", { className: "di-zh pending" }, "\u7FFB\u8BD1\u4E2D\u2026") : null,
    segment.error ? (0, import_react2.createElement)("div", { className: "di-note" }, segment.error.code + ": " + segment.error.message) : null
  );
}
function LiveRow({ item, showZh = true }) {
  if (!item?.en) return null;
  const track = item.track === "system" ? "\u7CFB\u7EDF\u97F3\u9891" : "\u9EA6\u514B\u98CE";
  return (0, import_react2.createElement)(
    "div",
    { className: "di-row di-live" },
    (0, import_react2.createElement)(
      "div",
      { className: "di-meta" },
      (0, import_react2.createElement)("span", { className: "di-time" }, "\u5B9E\u65F6"),
      (0, import_react2.createElement)("span", { className: "di-src" }, track),
      (0, import_react2.createElement)("span", { className: "di-badge" }, item.engine === "parakeet-rolling" ? "\u7CBE\u786E\u5B9E\u65F6" : "\u9010\u8BCD"),
      item.termCorrections?.length ? (0, import_react2.createElement)("span", {
        className: "di-badge",
        title: item.termCorrections.map((entry) => entry.from + " \u2192 " + entry.to).join("\n")
      }, "\u672F\u8BED\u6821\u6B63 \xD7" + item.termCorrections.length) : null
    ),
    (0, import_react2.createElement)("div", { className: "di-en di-live-en" }, item.en),
    showZh ? item.zh ? (0, import_react2.createElement)("div", { className: "di-zh provisional" }, item.zh) : (0, import_react2.createElement)("div", { className: "di-zh pending" }, "\u7FFB\u8BD1\u4E2D\u2026") : null
  );
}

// src/client/reader.js
var import_react3 = require("react");
var ACCEPT = ".pdf,.doc,.docx,.xlsx,.csv,.md,.pptx";
var MAX_BYTES = 100 * 1024 * 1024;
var LAST_KEY = "dsh-interpret.reader.last";
var FENCE = String.fromCharCode(96, 96, 96);
function fmtSize(bytes) {
  const n = Number(bytes || 0);
  if (n >= 1048576) return (n / 1048576).toFixed(1) + " MB";
  if (n >= 1024) return (n / 1024).toFixed(0) + " KB";
  return n + " B";
}
function isText(ext) {
  return ext === "md" || ext === "csv";
}
async function readJson(response) {
  let payload = null;
  try {
    payload = await response.json();
  } catch {
  }
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error?.message || "HTTP " + response.status);
  }
  return payload?.data;
}
async function readText(response) {
  const body = await response.text();
  if (!response.ok) {
    try {
      const payload = JSON.parse(body);
      throw new Error(payload?.error?.message || "HTTP " + response.status);
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error("HTTP " + response.status);
      throw error;
    }
  }
  return body;
}
function safeHref(url) {
  const value = String(url || "").trim();
  if (/^(https?:|mailto:|#|\/)/i.test(value)) return value;
  return "#";
}
function renderInline(text, keyPrefix = "i") {
  const source = String(text || "");
  const pattern = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|\[[^\]]+\]\([^)]+\)|\x60[^\x60]+\x60)/g;
  const nodes = [];
  let last = 0;
  let match;
  let index = 0;
  while ((match = pattern.exec(source)) !== null) {
    if (match.index > last) nodes.push(source.slice(last, match.index));
    const token = match[0];
    if (token.startsWith("**") || token.startsWith("__")) nodes.push((0, import_react3.createElement)("strong", { key: keyPrefix + index++ }, token.slice(2, -2)));
    else if (token.charCodeAt(0) === 96) nodes.push((0, import_react3.createElement)("code", { key: keyPrefix + index++ }, token.slice(1, -1)));
    else if (token.startsWith("[")) {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      if (link) nodes.push((0, import_react3.createElement)("a", { key: keyPrefix + index++, href: safeHref(link[2]), target: "_blank", rel: "noreferrer" }, link[1]));
      else nodes.push(token);
    } else nodes.push((0, import_react3.createElement)("em", { key: keyPrefix + index++ }, token.slice(1, -1)));
    last = pattern.lastIndex;
  }
  if (last < source.length) nodes.push(source.slice(last));
  return nodes;
}
function parseCsv(text) {
  const source = String(text || "");
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") field += char;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
function CsvTable({ text }) {
  const rows = (0, import_react3.useMemo)(() => parseCsv(text), [text]);
  if (!rows.length) return (0, import_react3.createElement)("div", { className: "di-reader-state" }, "CSV \u6CA1\u6709\u5185\u5BB9\u3002");
  const width = Math.min(80, Math.max(...rows.map((row) => row.length)));
  const header = rows[0];
  const body = rows.slice(1, 2001);
  const head = (0, import_react3.createElement)("thead", null, (0, import_react3.createElement)("tr", null, Array.from({ length: width }, (_, i) => (0, import_react3.createElement)("th", { key: "h" + i }, header[i] || ""))));
  const columnKeys = Array.from({ length: width }, (_, i) => i);
  const lines = body.map((row, r) => (0, import_react3.createElement)("tr", { key: "r" + r }, columnKeys.map((c) => (0, import_react3.createElement)("td", { key: "c" + c }, row[c] || ""))));
  const table = (0, import_react3.createElement)("table", { className: "di-reader-table" }, head, (0, import_react3.createElement)("tbody", null, lines));
  return (0, import_react3.createElement)(
    "div",
    { className: "di-reader-table-wrap" },
    rows.length > 2001 ? (0, import_react3.createElement)("div", { className: "di-reader-hint" }, "\u8868\u683C\u8D85\u8FC7 2000 \u884C\uFF0C\u5DF2\u622A\u65AD\u3002") : null,
    table
  );
}
function MarkdownView({ text }) {
  const nodes = (0, import_react3.useMemo)(() => {
    const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
    const result = [];
    let i = 0;
    let key = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (/^\s*$/.test(line)) {
        i += 1;
        continue;
      }
      if (line.startsWith(FENCE)) {
        const code = [];
        i += 1;
        while (i < lines.length && !lines[i].startsWith(FENCE)) {
          code.push(lines[i]);
          i += 1;
        }
        i += 1;
        result.push((0, import_react3.createElement)("pre", { key: "p" + key++ }, (0, import_react3.createElement)("code", null, code.join("\n"))));
        continue;
      }
      const heading = /^(#{1,6})\s+(.*)$/.exec(line);
      if (heading) {
        const level = Math.min(6, heading[1].length);
        result.push((0, import_react3.createElement)("h" + level, { key: "h" + key++ }, renderInline(heading[2], "h" + key)));
        i += 1;
        continue;
      }
      if (/^>\s?/.test(line)) {
        const quote = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) {
          quote.push(lines[i].replace(/^>\s?/, ""));
          i += 1;
        }
        result.push((0, import_react3.createElement)("blockquote", { key: "q" + key++ }, renderInline(quote.join(" "), "q" + key)));
        continue;
      }
      if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
        const ordered = /^\s*\d+\.\s+/.test(line);
        const items = [];
        while (i < lines.length && (ordered ? /^\s*\d+\.\s+/.test(lines[i]) : /^\s*[-*+]\s+/.test(lines[i]))) {
          items.push(lines[i].replace(ordered ? /^\s*\d+\.\s+/ : /^\s*[-*+]\s+/, ""));
          i += 1;
        }
        result.push((0, import_react3.createElement)(ordered ? "ol" : "ul", { key: "l" + key++ }, items.map((item, index) => (0, import_react3.createElement)("li", { key: index }, renderInline(item, "li" + key + index)))));
        continue;
      }
      if (line.includes("|") && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|/.test(lines[i + 1])) {
        const split = (row) => row.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((cell) => cell.trim());
        const header = split(line);
        i += 2;
        const body = [];
        while (i < lines.length && lines[i].includes("|")) {
          body.push(split(lines[i]));
          i += 1;
        }
        const head = (0, import_react3.createElement)("thead", null, (0, import_react3.createElement)("tr", null, header.map((cell, index) => (0, import_react3.createElement)("th", { key: index }, renderInline(cell, "th" + index)))));
        const bodyRows = body.map((row, rowIndex) => (0, import_react3.createElement)("tr", { key: rowIndex }, row.map((cell, cellIndex) => (0, import_react3.createElement)("td", { key: cellIndex }, renderInline(cell, "td" + rowIndex + cellIndex)))));
        result.push((0, import_react3.createElement)("table", { key: "t" + key++, className: "di-reader-table" }, head, (0, import_react3.createElement)("tbody", null, bodyRows)));
        continue;
      }
      const paragraph = [line];
      i += 1;
      while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(#{1,6}\s|>|\s*[-*+]\s+|\s*\d+\.\s+)/.test(lines[i]) && !lines[i].startsWith(FENCE) && !(lines[i].includes("|") && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|/.test(lines[i + 1]))) {
        paragraph.push(lines[i]);
        i += 1;
      }
      result.push((0, import_react3.createElement)("p", { key: "p" + key++ }, renderInline(paragraph.join(" "), "p" + key)));
    }
    return result;
  }, [text]);
  return (0, import_react3.createElement)("div", { className: "di-reader-markdown" }, nodes);
}
function Loading() {
  return (0, import_react3.createElement)("div", { className: "di-reader-state" }, (0, import_react3.createElement)("span", { className: "di-reader-spinner" }), (0, import_react3.createElement)("span", null, "\u6B63\u5728\u52A0\u8F7D\u8BB2\u4E49\u2026"));
}
function ReaderPane({ onClose }) {
  const [files, setFiles] = (0, import_react3.useState)([]);
  const [currentId, setCurrentId] = (0, import_react3.useState)(null);
  const [meta, setMeta] = (0, import_react3.useState)(null);
  const [status, setStatus] = (0, import_react3.useState)("idle");
  const [error, setError] = (0, import_react3.useState)(null);
  const [html, setHtml] = (0, import_react3.useState)("");
  const [text, setText] = (0, import_react3.useState)("");
  const [pdfUrl, setPdfUrl] = (0, import_react3.useState)("");
  const [uploading, setUploading] = (0, import_react3.useState)(false);
  const [dragging, setDragging] = (0, import_react3.useState)(false);
  const [reloadToken, setReloadToken] = (0, import_react3.useState)(0);
  const inputRef = (0, import_react3.useRef)(null);
  const objectUrlRef = (0, import_react3.useRef)("");
  const choose = (next) => {
    setMeta(next || null);
    setCurrentId(next?.id || null);
    setError(null);
    try {
      if (next) localStorage.setItem(LAST_KEY, next.id);
      else localStorage.removeItem(LAST_KEY);
    } catch {
    }
  };
  const loadFiles = async () => {
    try {
      const response = await fetch("/interpret/api/reader/files", { cache: "no-store" });
      const list = await readJson(response) || [];
      setFiles(list);
      let saved = "";
      try {
        saved = localStorage.getItem(LAST_KEY) || "";
      } catch {
      }
      const next = list.find((item) => item.id === saved) || list[0] || null;
      if (next) choose(next);
      return list;
    } catch (err) {
      setError(String(err?.message || err));
      return [];
    }
  };
  (0, import_react3.useEffect)(() => {
    loadFiles();
  }, []);
  (0, import_react3.useEffect)(() => {
    if (!meta) {
      setStatus("idle");
      setHtml("");
      setText("");
      setPdfUrl("");
      return void 0;
    }
    let cancelled = false;
    let url = "";
    setStatus("loading");
    setError(null);
    setHtml("");
    setText("");
    setPdfUrl("");
    const run = async () => {
      try {
        if (meta.ext === "pdf") {
          const response = await fetch("/interpret/api/reader/files/" + encodeURIComponent(meta.id) + "/raw", { cache: "no-store" });
          if (!response.ok) throw new Error("PDF \u52A0\u8F7D\u5931\u8D25\uFF1AHTTP " + response.status);
          const blob = await response.blob();
          url = URL.createObjectURL(blob);
          objectUrlRef.current = url;
          if (!cancelled) {
            setPdfUrl(url);
            setStatus("ready");
          }
        } else if (isText(meta.ext)) {
          const response = await fetch("/interpret/api/reader/files/" + encodeURIComponent(meta.id) + "/raw", { cache: "no-store" });
          const body = await readText(response);
          if (!cancelled) {
            setText(body);
            setStatus("ready");
          }
        } else {
          const response = await fetch("/interpret/api/reader/files/" + encodeURIComponent(meta.id) + "/html", { cache: "no-store" });
          const body = await readText(response);
          if (!cancelled) {
            setHtml(body);
            setStatus("ready");
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(String(err?.message || err));
          setStatus("error");
        }
      }
    };
    run();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
      if (objectUrlRef.current === url) objectUrlRef.current = "";
    };
  }, [meta?.id, meta?.ext, reloadToken]);
  const upload = async (file) => {
    if (!file || uploading) return;
    if (file.size > MAX_BYTES) {
      setError("\u6587\u4EF6\u8D85\u8FC7 100MB \u9650\u5236");
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const response = await fetch("/interpret/api/reader/files?name=" + encodeURIComponent(file.name), {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: await file.arrayBuffer()
      });
      const saved = await readJson(response);
      setFiles((previous) => [saved, ...previous.filter((item) => item.id !== saved.id)]);
      choose(saved);
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };
  const removeCurrent = async () => {
    if (!meta) return;
    if (!window.confirm("\u5220\u9664\u8FD9\u4EFD\u8BB2\u4E49\uFF1F")) return;
    try {
      const response = await fetch("/interpret/api/reader/files/" + encodeURIComponent(meta.id), { method: "DELETE" });
      await readJson(response);
      const next = files.filter((item) => item.id !== meta.id);
      setFiles(next);
      choose(next[0] || null);
    } catch (err) {
      setError(String(err?.message || err));
    }
  };
  const onDrop = (event) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) upload(file);
  };
  const title = meta?.name || "\u672A\u9009\u62E9\u6587\u4EF6";
  let content;
  if (!meta) {
    content = (0, import_react3.createElement)(
      "div",
      { className: "di-reader-empty" },
      (0, import_react3.createElement)("strong", null, "\u6253\u5F00\u8BB2\u4E49\u6587\u4EF6"),
      (0, import_react3.createElement)("p", null, "\u652F\u6301 PDF\u3001Word\u3001Excel\u3001PPT\u3001CSV\u3001Markdown\u3002"),
      (0, import_react3.createElement)("p", { className: "di-reader-hint" }, "\u4E5F\u53EF\u4EE5\u628A\u6587\u4EF6\u62D6\u5230\u8FD9\u91CC\uFF0C\u6216\u70B9\u51FB\u53F3\u4E0A\u89D2\u300C\u6253\u5F00\u6587\u4EF6\u300D\u3002"),
      (0, import_react3.createElement)("button", { className: "di-btn primary", onClick: () => inputRef.current?.click() }, "\u9009\u62E9\u8BB2\u4E49")
    );
  } else if (status === "loading") content = (0, import_react3.createElement)(Loading);
  else if (status === "error") content = (0, import_react3.createElement)(
    "div",
    { className: "di-reader-state error" },
    (0, import_react3.createElement)("span", null, error || "\u52A0\u8F7D\u5931\u8D25"),
    (0, import_react3.createElement)("button", { className: "di-btn", onClick: () => setReloadToken((value) => value + 1) }, "\u91CD\u8BD5")
  );
  else if (meta.ext === "pdf" && pdfUrl) content = (0, import_react3.createElement)("iframe", { className: "di-reader-frame", src: pdfUrl, title: meta.name });
  else if (html) content = (0, import_react3.createElement)("iframe", { className: "di-reader-frame", srcDoc: html, sandbox: "", title: meta.name });
  else if (meta.ext === "md") content = (0, import_react3.createElement)(MarkdownView, { text });
  else if (meta.ext === "csv") content = (0, import_react3.createElement)(CsvTable, { text });
  else content = (0, import_react3.createElement)("div", { className: "di-reader-state error" }, "\u6CA1\u6709\u53EF\u663E\u793A\u7684\u5185\u5BB9\u3002");
  return (0, import_react3.createElement)(
    "div",
    { className: "di-reader" },
    (0, import_react3.createElement)("input", {
      ref: inputRef,
      type: "file",
      accept: ACCEPT,
      style: { display: "none" },
      onChange: (event) => upload(event.target.files?.[0])
    }),
    (0, import_react3.createElement)(
      "div",
      { className: "di-reader-head" },
      (0, import_react3.createElement)("div", { className: "di-reader-title" }, (0, import_react3.createElement)("strong", null, "\u8BB2\u4E49"), (0, import_react3.createElement)("span", { className: "di-reader-name", title }, title)),
      (0, import_react3.createElement)("span", { className: "di-reader-spacer" }),
      (0, import_react3.createElement)("button", { className: "di-btn ghost", disabled: uploading, onClick: () => inputRef.current?.click() }, uploading ? "\u4E0A\u4F20\u4E2D\u2026" : "\u6253\u5F00\u6587\u4EF6"),
      (0, import_react3.createElement)("button", { className: "di-btn ghost", onClick: () => onClose?.(true), title: "\u6536\u8D77\u53F3\u680F" }, "\u6536\u8D77")
    ),
    (0, import_react3.createElement)(
      "div",
      { className: "di-reader-tools" },
      files.length ? (0, import_react3.createElement)("select", {
        className: "di-select di-reader-select",
        value: currentId || "",
        onChange: (event) => choose(files.find((item) => item.id === event.target.value) || null)
      }, files.map((item) => (0, import_react3.createElement)("option", { key: item.id, value: item.id }, item.name))) : (0, import_react3.createElement)("span", { className: "di-reader-hint" }, "\u652F\u6301 PDF\u3001Word\u3001Excel\u3001PPT\u3001CSV\u3001Markdown"),
      (0, import_react3.createElement)("span", { className: "di-reader-spacer" }),
      meta ? (0, import_react3.createElement)("span", { className: "di-reader-meta" }, meta.ext.toUpperCase() + " \xB7 " + fmtSize(meta.size)) : null,
      meta ? (0, import_react3.createElement)("button", { className: "di-btn ghost", disabled: status === "loading", onClick: () => setReloadToken((value) => value + 1), title: "\u91CD\u65B0\u52A0\u8F7D" }, "\u91CD\u8F7D") : null,
      meta ? (0, import_react3.createElement)("button", { className: "di-btn ghost", onClick: removeCurrent, title: "\u5220\u9664\u8FD9\u4EFD\u8BB2\u4E49" }, "\u5220\u9664") : null,
      pdfUrl ? (0, import_react3.createElement)("a", { className: "di-btn ghost", href: pdfUrl, target: "_blank", rel: "noreferrer" }, "\u65B0\u6807\u7B7E") : null
    ),
    (0, import_react3.createElement)("div", {
      className: "di-reader-body" + (dragging ? " dragging" : ""),
      onDragOver: (event) => {
        event.preventDefault();
        setDragging(true);
      },
      onDragLeave: () => setDragging(false),
      onDrop
    }, content, error && status !== "error" ? (0, import_react3.createElement)("div", { className: "di-reader-error" }, error) : null)
  );
}

// src/client/model-choice.js
var OPEN_FAMILIES = [
  /^deepseek/i,
  /^qwen/i,
  /^glm/i,
  /^kimi/i,
  /^minimax/i,
  /^hunyuan/i,
  /^hy\d/i,
  /^step/i,
  /^mimo/i,
  /^llama/i,
  /^mistral/i,
  /^mixtral/i,
  /^gemma/i,
  /^phi/i,
  /^yi/i,
  /^internlm/i,
  /^baichuan/i
];
var PRESETS = [
  { id: "cost", label: "\u7701\u94B1\u4F18\u5148", title: "\u4F18\u5148\u514D\u8D39\u3001Flash \u6216 Mini \u6863\u6A21\u578B" },
  { id: "quality", label: "\u9AD8\u8D28\u91CF", title: "\u4F18\u5148 Pro\u3001Max\u3001Plus \u7B49\u65D7\u8230\u6A21\u578B" },
  { id: "open", label: "\u5F00\u6E90\u7CFB", title: "\u4F18\u5148 DeepSeek\u3001Qwen\u3001GLM\u3001Kimi \u7B49\u5F00\u6E90\u5BB6\u65CF" }
];
function textOf(model) {
  const id = model?.id || model?.model || "";
  return String(id + " " + (model?.name || "")).toLowerCase();
}
function flattenRoutes(routes) {
  const out = [];
  for (const route of Array.isArray(routes) ? routes : []) {
    for (const model of Array.isArray(route?.models) ? route.models : []) {
      if (!model?.id) continue;
      out.push({
        provider: route.id,
        providerName: route.name || route.id,
        model: model.id,
        name: model.name || model.id,
        description: model.description || ""
      });
    }
  }
  return out;
}
function tagsForModel(model) {
  const text = textOf(model);
  const tags = [];
  if (/\bfree\b|trial|promo|免费|试用/i.test(text)) tags.push("\u514D\u8D39/\u8BD5\u7528");
  if (/flash|mini|turbo|lite|air|small/i.test(text)) tags.push("\u7701\u94B1");
  if (/pro|max|plus|opus|sonnet|kimi|glm-5|hy4std/i.test(text)) tags.push("\u9AD8\u8D28");
  if (OPEN_FAMILIES.some((pattern) => pattern.test(String(model?.id || model?.model || "")))) tags.push("\u5F00\u6E90\u7CFB");
  return tags;
}
function costScore(model) {
  const text = textOf(model);
  if (/\bfree\b|trial|promo|免费|试用/i.test(text)) return 0;
  if (/flash/i.test(text)) return 1;
  if (/mini|turbo/i.test(text)) return 2;
  if (/lite|air|small/i.test(text)) return 3;
  if (/plus/i.test(text)) return 4;
  if (/pro|max|opus|sonnet/i.test(text)) return 6;
  return 5;
}
function qualityScore(model) {
  const text = textOf(model);
  if (/opus|sonnet|pro|max/i.test(text)) return 5;
  if (/plus|kimi|glm-5|hy4std/i.test(text)) return 4;
  if (/flash|mini|turbo|lite|air|small/i.test(text)) return 2;
  return 3;
}
function choosePreset(routes, preset) {
  const all = flattenRoutes(routes);
  if (!all.length) return null;
  if (preset === "cost") {
    return [...all].sort((a, b) => costScore(a) - costScore(b))[0];
  }
  if (preset === "quality") {
    return [...all].sort((a, b) => qualityScore(b) - qualityScore(a))[0];
  }
  if (preset === "open") {
    const open = all.filter((item) => tagsForModel(item).includes("\u5F00\u6E90\u7CFB"));
    if (!open.length) return null;
    return open.sort((a, b) => qualityScore(b) - qualityScore(a))[0];
  }
  return null;
}
function findModel(routes, provider, model) {
  return flattenRoutes(routes).find((item) => item.provider === provider && item.model === model) || null;
}

// src/client/panel.js
var PHASE_LABEL = {
  idle: "\u7A7A\u95F2",
  listening: "\u6B63\u5728\u76D1\u542C",
  stopping: "\u6B63\u5728\u6536\u5C3E",
  completed: "\u5DF2\u7ED3\u675F",
  error: "\u51FA\u9519"
};
function preparationLabel(prep) {
  if (!prep) return "\u672A\u77E5";
  const phase = prep.phase;
  if (phase === "ready") return "\u5C31\u7EEA";
  if (phase === "prepared" || phase === "standby") return "\u5F85\u547D";
  if (phase === "unprepared") return "\u672A\u51C6\u5907";
  if (phase === "downloading") {
    const done = Number(prep.completedBytes || 0);
    const total = Number(prep.totalBytes || 0);
    const suffix = total ? " " + (done / 1048576).toFixed(0) + "/" + (total / 1048576).toFixed(0) + "MB" : " " + (done / 1048576).toFixed(0) + "MB";
    return "\u4E0B\u8F7D\u4E2D" + suffix;
  }
  if (phase === "checking") return "\u6821\u9A8C\u4E2D";
  if (phase === "loading") return "\u52A0\u8F7D\u4E2D";
  if (phase === "failed") return "\u51C6\u5907\u5931\u8D25";
  if (phase === "cancelled") return "\u5DF2\u53D6\u6D88";
  return String(phase);
}
function prepPercent(prep) {
  if (!prep || prep.phase !== "downloading") return null;
  const total = Number(prep.totalBytes || 0);
  if (!total) return null;
  return Math.max(0, Math.min(100, Number(prep.completedBytes || 0) / total * 100));
}
function Chip(props) {
  return (0, import_react4.createElement)(
    "span",
    { className: "di-chip" },
    (0, import_react4.createElement)("span", { className: "di-dot " + (props.tone || "") }),
    props.children
  );
}
function Kv(props) {
  return (0, import_react4.createElement)("div", { className: "di-kv" }, (0, import_react4.createElement)("span", null, props.label), (0, import_react4.createElement)("span", null, props.value));
}
function PanelView({ controller, openDock, dockAvailable }) {
  const snapshot = (0, import_react4.useSyncExternalStore)(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const { state, segments, busy, error, connection, modelProgress, elapsed, testResult, testBusy, audioInfo, dock, draft, live, termSearch, history, historyView, models, mtRoutes } = snapshot;
  const listRef = (0, import_react4.useRef)(null);
  const stickRef = (0, import_react4.useRef)(true);
  const [showDropped, setShowDropped] = (0, import_react4.useState)(false);
  const [dismissed, setDismissed] = (0, import_react4.useState)(null);
  const [testText, setTestText] = (0, import_react4.useState)("The eigenvalue decomposition of a symmetric matrix is always possible.");
  const [settingsOpen, setSettingsOpen] = (0, import_react4.useState)(true);
  const [glossaryText, setGlossaryText] = (0, import_react4.useState)("");
  const [glossaryDirty, setGlossaryDirty] = (0, import_react4.useState)(false);
  const [brief, setBrief] = (0, import_react4.useState)("");
  const [briefDirty, setBriefDirty] = (0, import_react4.useState)(false);
  const [termQuery, setTermQuery] = (0, import_react4.useState)("");
  const glossary = snapshot.glossary;
  (0, import_react4.useEffect)(() => {
    if (glossaryDirty) return;
    const entries = glossary?.entries;
    if (!Array.isArray(entries)) return;
    setGlossaryText(entries.map((entry) => entry.source + " => " + entry.target).join("\n"));
  }, [glossary, glossaryDirty]);
  (0, import_react4.useEffect)(() => {
    if (briefDirty) return;
    setBrief(String(state?.config?.brief || ""));
  }, [state?.config?.brief, briefDirty]);
  const saveGlossary = () => {
    const entries = glossaryText.split(/\r?\n/).map((line) => line.split(/\s*=>\s*/)).filter((parts) => parts.length >= 2 && parts[0].trim() && parts[1].trim()).map((parts) => ({ source: parts[0].trim(), target: parts.slice(1).join(" => ").trim() }));
    controller.saveGlossary(entries).then(() => setGlossaryDirty(false));
  };
  const importGlossaryFile = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const extension = String(file.name.split(".").pop() || "").toLowerCase();
    const format = extension === "tmx" ? "tmx" : extension === "json" ? "json" : extension === "tsv" ? "tsv" : "csv";
    const reader = new FileReader();
    reader.onload = () => {
      controller.importGlossary(String(reader.result || ""), format);
    };
    reader.readAsText(file);
    event.target.value = "";
  };
  (0, import_react4.useEffect)(() => {
    const el = listRef.current;
    if (!el) return;
    if (stickRef.current) el.scrollTop = el.scrollHeight;
  }, [segments.length, live?.mic?.en, live?.system?.en, live?.mic?.zh, live?.system?.zh]);
  (0, import_react4.useEffect)(() => {
    if (!state) controller.refresh();
  }, []);
  const running = state?.phase === "listening";
  const stopping = state?.phase === "stopping";
  const picked = state?.asr?.picked;
  const providerReady = picked?.preparation?.phase === "ready";
  const autoTranslate = state?.config?.autoTranslate !== false;
  const mt = state?.mt;
  const routes = Array.isArray(mtRoutes?.routes) ? mtRoutes.routes : [];
  const flatModels = flattenRoutes(routes);
  const configuredProvider = state?.config?.mtProvider || "";
  const configuredModel = state?.config?.mtModel || "";
  const selectedInfo = configuredModel ? flatModels.find((item) => item.model === configuredModel && (!configuredProvider || item.provider === configuredProvider)) || findModel(routes, configuredProvider, configuredModel) : null;
  const activeProvider = configuredProvider || selectedInfo?.provider || "";
  const providerModels = routes.find((route) => route.id === activeProvider)?.models || [];
  const mtWarning = state?.mtWarning || mtRoutes?.warning || "";
  const mtError = mtRoutes?.error || "";
  const canSwitchModel = !busy && !running && !stopping && routes.length > 0;
  const presetChoices = PRESETS.map((preset) => ({ ...preset, choice: choosePreset(routes, preset.id) }));
  const visible = segments.filter((segment) => showDropped || segment.status !== "dropped");
  const liveRows = [live?.mic, live?.system].filter((item) => item?.en);
  const errorText = error || state?.lastError?.message || "";
  const showError = errorText && dismissed !== errorText;
  const blockedReason = !providerReady ? "\u8BED\u97F3\u6A21\u578B\u672A\u5C31\u7EEA\uFF0C\u8BF7\u5148\u5728\u53F3\u4FA7\u51C6\u5907\u6A21\u578B" : autoTranslate && !mt?.provider ? "\u6CA1\u6709\u53EF\u7528\u7684\u7FFB\u8BD1\u6A21\u578B\u8DEF\u7531" : "";
  const canStart = !busy && !running && !stopping && !blockedReason;
  const canSaveAndReset = !busy && state?.phase === "completed";
  const refreshTitle = running || stopping ? "\u540C\u4F20\u8FDB\u884C\u4E2D\uFF0C\u505C\u6B62\u540E\u624D\u80FD\u5237\u65B0" : state?.phase === "completed" ? "\u4FDD\u5B58\u672C\u6B21\u540C\u4F20\u5230\u5386\u53F2\uFF0C\u5E76\u6E05\u7A7A\u5B57\u5E55\u9875" : "\u672C\u6B21\u540C\u4F20\u7ED3\u675F\u540E\u624D\u80FD\u5237\u65B0";
  const listeningTone = running ? "live" : stopping ? "warn" : "";
  const modelPercent = prepPercent(modelProgress?.preparation || picked?.preparation);
  const elapsedMs = running ? elapsed : state?.elapsedMs || 0;
  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
  };
  const applyModelPreset = (preset) => {
    if (!canSwitchModel) return;
    if (preset === "auto") {
      controller.saveConfig({ mtProvider: "", mtModel: "" });
      return;
    }
    const choice = choosePreset(routes, preset);
    if (choice) controller.saveConfig({ mtProvider: choice.provider, mtModel: choice.model });
  };
  const onProviderChange = (event) => {
    const provider = event.target.value;
    if (!provider) {
      controller.saveConfig({ mtProvider: "", mtModel: "" });
      return;
    }
    const route = routes.find((item) => item.id === provider);
    controller.saveConfig({ mtProvider: provider, mtModel: route?.models?.[0]?.id || "" });
  };
  const onModelChange = (event) => {
    controller.saveConfig({ mtProvider: activeProvider, mtModel: event.target.value });
  };
  const modelLabel = (model) => {
    const tags = tagsForModel(model);
    return (model.name || model.id) + (tags.length ? " [" + tags.join("] [") + "]" : "");
  };
  return (0, import_react4.createElement)(
    "div",
    { className: "dsh-interpret-root" },
    (0, import_react4.createElement)(
      "header",
      { className: "di-header" },
      (0, import_react4.createElement)("div", { className: "di-title" }, (0, import_react4.createElement)(InterpretIcon, { size: 18 }), (0, import_react4.createElement)("span", null, "\u540C\u58F0\u4F20\u8BD1")),
      (0, import_react4.createElement)(Chip, { tone: listeningTone }, running ? "\u6B63\u5728\u76D1\u542C " + fmtClock(elapsedMs) : PHASE_LABEL[state?.phase] || "\u52A0\u8F7D\u4E2D"),
      (0, import_react4.createElement)("span", { className: "di-sub" }, segments.length + " \u6BB5"),
      (0, import_react4.createElement)("span", { className: "di-spacer" }),
      running || stopping ? (0, import_react4.createElement)("button", {
        className: "di-btn danger",
        disabled: busy || stopping,
        onClick: () => controller.stop()
      }, stopping ? "\u6B63\u5728\u6536\u5C3E\u2026" : "\u505C\u6B62") : (0, import_react4.createElement)("button", {
        className: "di-btn primary",
        disabled: !canStart,
        title: blockedReason || "\u5F00\u59CB\u9EA6\u514B\u98CE\u540C\u4F20",
        onClick: () => controller.start()
      }, busy ? "\u542F\u52A8\u4E2D\u2026" : "\u5F00\u59CB\u540C\u4F20"),
      (0, import_react4.createElement)("button", {
        className: "di-btn ghost",
        disabled: !canSaveAndReset,
        onClick: () => controller.resetSession(),
        title: refreshTitle
      }, busy && state?.phase === "completed" ? "\u5904\u7406\u4E2D\u2026" : "\u4FDD\u5B58\u5E76\u5237\u65B0"),
      (0, import_react4.createElement)("button", {
        className: "di-btn ghost" + (dock?.open ? " active" : ""),
        onClick: () => openDock && openDock(),
        title: dock?.open ? "\u6536\u8D77\u8BB2\u4E49\u9605\u8BFB\u5668" : "\u5728\u4E3B\u9762\u677F\u53F3\u4FA7\u6253\u5F00\u8BB2\u4E49\u9605\u8BFB\u5668"
      }, dock?.open ? "\u9690\u85CF\u8BB2\u4E49" : "\u8BB2\u4E49"),
      (0, import_react4.createElement)("button", {
        className: "di-btn ghost",
        onClick: () => setSettingsOpen((value) => !value),
        title: "\u663E\u793A\u6216\u9690\u85CF\u53F3\u4FA7\u8BBE\u7F6E"
      }, settingsOpen ? "\u9690\u85CF\u8BBE\u7F6E" : "\u8BBE\u7F6E")
    ),
    showError ? (0, import_react4.createElement)(
      "div",
      { className: "di-banner" },
      (0, import_react4.createElement)("span", null, errorText),
      (0, import_react4.createElement)("span", { className: "di-spacer" }),
      (0, import_react4.createElement)("button", { className: "di-btn ghost", onClick: () => setDismissed(errorText) }, "\u5173\u95ED")
    ) : null,
    (0, import_react4.createElement)(
      "div",
      { className: "di-body" },
      (0, import_react4.createElement)(
        "main",
        { className: "di-main" },
        (0, import_react4.createElement)(
          "div",
          { className: "di-list", ref: listRef, onScroll },
          visible.length ? visible.map((segment) => (0, import_react4.createElement)(CaptionRow, { key: segment.id, segment })) : liveRows.length ? null : (0, import_react4.createElement)(
            "div",
            { className: "di-empty" },
            (0, import_react4.createElement)("strong", null, running ? "\u6B63\u5728\u8046\u542C\u82F1\u6587\u8BB2\u89E3\u2026" : "\u51C6\u5907\u5F00\u59CB\u5B9E\u65F6\u82F1\u4E2D\u5B57\u5E55"),
            (0, import_react4.createElement)("div", null, running ? "\u82F1\u6587\u4F1A\u9010\u8BCD\u51FA\u73B0\uFF0C\u4E2D\u6587\u8BD1\u6587\u968F\u540E\u66F4\u65B0\u3002" : "\u70B9\u51FB\u53F3\u4E0A\u89D2\u300C\u5F00\u59CB\u540C\u4F20\u300D\uFF0C\u5141\u8BB8\u9EA6\u514B\u98CE\u540E\u5373\u53EF\u5B9E\u65F6\u663E\u793A\u82F1\u6587\u539F\u53E5\u4E0E\u4E2D\u6587\u8BD1\u6587\u3002")
          ),
          liveRows.map((item) => (0, import_react4.createElement)(LiveRow, { key: "live-" + item.track, item, showZh: autoTranslate })),
          draft?.en ? (0, import_react4.createElement)(
            "div",
            { className: "di-row di-draft" },
            (0, import_react4.createElement)("div", { className: "di-meta" }, "\u8349\u7A3F \xB7 " + (draft.track === "system" ? "\u7CFB\u7EDF\u97F3\u9891" : "\u9EA6\u514B\u98CE")),
            (0, import_react4.createElement)("div", { className: "di-en di-draft-en" }, draft.en)
          ) : null,
          (0, import_react4.createElement)("div", { style: { height: "1px" } })
        )
      ),
      dock?.open ? (0, import_react4.createElement)("aside", { className: "di-right-dock" }, (0, import_react4.createElement)(ReaderPane, { onClose: openDock })) : null,
      settingsOpen ? (0, import_react4.createElement)(
        "aside",
        { className: "di-aside" },
        (0, import_react4.createElement)(
          "section",
          { className: "di-card" },
          (0, import_react4.createElement)("h4", null, "\u8BED\u97F3\u8BC6\u522B"),
          state?.asr?.providers?.length > 1 ? (0, import_react4.createElement)("select", {
            className: "di-select",
            value: picked?.id || "",
            onChange: (event) => controller.saveConfig({ asrProvider: event.target.value })
          }, state.asr.providers.map((provider) => (0, import_react4.createElement)("option", { key: provider.id, value: provider.id }, provider.name))) : (0, import_react4.createElement)(Kv, { label: "Provider", value: picked ? picked.name : "\u672A\u53D1\u73B0" }),
          (0, import_react4.createElement)(Kv, { label: "\u72B6\u6001", value: preparationLabel(picked?.preparation) }),
          (0, import_react4.createElement)(Kv, { label: "\u6A21\u578B\u76EE\u5F55", value: picked?.preparation?.directory || "\u2014" }),
          ["downloading", "checking", "loading"].includes(picked?.preparation?.phase) ? (0, import_react4.createElement)("div", { className: "di-actions" }, (0, import_react4.createElement)("button", { className: "di-btn", onClick: () => controller.cancelPrepare(picked?.id) }, "\u53D6\u6D88\u51C6\u5907")) : null,
          modelPercent !== null ? (0, import_react4.createElement)("div", { className: "di-progress" }, (0, import_react4.createElement)("div", { style: { width: modelPercent + "%" } })) : null,
          !providerReady ? (0, import_react4.createElement)(
            "div",
            { className: "di-actions" },
            (0, import_react4.createElement)("button", {
              className: "di-btn primary",
              disabled: busy || modelProgress?.preparation?.phase === "downloading",
              onClick: () => controller.prepare(picked?.id)
            }, modelProgress?.preparation?.phase === "downloading" ? "\u4E0B\u8F7D\u4E2D\u2026" : "\u51C6\u5907\u672C\u673A\u6A21\u578B"),
            (0, import_react4.createElement)("span", { className: "di-note" }, "\u9996\u6B21\u7EA6 239MB\uFF0C\u4EC5\u4E0B\u8F7D\u4E00\u6B21\u3002")
          ) : (0, import_react4.createElement)("div", { className: "di-note" }, "\u672C\u673A\u8BC6\u522B\uFF0C\u97F3\u9891\u4E0D\u51FA\u673A\u5668\u3002")
        ),
        (0, import_react4.createElement)(
          "section",
          { className: "di-card" },
          (0, import_react4.createElement)("h4", null, "\u9010\u8BCD\u5B9E\u65F6"),
          (0, import_react4.createElement)(Kv, { label: "\u6A21\u5F0F", value: state?.config?.streamingMode === "off" ? "\u5173\u95ED" : models?.streaming?.ready ? "\u5DF2\u5C31\u7EEA" : "\u672A\u4E0B\u8F7D" }),
          (0, import_react4.createElement)("select", {
            className: "di-select",
            value: state?.config?.streamingMode || "auto",
            onChange: (event) => controller.saveConfig({ streamingMode: event.target.value })
          }, ["auto", "on", "off"].map((mode) => (0, import_react4.createElement)("option", { key: mode, value: mode }, mode === "auto" ? "\u81EA\u52A8\uFF08\u63A8\u8350\uFF09" : mode === "on" ? "\u5FC5\u987B\u9010\u8BCD" : "\u5173\u95ED\uFF08\u6574\u6BB5\u56DE\u9000\uFF09"))),
          models?.streaming?.ready ? (0, import_react4.createElement)("div", { className: "di-note" }, "\u82F1\u6587\u6D41\u5F0F\u6A21\u578B\u5DF2\u5C31\u7EEA\uFF0C\u8FB9\u8BF4\u8FB9\u51FA\u8BCD\u3002") : (0, import_react4.createElement)(
            "div",
            { className: "di-actions" },
            (0, import_react4.createElement)("button", {
              className: "di-btn primary",
              disabled: busy || (models?.streaming?.progress || state?.streaming?.progress)?.phase === "downloading",
              onClick: () => controller.prepareStreaming()
            }, (models?.streaming?.progress || state?.streaming?.progress)?.phase === "downloading" ? "\u4E0B\u8F7D\u4E2D\u2026" : "\u4E0B\u8F7D\u9010\u8BCD\u6A21\u578B\uFF0873MB\uFF09"),
            (0, import_react4.createElement)("span", { className: "di-note" }, "\u9996\u6B21\u4E0B\u8F7D\uFF0C\u4EC5\u7528\u4E8E\u5B9E\u65F6\u82F1\u6587\u3002")
          ),
          (models?.streaming?.progress || state?.streaming?.progress)?.phase === "downloading" ? (0, import_react4.createElement)("div", { className: "di-note" }, "\u6D41\u5F0F\u6A21\u578B " + ((models?.streaming?.progress || state?.streaming?.progress).completedBytes / 1048576).toFixed(0) + "/" + ((models?.streaming?.progress || state?.streaming?.progress).totalBytes / 1048576).toFixed(0) + "MB") : null,
          (0, import_react4.createElement)("div", { className: "di-note" }, "\u5B9A\u7A3F\u4ECD\u7531 Parakeet \u590D\u6838\uFF0C\u672F\u8BED\u66F4\u51C6\u3002")
        ),
        (0, import_react4.createElement)(
          "section",
          { className: "di-card" },
          (0, import_react4.createElement)("h4", null, "\u8BC6\u522B\u7CBE\u5EA6"),
          (0, import_react4.createElement)(Kv, { label: "\u91C7\u6837\u7387", value: audioInfo?.sampleRate ? audioInfo.sampleRate + "Hz" : "\u672A\u5F00\u59CB" }),
          (0, import_react4.createElement)("select", {
            className: "di-select",
            value: state?.config?.liveAsrMode || "balanced",
            onChange: (event) => controller.saveConfig({ liveAsrMode: event.target.value })
          }, [["fast", "\u4F4E\u5EF6\u8FDF\uFF08\u5F31\u6D41\u5F0F\uFF09"], ["balanced", "\u5E73\u8861\uFF08\u6D41\u5F0F + Parakeet \u6821\u6B63\uFF09"], ["accurate", "\u9AD8\u7CBE\u5EA6\uFF08Parakeet \u5B9E\u65F6\uFF09"]].map(([value, label]) => (0, import_react4.createElement)("option", { key: value, value }, label))),
          (0, import_react4.createElement)("select", {
            className: "di-select",
            value: state?.config?.vadProfile || "robust",
            onChange: (event) => controller.saveConfig({ vadProfile: event.target.value })
          }, [["robust", "\u5207\u53E5\u7A33\u5065\uFF08\u63A8\u8350\uFF0C\u5C11\u788E\u7247\uFF09"], ["standard", "\u6807\u51C6"], ["sensitive", "\u7075\u654F\uFF08\u66F4\u5FEB\u51FA\u53E5\uFF09"]].map(([value, label]) => (0, import_react4.createElement)("option", { key: value, value }, label))),
          (0, import_react4.createElement)("select", {
            className: "di-select",
            value: state?.config?.audioProfile || "auto",
            onChange: (event) => controller.saveConfig({ audioProfile: event.target.value })
          }, [["auto", "\u9EA6\u514B\u98CE\u81EA\u52A8\u589E\u5F3A"], ["clean", "\u5F3A\u964D\u566A/\u56DE\u58F0\u6D88\u9664"], ["raw", "\u539F\u59CB\u97F3\u9891\uFF08\u8BCA\u65AD\u7528\uFF09"]].map(([value, label]) => (0, import_react4.createElement)("option", { key: value, value }, label))),
          (0, import_react4.createElement)("div", { className: "di-note" }, "\u5E73\u8861\u6A21\u5F0F\u5148\u7528\u6D41\u5F0F\u51FA\u5B57\uFF0C\u7EA6 0.6 \u79D2\u540E\u7528 Parakeet \u6821\u6B63\uFF1B\u5B9A\u7A3F\u518D\u5408\u5E76\u6574\u53E5\u3002")
        ),
        (0, import_react4.createElement)(
          "section",
          { className: "di-card" },
          (0, import_react4.createElement)("h4", null, "\u5B66\u79D1\u672F\u8BED RAG"),
          (0, import_react4.createElement)(Kv, { label: "\u672F\u8BED\u5E93", value: state?.terminology?.ready ? state.terminology.count + " \u6761" : "\u672A\u52A0\u8F7D" }),
          (0, import_react4.createElement)(Kv, { label: "\u4E2D\u6587/\u97F3\u6807", value: state?.terminology?.ready ? state.terminology.zhCount + " / " + state.terminology.ipaCount : "\u2014" }),
          (0, import_react4.createElement)("select", {
            className: "di-select",
            value: state?.config?.terminologyDomains || "auto",
            onChange: (event) => controller.saveConfig({ terminologyDomains: event.target.value })
          }, [
            ["auto", "\u81EA\u52A8\u8BC6\u522B\u5B66\u79D1"],
            ["all", "\u5168\u90E8\u5B66\u79D1"],
            ["ai", "\u4EBA\u5DE5\u667A\u80FD"],
            ["math", "\u6570\u5B66"],
            ["statistics", "\u7EDF\u8BA1"],
            ["biology", "\u751F\u7269"],
            ["urban", "\u57CE\u5E02\u89C4\u5212"],
            ["architecture", "\u5EFA\u7B51"],
            ["electronics", "\u7535\u5B50\u4FE1\u606F"],
            ["tech", "\u901A\u7528\u79D1\u6280"]
          ].map(([value, label]) => (0, import_react4.createElement)("option", { key: value, value }, label))),
          (0, import_react4.createElement)("select", {
            className: "di-select",
            value: state?.config?.terminologyMode || "auto",
            onChange: (event) => controller.saveConfig({ terminologyMode: event.target.value })
          }, [["auto", "\u672F\u8BED RAG \u81EA\u52A8"], ["on", "\u5F3A\u5236\u542F\u7528"], ["off", "\u5173\u95ED"]].map(([value, label]) => (0, import_react4.createElement)("option", { key: value, value }, label))),
          (0, import_react4.createElement)(
            "label",
            { className: "di-note", style: { display: "flex", gap: "6px", alignItems: "center", marginTop: "4px" } },
            (0, import_react4.createElement)("input", {
              type: "checkbox",
              checked: state?.config?.termCorrection !== false,
              onChange: (event) => controller.saveConfig({ termCorrection: event.target.checked })
            }),
            "\u672F\u8BED\u81EA\u52A8\u6821\u6B63\uFF08\u5B9A\u7A3F + \u5B9E\u65F6\uFF09"
          ),
          (0, import_react4.createElement)(
            "div",
            { className: "di-actions" },
            (0, import_react4.createElement)("input", {
              className: "di-select",
              style: { flex: 1, minWidth: 0 },
              value: termQuery,
              placeholder: "\u67E5\u672F\u8BED / \u97F3\u6807\uFF0C\u5982 large language model",
              onChange: (event) => setTermQuery(event.target.value),
              onKeyDown: (event) => {
                if (event.key === "Enter") controller.searchTerminology(termQuery, state?.config?.terminologyDomains);
              }
            }),
            (0, import_react4.createElement)("button", { className: "di-btn", disabled: termSearch?.busy, onClick: () => controller.searchTerminology(termQuery, state?.config?.terminologyDomains) }, termSearch?.busy ? "\u67E5\u8BE2\u4E2D" : "\u67E5\u8BE2")
          ),
          termSearch?.results?.length ? (0, import_react4.createElement)("div", { className: "di-term-results" }, termSearch.results.slice(0, 8).map((term) => (0, import_react4.createElement)(
            "div",
            { key: term.source, className: "di-term" },
            (0, import_react4.createElement)("div", { className: "di-term-head" }, (0, import_react4.createElement)("strong", null, term.source), (0, import_react4.createElement)("span", null, term.zh || "\uFF08\u65E0\u4E2D\u6587\uFF09")),
            term.ipaUk || term.ipaUs ? (0, import_react4.createElement)("div", { className: "di-note" }, [term.ipaUk && "UK " + term.ipaUk, term.ipaUs && "US " + term.ipaUs].filter(Boolean).join("  \xB7  ")) : null,
            (0, import_react4.createElement)("div", { className: "di-note" }, (term.domains || []).join("/") + (term.definition ? " \xB7 " + term.definition.slice(0, 140) : ""))
          ))) : null,
          (0, import_react4.createElement)("div", { className: "di-note" }, "\u672C\u5730\u672F\u8BED\u5E93\uFF1B\u5B9A\u7A3F\u65F6\u7528 RAG \u68C0\u7D22 + \u6A21\u578B\u6821\u9A8C\uFF0C\u5B9E\u65F6\u884C\u53EA\u505A\u9AD8\u7F6E\u4FE1\u522B\u540D\u7EA0\u6B63\u3002")
        ),
        (0, import_react4.createElement)(
          "section",
          { className: "di-card" },
          (0, import_react4.createElement)("h4", null, "\u964D\u566A / VAD"),
          (0, import_react4.createElement)(Kv, { label: "\u6A21\u5F0F", value: state?.config?.vadMode === "energy" ? "\u80FD\u91CF VAD" : models?.vad?.ready ? "Silero + \u80FD\u91CF\u56DE\u9000" : "\u80FD\u91CF VAD\uFF08Silero \u672A\u4E0B\u8F7D\uFF09" }),
          (0, import_react4.createElement)("select", {
            className: "di-select",
            value: state?.config?.vadMode || "auto",
            onChange: (event) => controller.saveConfig({ vadMode: event.target.value })
          }, ["auto", "silero", "energy"].map((mode) => (0, import_react4.createElement)("option", { key: mode, value: mode }, mode === "auto" ? "\u81EA\u52A8" : mode === "silero" ? "Silero" : "\u80FD\u91CF"))),
          !models?.vad?.ready ? (0, import_react4.createElement)(
            "div",
            { className: "di-actions" },
            (0, import_react4.createElement)("button", { className: "di-btn", onClick: () => controller.prepareVad() }, "\u4E0B\u8F7D Silero VAD\uFF082MB\uFF09")
          ) : (0, import_react4.createElement)("div", { className: "di-note" }, "\u672C\u673A\u8BED\u97F3\u6D3B\u52A8\u68C0\u6D4B\u5DF2\u5C31\u7EEA\u3002")
        ),
        (0, import_react4.createElement)(
          "section",
          { className: "di-card" },
          (0, import_react4.createElement)("h4", null, "\u7FFB\u8BD1\u6A21\u578B"),
          (0, import_react4.createElement)(Kv, { label: "\u5F53\u524D\u5B9E\u9645", value: mt ? mt.provider + " / " + mt.model : autoTranslate ? "\u81EA\u52A8\u9009\u62E9\u4E2D" : "\u7FFB\u8BD1\u5DF2\u5173\u95ED" }),
          !routes.length ? (0, import_react4.createElement)(
            "div",
            null,
            (0, import_react4.createElement)("div", { className: "di-note" }, mtError || "\u672A\u53D1\u73B0\u53EF\u7528\u7FFB\u8BD1\u6A21\u578B\uFF0C\u8BF7\u5148\u5728 DSH \u8BBE\u7F6E\u4E2D\u914D\u7F6E provider \u4E0E\u5BC6\u94A5\u3002"),
            (0, import_react4.createElement)(
              "div",
              { className: "di-actions" },
              (0, import_react4.createElement)("button", { className: "di-btn", disabled: busy, onClick: () => controller.loadMtRoutes() }, "\u91CD\u65B0\u8BFB\u53D6\u6A21\u578B")
            )
          ) : (0, import_react4.createElement)(
            "div",
            null,
            (0, import_react4.createElement)("div", { className: "di-note" }, "\u670D\u52A1\u5546"),
            (0, import_react4.createElement)("select", {
              className: "di-select",
              value: configuredProvider,
              disabled: !canSwitchModel,
              onChange: onProviderChange
            }, [
              (0, import_react4.createElement)("option", { key: "provider-auto", value: "" }, "\u81EA\u52A8\uFF08DSH \u9009\u62E9\uFF09"),
              ...routes.map((route) => (0, import_react4.createElement)("option", { key: route.id, value: route.id }, route.name || route.id)),
              configuredProvider && !routes.some((route) => route.id === configuredProvider) ? (0, import_react4.createElement)("option", { key: "provider-missing", value: configuredProvider }, configuredProvider + "\uFF08\u4E0D\u53EF\u7528\uFF09") : null
            ]),
            (0, import_react4.createElement)("div", { className: "di-note" }, "\u6A21\u578B"),
            (0, import_react4.createElement)("select", {
              className: "di-select",
              value: configuredModel,
              disabled: !canSwitchModel || !activeProvider,
              onChange: onModelChange
            }, [
              (0, import_react4.createElement)("option", { key: "model-auto", value: "" }, activeProvider ? "\u81EA\u52A8\uFF08\u8BE5\u670D\u52A1\u5546\u9996\u4E2A\u6A21\u578B\uFF09" : "\u8BF7\u5148\u9009\u62E9\u670D\u52A1\u5546"),
              ...providerModels.map((model) => (0, import_react4.createElement)("option", { key: activeProvider + "/" + model.id, value: model.id }, modelLabel(model))),
              configuredModel && !providerModels.some((model) => model.id === configuredModel) ? (0, import_react4.createElement)("option", { key: "model-missing", value: configuredModel }, configuredModel + "\uFF08\u4E0D\u53EF\u7528\uFF09") : null
            ]),
            selectedInfo?.description ? (0, import_react4.createElement)("div", { className: "di-note" }, selectedInfo.description) : null,
            (0, import_react4.createElement)(
              "div",
              { className: "di-actions" },
              (0, import_react4.createElement)("button", {
                className: "di-btn ghost",
                disabled: !canSwitchModel,
                title: "\u6E05\u9664\u5DF2\u4FDD\u5B58\u7684\u6A21\u578B\uFF0C\u7531 DSH \u81EA\u52A8\u9009\u62E9",
                onClick: () => applyModelPreset("auto")
              }, "\u81EA\u52A8"),
              ...presetChoices.map((preset) => (0, import_react4.createElement)("button", {
                key: preset.id,
                className: "di-btn ghost",
                disabled: !canSwitchModel || !preset.choice,
                title: preset.choice ? preset.choice.providerName + " / " + preset.choice.name + " \u2014 " + preset.title : preset.title,
                onClick: () => applyModelPreset(preset.id)
              }, preset.label))
            ),
            (0, import_react4.createElement)("div", { className: "di-note" }, "\u53EF\u7528 " + flatModels.length + " \u4E2A\u6A21\u578B\uFF1B\u6765\u81EA DSH \u5DF2\u914D\u7F6E\u8DEF\u7531\uFF0C\u672A\u51FA\u73B0\u7684\u6A21\u578B\u9700\u5148\u5728 DSH \u8BBE\u7F6E\u4E2D\u914D\u7F6E\u3002\u8D39\u7528\u6309 DSH \u8D26\u5355\u7ED3\u7B97\uFF0C\u5355\u4EF7\u4E4B\u5916\u8FD8\u53D6\u51B3\u4E8E\u53E5\u6570\u4E0E\u8349\u7A3F\u9891\u7387\uFF1B\u4F18\u5148 Flash/Mini \u6216\u5F00\u6E90\u7CFB\u3002"),
            running || stopping ? (0, import_react4.createElement)("div", { className: "di-note" }, "\u540C\u4F20\u8FDB\u884C\u4E2D\u4E0D\u53EF\u5207\u6362\uFF0C\u505C\u6B62\u540E\u751F\u6548\u3002") : null,
            mtWarning ? (0, import_react4.createElement)("div", { className: "di-note", style: { color: "var(--di-danger)" } }, mtWarning) : null,
            (0, import_react4.createElement)(
              "div",
              { className: "di-actions" },
              (0, import_react4.createElement)("button", { className: "di-btn", disabled: busy, onClick: () => controller.loadMtRoutes() }, "\u91CD\u65B0\u8BFB\u53D6\u6A21\u578B")
            )
          ),
          (0, import_react4.createElement)("div", { className: "di-note" }, "\u6A21\u578B\u5207\u6362\u53EA\u5F71\u54CD\u7FFB\u8BD1\uFF0C\u4E0D\u6539\u53D8\u672C\u673A ASR\u3002")
        ),
        (0, import_react4.createElement)(
          "section",
          { className: "di-card" },
          (0, import_react4.createElement)("h4", null, "\u7FFB\u8BD1"),
          (0, import_react4.createElement)(Kv, { label: "\u6A21\u5F0F", value: autoTranslate ? "\u82F1\u8BD1\u4E2D" : "\u53EA\u8F6C\u5199" }),
          (0, import_react4.createElement)(
            "label",
            { className: "di-note", style: { display: "flex", gap: "6px", alignItems: "center", marginTop: "6px" } },
            (0, import_react4.createElement)("input", {
              type: "checkbox",
              checked: autoTranslate,
              onChange: (event) => controller.saveConfig({ autoTranslate: event.target.checked })
            }),
            "\u542F\u7528\u4E2D\u6587\u7FFB\u8BD1"
          ),
          (0, import_react4.createElement)(
            "label",
            { className: "di-note", style: { display: "flex", gap: "6px", alignItems: "center", marginTop: "4px" } },
            (0, import_react4.createElement)("input", {
              type: "checkbox",
              checked: state?.config?.liveTranslate !== false,
              onChange: (event) => controller.saveConfig({ liveTranslate: event.target.checked })
            }),
            "\u4E2D\u6587\u8349\u7A3F\u540C\u6B65\uFF08\u8FB9\u542C\u8FB9\u8BD1\uFF09"
          ),
          (0, import_react4.createElement)(
            "label",
            { className: "di-note", style: { display: "flex", gap: "6px", alignItems: "center", marginTop: "4px" } },
            (0, import_react4.createElement)("input", {
              type: "checkbox",
              checked: state?.config?.systemAudio !== "off",
              onChange: (event) => controller.saveConfig({ systemAudio: event.target.checked ? "auto" : "off" })
            }),
            "\u91C7\u96C6\u7CFB\u7EDF\u97F3\u9891\uFF08\u4E0B\u6B21\u5F00\u59CB\u751F\u6548\uFF09"
          ),
          (0, import_react4.createElement)(
            "label",
            { className: "di-note", style: { display: "flex", gap: "6px", alignItems: "center", marginTop: "4px" } },
            (0, import_react4.createElement)("input", {
              type: "checkbox",
              checked: state?.config?.draftMode !== false,
              onChange: (event) => controller.saveConfig({ draftMode: event.target.checked })
            }),
            "\u6D41\u5F0F\u8349\u7A3F\uFF08\u8FB9\u8BF4\u8FB9\u51FA\u82F1\u6587\uFF09"
          ),
          (0, import_react4.createElement)("textarea", {
            style: { width: "100%", minHeight: "48px", boxSizing: "border-box", resize: "vertical", border: "1px solid var(--di-border)", borderRadius: "8px", padding: "6px 8px", marginTop: "6px", background: "var(--di-surface)", color: "var(--di-fg)", font: "inherit", fontSize: "12px" },
            value: brief,
            placeholder: "\u573A\u666F\u8BF4\u660E\uFF1A\u5982\u300C\u7EBF\u6027\u4EE3\u6570\u7814\u7A76\u751F\u8BFE\uFF0C\u542C\u4F17\u6709\u6570\u5B66\u80CC\u666F\uFF1B\u4FDD\u6301\u5B9A\u7406\u4E0E\u7B26\u53F7\u51C6\u786E\u300D",
            onChange: (event) => {
              setBrief(event.target.value);
              setBriefDirty(true);
            },
            spellCheck: false
          }),
          (0, import_react4.createElement)(
            "div",
            { className: "di-actions" },
            (0, import_react4.createElement)("button", {
              className: "di-btn",
              onClick: () => {
                controller.saveConfig({ brief }).then(() => setBriefDirty(false));
              }
            }, "\u4FDD\u5B58\u573A\u666F\u8BF4\u660E")
          )
        ),
        (0, import_react4.createElement)(
          "section",
          { className: "di-card" },
          (0, import_react4.createElement)("h4", null, "\u7FFB\u8BD1\u81EA\u6D4B"),
          (0, import_react4.createElement)(
            "div",
            { className: "di-test" },
            (0, import_react4.createElement)("textarea", {
              value: testText,
              onChange: (event) => setTestText(event.target.value),
              spellCheck: false
            }),
            (0, import_react4.createElement)(
              "div",
              { className: "di-actions" },
              (0, import_react4.createElement)("button", {
                className: "di-btn",
                disabled: testBusy || !testText.trim(),
                onClick: () => controller.translateTest(testText)
              }, testBusy ? "\u7FFB\u8BD1\u4E2D\u2026" : "\u8BD5\u7FFB\u8BD1")
            )
          ),
          testResult ? (0, import_react4.createElement)(
            "div",
            { className: "di-result", style: { marginTop: "8px" } },
            testResult.ok ? (0, import_react4.createElement)(
              "div",
              null,
              (0, import_react4.createElement)("div", null, testResult.text),
              testResult.provider || testResult.model ? (0, import_react4.createElement)("div", { className: "di-note" }, "\u5B9E\u9645\u6A21\u578B\uFF1A" + [testResult.provider, testResult.model].filter(Boolean).join(" / ")) : null
            ) : "\u5931\u8D25: " + testResult.message
          ) : null
        ),
        (0, import_react4.createElement)(
          "section",
          { className: "di-card" },
          (0, import_react4.createElement)("h4", null, "\u672F\u8BED\u8868 (" + (glossary?.count ?? 0) + ")"),
          (0, import_react4.createElement)("textarea", {
            className: "di-test-textarea",
            style: { width: "100%", minHeight: "84px", boxSizing: "border-box", resize: "vertical", border: "1px solid var(--di-border)", borderRadius: "8px", padding: "6px 8px", background: "var(--di-surface)", color: "var(--di-fg)", font: "inherit", fontSize: "12px" },
            value: glossaryText,
            placeholder: "eigenvalue => \u7279\u5F81\u503C\ntrace => \u8FF9",
            onChange: (event) => {
              setGlossaryText(event.target.value);
              setGlossaryDirty(true);
            },
            spellCheck: false
          }),
          (0, import_react4.createElement)(
            "div",
            { className: "di-actions" },
            (0, import_react4.createElement)("button", { className: "di-btn", disabled: snapshot.glossaryBusy, onClick: saveGlossary }, snapshot.glossaryBusy ? "\u4FDD\u5B58\u4E2D\u2026" : "\u4FDD\u5B58\u672F\u8BED"),
            (0, import_react4.createElement)(
              "label",
              { className: "di-btn", style: { cursor: "pointer" } },
              "\u5BFC\u5165",
              (0, import_react4.createElement)("input", { type: "file", accept: ".csv,.tsv,.tmx,.json,text/plain", style: { display: "none" }, onChange: importGlossaryFile })
            )
          ),
          (0, import_react4.createElement)("div", { className: "di-note" }, "\u6BCF\u884C source => target\uFF1B\u5BFC\u5165\u652F\u6301 CSV/TSV/TMX/JSON\u3002")
        ),
        (0, import_react4.createElement)(
          "section",
          { className: "di-card" },
          (0, import_react4.createElement)("h4", null, "\u5BFC\u51FA"),
          (0, import_react4.createElement)(
            "div",
            { className: "di-actions" },
            (0, import_react4.createElement)("a", { className: "di-btn", href: controller.exportUrl("srt-bilingual"), download: "interpret-bilingual.srt" }, "\u53CC\u8BED SRT"),
            (0, import_react4.createElement)("a", { className: "di-btn", href: controller.exportUrl("srt-en"), download: "interpret-en.srt" }, "\u82F1\u6587 SRT"),
            (0, import_react4.createElement)("a", { className: "di-btn", href: controller.exportUrl("srt-zh"), download: "interpret-zh.srt" }, "\u4E2D\u6587 SRT"),
            (0, import_react4.createElement)("a", { className: "di-btn", href: controller.exportUrl("md"), download: "interpret.md" }, "Markdown")
          ),
          (0, import_react4.createElement)("div", { className: "di-note" }, "\u5BFC\u51FA\u5F53\u524D\u4F1A\u8BDD\u5DF2\u5B8C\u6210\u7684\u53CC\u8BED\u5B57\u5E55\u3002")
        ),
        (0, import_react4.createElement)(
          "section",
          { className: "di-card" },
          (0, import_react4.createElement)("h4", null, "\u672C\u6B21\u7EDF\u8BA1"),
          (0, import_react4.createElement)(Kv, { label: "\u5B8C\u6210\u53E5\u6570", value: String(state?.stats?.segments ?? 0) }),
          (0, import_react4.createElement)(Kv, { label: "\u5DF2\u8FC7\u6EE4", value: String(state?.stats?.dropped ?? 0) }),
          (0, import_react4.createElement)(Kv, { label: "\u56DE\u58F0\u53BB\u91CD", value: String(state?.stats?.echoDropped ?? 0) }),
          (0, import_react4.createElement)(Kv, { label: "\u9519\u8BEF", value: String(state?.stats?.errors ?? 0) }),
          (0, import_react4.createElement)(Kv, { label: "ASR \u5E73\u5747", value: state?.stats?.avgAsrMs ? state.stats.avgAsrMs + "ms" : "\u2014" }),
          (0, import_react4.createElement)(Kv, { label: "\u7FFB\u8BD1\u5E73\u5747", value: state?.stats?.avgMtMs ? state.stats.avgMtMs + "ms" : "\u2014" }),
          (0, import_react4.createElement)(Kv, { label: "\u9996\u5B57\u5E73\u5747", value: state?.stats?.avgFirstTokenMs ? state.stats.avgFirstTokenMs + "ms" : "\u2014" }),
          (0, import_react4.createElement)(Kv, { label: "\u5B9E\u65F6\u66F4\u65B0", value: String(state?.stats?.liveUpdates ?? 0) }),
          (0, import_react4.createElement)(Kv, { label: "\u4E2D\u6587\u8349\u7A3F", value: String(state?.stats?.liveTranslateCount ?? 0) }),
          (0, import_react4.createElement)(Kv, { label: "\u672F\u8BED\u7EA0\u6B63", value: String(state?.stats?.termRepairs ?? 0) }),
          (0, import_react4.createElement)(Kv, { label: "\u8D28\u68C0\u4FEE\u6B63", value: String(state?.stats?.qaRepairs ?? 0) }),
          (0, import_react4.createElement)(
            "label",
            { className: "di-note", style: { display: "flex", gap: "6px", alignItems: "center", marginTop: "8px" } },
            (0, import_react4.createElement)("input", {
              type: "checkbox",
              checked: showDropped,
              onChange: (event) => setShowDropped(event.target.checked)
            }),
            "\u663E\u793A\u5DF2\u8FC7\u6EE4\u7247\u6BB5"
          )
        ),
        (0, import_react4.createElement)(
          "section",
          { className: "di-card" },
          (0, import_react4.createElement)("h4", null, "\u5386\u53F2\u4F1A\u8BDD"),
          (0, import_react4.createElement)(
            "div",
            { className: "di-actions" },
            (0, import_react4.createElement)("button", { className: "di-btn", onClick: () => controller.loadSessions() }, "\u5237\u65B0\u5386\u53F2")
          ),
          !history?.length ? (0, import_react4.createElement)("div", { className: "di-note" }, "\u8FD8\u6CA1\u6709\u5DF2\u4FDD\u5B58\u7684\u4F1A\u8BDD\u3002") : history.slice(0, 8).map((item) => (0, import_react4.createElement)(
            "div",
            { className: "di-history-item", key: item.id },
            (0, import_react4.createElement)("div", { className: "di-history-title" }, item.title),
            (0, import_react4.createElement)("div", { className: "di-note" }, (item.startedAt ? new Date(item.startedAt).toLocaleString() : item.id) + " \xB7 " + item.segments + " \u53E5"),
            (0, import_react4.createElement)(
              "div",
              { className: "di-actions" },
              (0, import_react4.createElement)("button", { className: "di-btn", onClick: () => controller.openSession(item.id) }, "\u67E5\u770B"),
              (0, import_react4.createElement)("a", { className: "di-btn", href: controller.exportUrl("srt-bilingual", item.id), download: "interpret-" + item.id + ".srt" }, "\u5BFC\u51FA"),
              (0, import_react4.createElement)("button", { className: "di-btn danger", onClick: () => {
                if (window.confirm("\u5220\u9664\u4F1A\u8BDD\u300C" + item.title + "\u300D\uFF1F\u6B64\u64CD\u4F5C\u4E0D\u53EF\u6062\u590D\u3002")) controller.deleteSession(item.id);
              } }, "\u5220\u9664")
            )
          ))
        ),
        (0, import_react4.createElement)(
          "section",
          { className: "di-card" },
          (0, import_react4.createElement)("h4", null, "\u8FD0\u884C\u4FE1\u606F\u4E0E\u8BCA\u65AD"),
          (0, import_react4.createElement)(Kv, { label: "\u9636\u6BB5", value: PHASE_LABEL[state?.phase] || state?.phase || "\u2014" }),
          (0, import_react4.createElement)(Kv, { label: "\u8FDE\u63A5", value: connection === "open" ? "SSE \u5B9E\u65F6" : "\u8F6E\u8BE2\u515C\u5E95" }),
          (0, import_react4.createElement)(Kv, { label: "\u97F3\u8F68", value: [state?.tracks?.mic ? "\u9EA6\u514B\u98CE" : null, state?.tracks?.system ? "\u7CFB\u7EDF\u97F3\u9891" : null].filter(Boolean).join(" + ") || "\u672A\u91C7\u96C6" }),
          (0, import_react4.createElement)(Kv, { label: "ASR", value: picked?.id || "\u2014" }),
          (0, import_react4.createElement)(Kv, { label: "\u7FFB\u8BD1", value: mt ? mt.provider + " / " + mt.model : "\u672A\u9009\u62E9" }),
          (0, import_react4.createElement)(Kv, { label: "\u505C\u6B62\u539F\u56E0", value: state?.stopReason || "\u2014" }),
          (0, import_react4.createElement)(Kv, { label: "\u7A7A\u95F2", value: state?.idleMs ? Math.round(state.idleMs / 1e3) + "s" : "\u2014" }),
          (0, import_react4.createElement)(Kv, { label: "\u6570\u636E\u76EE\u5F55", value: state?.config?.dataDir || "\u2014" }),
          (0, import_react4.createElement)(Kv, { label: "VAD \u9608\u503C", value: String(state?.config?.vadThreshold ?? "\u2014") }),
          (0, import_react4.createElement)("div", { className: "di-note" }, "\u97F3\u9891\u4EC5\u5728\u672C\u673A\u8BC6\u522B\uFF1B\u53EA\u6709\u8BC6\u522B\u6587\u672C\u4F1A\u53D1\u9001\u5230\u4F60\u914D\u7F6E\u7684 DSH \u6A21\u578B\u8DEF\u7531\u3002")
        )
      ) : null
    ),
    (0, import_react4.createElement)(
      "footer",
      { className: "di-footer" },
      (0, import_react4.createElement)("span", null, connection === "open" ? "\u5B9E\u65F6\u8FDE\u63A5\u6B63\u5E38" : "\u8FDE\u63A5\u4E2D\u65AD\uFF0C\u6B63\u5728\u91CD\u8FDE\u2026"),
      (0, import_react4.createElement)("span", { className: "di-spacer" }),
      (0, import_react4.createElement)("span", null, "\u4F1A\u8BDD " + (state?.sessionId || "\u2014")),
      (0, import_react4.createElement)("span", null, "\u7528\u65F6 " + fmtClock(elapsedMs))
    ),
    historyView ? (0, import_react4.createElement)(
      "div",
      { className: "di-modal-backdrop", onClick: () => controller.closeSession() },
      (0, import_react4.createElement)(
        "div",
        { className: "di-modal", onClick: (event) => event.stopPropagation() },
        (0, import_react4.createElement)(
          "div",
          { className: "di-modal-head" },
          (0, import_react4.createElement)("strong", null, historyView.title || historyView.id),
          (0, import_react4.createElement)("span", { className: "di-spacer" }),
          (0, import_react4.createElement)("button", { className: "di-btn", onClick: () => controller.closeSession() }, "\u5173\u95ED")
        ),
        (0, import_react4.createElement)(
          "div",
          { className: "di-modal-list" },
          (historyView.segments || []).filter((segment) => segment.status !== "dropped").map((segment) => (0, import_react4.createElement)(CaptionRow, { key: segment.id, segment }))
        ),
        (0, import_react4.createElement)(
          "div",
          { className: "di-footer" },
          (0, import_react4.createElement)("span", null, (historyView.segments || []).length + " \u6BB5"),
          (0, import_react4.createElement)("span", { className: "di-spacer" }),
          (0, import_react4.createElement)("a", { className: "di-btn", href: controller.exportUrl("srt-bilingual", historyView.id), download: "interpret-" + historyView.id + ".srt" }, "\u53CC\u8BED SRT"),
          (0, import_react4.createElement)("a", { className: "di-btn", href: controller.exportUrl("md", historyView.id), download: "interpret-" + historyView.id + ".md" }, "Markdown")
        )
      )
    ) : null
  );
}

// src/client/dock.js
var import_react5 = require("react");
function CaptionDock({ controller }) {
  const snapshot = (0, import_react5.useSyncExternalStore)(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const { state, segments, busy, connection, error, draft, live } = snapshot;
  const listRef = (0, import_react5.useRef)(null);
  const stickRef = (0, import_react5.useRef)(true);
  const running = state?.phase === "listening";
  const stopping = state?.phase === "stopping";
  const picked = state?.asr?.picked;
  const providerReady = picked?.preparation?.phase === "ready";
  const mt = state?.mt;
  const autoTranslate = state?.config?.autoTranslate !== false;
  const canStart = !busy && !running && !stopping && providerReady && (!autoTranslate || Boolean(mt?.provider));
  const visible = segments.filter((segment) => segment.status !== "dropped").slice(-60);
  const liveRows = [live?.mic, live?.system].filter((item) => item?.en);
  const elapsed = running ? snapshot.elapsed : state?.elapsedMs || 0;
  (0, import_react5.useEffect)(() => {
    const el = listRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [segments.length, live?.mic?.en, live?.system?.en]);
  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };
  return (0, import_react5.createElement)(
    "div",
    { className: "dsh-interpret-root di-dock" },
    (0, import_react5.createElement)(
      "div",
      { className: "di-dock-head" },
      (0, import_react5.createElement)("span", { className: "di-title" }, "\u540C\u4F20\u5B57\u5E55"),
      (0, import_react5.createElement)("span", { className: "di-chip" }, (0, import_react5.createElement)("span", { className: "di-dot " + (running ? "live" : "") }), running ? fmtClock(elapsed) : state?.phase === "completed" ? "\u5DF2\u7ED3\u675F" : "\u7A7A\u95F2"),
      (0, import_react5.createElement)("span", { className: "di-spacer" }),
      running || stopping ? (0, import_react5.createElement)("button", { className: "di-btn danger", disabled: busy || stopping, onClick: () => controller.stop() }, stopping ? "\u6536\u5C3E\u4E2D" : "\u505C\u6B62") : (0, import_react5.createElement)("button", { className: "di-btn primary", disabled: !canStart, onClick: () => controller.start(), title: !providerReady ? "\u5148\u5728\u4E3B\u9762\u677F\u51C6\u5907\u6A21\u578B" : !mt?.provider && autoTranslate ? "\u6CA1\u6709\u7FFB\u8BD1\u8DEF\u7531" : "\u5F00\u59CB\u540C\u4F20" }, busy ? "\u542F\u52A8\u4E2D" : "\u5F00\u59CB")
    ),
    error ? (0, import_react5.createElement)("div", { className: "di-banner" }, (0, import_react5.createElement)("span", null, error)) : null,
    (0, import_react5.createElement)(
      "div",
      { className: "di-list di-dock-list", ref: listRef, onScroll },
      visible.length ? visible.map((segment) => (0, import_react5.createElement)(CaptionRow, { key: segment.id, segment })) : liveRows.length ? null : (0, import_react5.createElement)(
        "div",
        { className: "di-empty" },
        (0, import_react5.createElement)("strong", null, running ? "\u6B63\u5728\u8046\u542C\u2026" : "\u7B49\u5F85\u5F00\u59CB"),
        (0, import_react5.createElement)("div", null, running ? "\u82F1\u6587\u9010\u8BCD\u51FA\u73B0\uFF0C\u4E2D\u6587\u968F\u540E\u66F4\u65B0\u3002" : "\u53EF\u5728\u4E3B\u9762\u677F\u5F00\u59CB\uFF0C\u6216\u70B9\u8FD9\u91CC\u76F4\u63A5\u5F00\u59CB\u3002")
      ),
      liveRows.map((item) => (0, import_react5.createElement)(LiveRow, { key: "live-" + item.track, item, showZh: autoTranslate })),
      draft?.en ? (0, import_react5.createElement)("div", { className: "di-row di-draft" }, (0, import_react5.createElement)("div", { className: "di-meta" }, "\u8349\u7A3F"), (0, import_react5.createElement)("div", { className: "di-en" }, draft.en)) : null,
      (0, import_react5.createElement)("div", { style: { height: "1px" } })
    ),
    (0, import_react5.createElement)(
      "div",
      { className: "di-footer" },
      (0, import_react5.createElement)("span", null, connection === "open" ? "\u5B9E\u65F6" : "\u8F6E\u8BE2"),
      (0, import_react5.createElement)("span", { className: "di-spacer" }),
      (0, import_react5.createElement)("span", null, state?.stats?.segments ? state.stats.segments + " \u53E5" : "\u2014"),
      (0, import_react5.createElement)("span", null, state?.tracks?.system ? "\u53CC\u97F3\u8F68" : "\u9EA6\u514B\u98CE")
    )
  );
}

// src/client/styles.js
var CSS = String.raw`
.dsh-interpret-root {
  --di-fg: var(--dsh-text-primary, #1f2328);
  --di-muted: var(--dsh-text-secondary, #6b7280);
  --di-border: var(--dsh-border-default, rgba(127,127,127,.22));
  --di-surface: var(--dsh-surface-primary, transparent);
  --di-raised: var(--dsh-surface-raised, rgba(127,127,127,.06));
  --di-panel-bg: #ffffff;
  --di-accent: var(--dsh-accent, #4f7cff);
  --di-danger: var(--dsh-danger, #d14343);
  --di-ok: var(--dsh-success, #2f9e63);
  color: var(--di-fg);
  background: var(--di-surface);
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  font-size: 14px;
  line-height: 1.5;
}
@media (prefers-color-scheme: dark) {
  .dsh-interpret-root {
    --di-fg: var(--dsh-text-primary, #e6e8eb);
    --di-muted: var(--dsh-text-secondary, #9aa1ab);
    --di-border: var(--dsh-border-default, rgba(255,255,255,.16));
    --di-raised: var(--dsh-surface-raised, rgba(255,255,255,.06));
    --di-panel-bg: #1b1f24;
  }
}
.di-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--di-border);
  flex: none;
}
.di-title { display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 15px; }
.di-title svg { opacity: .85; }
.di-sub { color: var(--di-muted); font-size: 12px; }
.di-spacer { flex: 1; }
.di-chip {
  display: inline-flex; align-items: center; gap: 5px;
  border: 1px solid var(--di-border);
  border-radius: 999px;
  padding: 1px 8px;
  font-size: 11px;
  color: var(--di-muted);
  white-space: nowrap;
}
.di-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--di-muted); }
.di-dot.ok { background: var(--di-ok); }
.di-dot.warn { background: #d9a520; }
.di-dot.bad { background: var(--di-danger); }
.di-dot.live { background: var(--di-ok); box-shadow: 0 0 0 3px rgba(47,158,99,.18); }
.di-btn {
  appearance: none; border: 1px solid var(--di-border); background: var(--di-raised);
  color: var(--di-fg); border-radius: 8px; padding: 7px 14px; font-size: 13px;
  cursor: pointer; font-weight: 500;
}
.di-select { width: 100%; box-sizing: border-box; margin: 4px 0 6px; padding: 5px 7px; border: 1px solid var(--di-border); border-radius: 7px; background: var(--di-surface); color: var(--di-fg); font: inherit; font-size: 12px; }
.di-btn:hover:not(:disabled) { border-color: var(--di-accent); }
.di-btn:disabled { opacity: .5; cursor: not-allowed; }
.di-btn.primary { background: var(--di-accent); border-color: var(--di-accent); color: #fff; }
.di-btn.danger { background: var(--di-danger); border-color: var(--di-danger); color: #fff; }
.di-btn.ghost { background: transparent; }
.di-btn.ghost.active { border-color: var(--di-accent); color: var(--di-accent); }
.di-banner {
  margin: 10px 16px 0; padding: 9px 12px; border-radius: 8px; font-size: 12px;
  border: 1px solid rgba(209,67,67,.35); background: rgba(209,67,67,.08); color: var(--di-fg);
  display: flex; gap: 10px; align-items: flex-start;
}
.di-banner .di-spacer { flex: 1; }
.di-body { display: flex; min-height: 0; flex: 1; }
.di-main { flex: 1; min-width: 0; display: flex; flex-direction: column; min-height: 0; }
.di-list { flex: 1; overflow: auto; padding: 10px 16px 18px; scroll-behavior: smooth; }
.di-empty { padding: 36px 16px; color: var(--di-muted); font-size: 13px; text-align: center; }
.di-empty strong { color: var(--di-fg); display: block; margin-bottom: 6px; }
.di-row { padding: 9px 0 10px; border-bottom: 1px dashed var(--di-border); }
.di-row:last-child { border-bottom: none; }
.di-meta { display: flex; align-items: center; gap: 8px; color: var(--di-muted); font-size: 11px; margin-bottom: 3px; }
.di-time { font-variant-numeric: tabular-nums; }
.di-src { border: 1px solid var(--di-border); border-radius: 4px; padding: 0 5px; }
.di-en { color: var(--di-muted); font-size: 13px; word-break: break-word; }
.di-zh { color: var(--di-fg); font-size: 16px; line-height: 1.55; margin-top: 3px; word-break: break-word; }
.di-zh.pending { color: var(--di-muted); font-size: 14px; font-style: italic; }
.di-badge { margin-left: auto; }
.di-badge.error { color: var(--di-danger); }
.di-badge.dropped { color: var(--di-muted); }
.di-right-dock {
  flex: none; width: clamp(420px, 44vw, 680px); min-height: 0; overflow: hidden;
  border-left: 1px solid var(--di-border); background: var(--di-panel-bg);
  display: flex; flex-direction: column;
}
.di-right-dock .di-dock { width: 100%; height: 100%; }
.di-reader {
  display: flex; flex-direction: column; height: 100%; min-height: 0;
  background: var(--di-panel-bg); color: var(--di-fg);
}
.di-reader-head {
  display: flex; align-items: center; gap: 8px; padding: 9px 10px 7px;
  border-bottom: 1px solid var(--di-border); flex: none; min-width: 0;
}
.di-reader-title { display: flex; align-items: baseline; gap: 7px; min-width: 0; }
.di-reader-title strong { font-size: 13px; white-space: nowrap; }
.di-reader-name {
  font-size: 11px; color: var(--di-muted); overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; max-width: 180px;
}
.di-reader-spacer { flex: 1; }
.di-reader-tools {
  display: flex; align-items: center; gap: 6px; padding: 6px 10px;
  border-bottom: 1px solid var(--di-border); flex: none; min-width: 0;
}
.di-reader-tools .di-btn { padding: 3px 8px; font-size: 11px; }
.di-reader-select { width: min(210px, 45%); margin: 0; }
.di-reader-meta, .di-reader-hint { color: var(--di-muted); font-size: 11px; }
.di-reader-body {
  position: relative; flex: 1; min-height: 0; display: flex; flex-direction: column;
  overflow: hidden; background: var(--di-panel-bg);
}
.di-reader-body.dragging { outline: 2px dashed var(--di-accent); outline-offset: -6px; }
.di-reader-frame { flex: 1; width: 100%; height: 100%; border: 0; background: #fff; display: block; }
.di-reader-empty {
  margin: auto; padding: 28px 22px; text-align: center; color: var(--di-muted);
  display: flex; flex-direction: column; align-items: center; gap: 6px; max-width: 360px;
}
.di-reader-empty strong { color: var(--di-fg); font-size: 15px; }
.di-reader-empty p { margin: 0; font-size: 12px; }
.di-reader-empty .di-btn { margin-top: 10px; }
.di-reader-state {
  margin: auto; display: flex; align-items: center; gap: 9px; padding: 24px;
  color: var(--di-muted); font-size: 13px; flex-direction: column; text-align: center;
}
.di-reader-state.error { color: var(--di-danger); }
.di-reader-spinner {
  width: 18px; height: 18px; border-radius: 50%; border: 2px solid var(--di-border);
  border-top-color: var(--di-accent); animation: di-spin .8s linear infinite;
}
@keyframes di-spin { to { transform: rotate(360deg); } }
.di-reader-error {
  position: absolute; left: 10px; right: 10px; bottom: 10px; z-index: 3;
  padding: 8px 10px; border: 1px solid rgba(209,67,67,.35); border-radius: 8px;
  background: rgba(209,67,67,.08); color: var(--di-fg); font-size: 12px;
}
.di-reader-markdown {
  flex: 1; overflow: auto; padding: 14px 16px 30px; font-size: 14px; line-height: 1.7;
  word-break: break-word;
}
.di-reader-markdown h1 { font-size: 21px; margin: 4px 0 14px; }
.di-reader-markdown h2 { font-size: 17px; margin: 22px 0 9px; border-bottom: 1px solid var(--di-border); padding-bottom: 4px; }
.di-reader-markdown h3 { font-size: 15px; margin: 16px 0 7px; }
.di-reader-markdown p { margin: 0 0 10px; }
.di-reader-markdown ul, .di-reader-markdown ol { margin: 0 0 12px 20px; padding: 0; }
.di-reader-markdown li { margin: 3px 0; }
.di-reader-markdown pre {
  background: var(--di-raised); border: 1px solid var(--di-border); border-radius: 8px;
  padding: 10px 12px; overflow: auto; font-size: 12px; line-height: 1.55;
}
.di-reader-markdown code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .92em; }
.di-reader-markdown blockquote {
  margin: 0 0 12px; padding: 2px 0 2px 10px; border-left: 3px solid var(--di-border); color: var(--di-muted);
}
.di-reader-markdown a { color: var(--di-accent); }
.di-reader-table-wrap { flex: 1; overflow: auto; padding: 10px 12px 24px; }
.di-reader-table { border-collapse: collapse; width: 100%; font-size: 12px; }
.di-reader-table th, .di-reader-table td {
  border: 1px solid var(--di-border); padding: 5px 7px; text-align: left; vertical-align: top;
  max-width: 260px; word-break: break-word;
}
.di-reader-table th { position: sticky; top: 0; background: var(--di-panel-bg); z-index: 1; }
.di-reader-markdown .di-reader-table { margin: 4px 0 14px; }

.di-aside {
  flex: none; width: 300px; border-left: 1px solid var(--di-border);
  padding: 12px 14px 20px; overflow: auto; display: flex; flex-direction: column; gap: 14px;
}
.di-card { border: 1px solid var(--di-border); border-radius: 10px; padding: 10px 12px; background: var(--di-raised); }
.di-card h4 { margin: 0 0 8px; font-size: 12px; color: var(--di-muted); font-weight: 600; letter-spacing: .02em; text-transform: uppercase; }
.di-kv { display: flex; justify-content: space-between; gap: 10px; font-size: 12px; padding: 2px 0; }
.di-kv span:first-child { color: var(--di-muted); }
.di-kv span:last-child { text-align: right; word-break: break-word; }
.di-actions { display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
.di-note { color: var(--di-muted); font-size: 11px; margin-top: 6px; }
.di-progress { height: 4px; background: var(--di-border); border-radius: 999px; overflow: hidden; margin-top: 8px; }
.di-progress > div { height: 100%; background: var(--di-accent); transition: width .2s linear; }
.di-test { display: flex; flex-direction: column; gap: 6px; }
.di-test textarea {
  width: 100%; box-sizing: border-box; resize: vertical; min-height: 54px;
  border: 1px solid var(--di-border); border-radius: 8px; padding: 6px 8px;
  background: var(--di-surface); color: var(--di-fg); font: inherit; font-size: 12px;
}
.di-result { font-size: 12px; border-left: 2px solid var(--di-accent); padding-left: 8px; white-space: pre-wrap; }
.di-footer { flex: none; border-top: 1px solid var(--di-border); padding: 6px 16px; color: var(--di-muted); font-size: 11px; display: flex; gap: 14px; align-items: center; }
.di-footer .di-spacer { flex: 1; }
.di-term-results { margin-top: 8px; display: flex; flex-direction: column; gap: 6px; max-height: 260px; overflow: auto; }
.di-term { padding: 6px 8px; border: 1px solid var(--di-border); border-radius: 8px; background: var(--di-raised); }
.di-term-head { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; }
.di-term-head strong { font-size: 13px; }
.di-term .di-note { font-size: 11px; margin-top: 2px; }
.di-live { background: linear-gradient(90deg, rgba(79,124,255,.08), transparent 70%); border-left: 2px solid var(--di-accent); padding-left: 8px; border-bottom-style: solid; }
.di-live .di-meta { color: var(--di-accent); }
.di-live-en { color: var(--di-fg); font-size: 15px; }
.di-live-en::after { content: ''; display: inline-block; width: 2px; height: 1em; margin-left: 3px; vertical-align: -2px; background: var(--di-accent); animation: di-caret 1s steps(1) infinite; }
.di-zh.provisional { color: var(--di-muted); font-size: 14px; }
@keyframes di-caret { 50% { opacity: 0; } }
.di-draft { opacity: .66; border-bottom-style: dotted; }
.di-draft .di-meta { color: var(--di-accent); }
.di-draft-en { font-style: italic; }
.di-history-item { border-top: 1px dashed var(--di-border); padding: 7px 0 3px; margin-top: 6px; }
.di-history-title { font-size: 12px; font-weight: 600; word-break: break-word; }
.di-modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.4); display: flex; align-items: center; justify-content: center; z-index: 60; padding: 24px; }
.di-modal { width: min(860px, 92vw); height: min(680px, 86vh); background: var(--di-panel-bg); color: var(--di-fg); border: 1px solid var(--di-border); border-radius: 12px; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 18px 60px rgba(0,0,0,.35); }
.di-modal-head { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-bottom: 1px solid var(--di-border); }
.di-modal-list { flex: 1; overflow: auto; padding: 8px 14px 16px; }
.di-dock { height: 100%; }
.di-dock-head { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid var(--di-border); flex: none; }
.di-dock-list { padding: 6px 10px 12px; }
.di-dock .di-title { font-size: 13px; }
.di-dock .di-row { padding: 6px 0; }
.di-dock .di-zh { font-size: 14px; }
.di-dock .di-en { font-size: 12px; }
.di-dock .di-footer { padding: 4px 10px; }
@media (max-width: 900px) {
  .di-aside { width: 240px; }
  .di-body { position: relative; }
  .di-right-dock {
    position: absolute; top: 0; right: 0; bottom: 0; z-index: 20;
    width: min(80vw, 420px); box-shadow: -12px 0 32px rgba(0,0,0,.22);
  }
}
@media (max-width: 720px) {
  .di-body { flex-direction: column; }
  .di-aside { width: auto; border-left: none; border-top: 1px solid var(--di-border); max-height: 45%; }
}
`;
var installed = false;
function ensureStyles() {
  if (installed || typeof document === "undefined") return;
  installed = true;
  const style = document.createElement("style");
  style.setAttribute("data-dsh-interpret", "styles");
  style.textContent = CSS;
  document.head.appendChild(style);
}

// src/client/index.js
var inject = ["slots"];
var DOCK_ID = "dsh-interpret/captions";
var DOCK_KIND = "interpret-captions";
var DOCK_DEFINITION = {
  id: DOCK_ID,
  kind: DOCK_KIND,
  priority: "extension",
  keepMounted: true,
  title: () => "\u540C\u4F20\u5B57\u5E55",
  guide: [{
    id: "captions",
    order: 10,
    title: () => "\u540C\u4F20\u5B57\u5E55",
    description: () => "\u5B9E\u65F6\u82F1\u4E2D\u53CC\u8BED\u5B57\u5E55"
  }]
};
function reportClient(type, extra = {}) {
  try {
    fetch("/interpret/api/client-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, ...extra }),
      cache: "no-store"
    }).catch(() => {
    });
  } catch {
  }
}
var Boundary = class extends import_react6.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    reportClient("render-error", {
      message: String(error?.message || error).slice(0, 1200),
      stack: String(error?.stack || "").slice(0, 2400),
      componentStack: String(info?.componentStack || "").slice(0, 2400)
    });
  }
  render() {
    if (this.state.error) {
      return (0, import_react6.createElement)(
        "div",
        { className: "di-banner", style: { margin: "16px" } },
        (0, import_react6.createElement)("span", null, "\u540C\u4F20\u9762\u677F\u6E32\u67D3\u9519\u8BEF\uFF1A" + String(this.state.error.message || this.state.error))
      );
    }
    return this.props.children;
  }
};
function apply(ctx) {
  ensureStyles();
  const controller = new Controller();
  controller.connect();
  controller.setDock({ available: false, registered: false, reason: "\u53F3\u4FA7\u680F\u52A0\u8F7D\u4E2D\u2026", mounted: false, expanded: false });
  let dockAvailable = false;
  let sidebarRight = null;
  let sidebarRightTabs = null;
  let failure = null;
  let dockTimeout = null;
  const reportStatus = () => {
    const mounted = Boolean(sidebarRight?.mounted?.getSnapshot?.());
    const expanded = Boolean(sidebarRight?.isExpanded?.());
    controller.setDock({
      available: dockAvailable,
      registered: Boolean(sidebarRightTabs?.get?.(DOCK_KIND)),
      mounted,
      expanded,
      reason: dockAvailable ? null : failure || "\u53F3\u4FA7\u680F\u52A0\u8F7D\u4E2D\u2026"
    });
    try {
      fetch("/interpret/api/client-ready", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dockAvailable,
          registered: Boolean(sidebarRightTabs?.get?.(DOCK_KIND)),
          hasSidebarRight: Boolean(sidebarRight),
          mounted,
          expanded,
          failure
        }),
        cache: "no-store"
      }).catch(() => {
      });
    } catch {
    }
  };
  const registerDock = (scope) => {
    const tabs = scope.sidebarRightTabs;
    if (!tabs) throw new Error("\u53F3\u4FA7\u680F tab \u6CE8\u518C\u5668\u4E0D\u53EF\u7528");
    const existing = tabs.get?.(DOCK_KIND);
    if (existing && existing.id !== DOCK_ID) throw new Error("\u53F3\u680F kind \u5DF2\u88AB\u5176\u4ED6\u63D2\u4EF6\u5360\u7528");
    let disposeTab = null;
    if (!existing) {
      disposeTab = tabs.register(DOCK_DEFINITION);
    }
    scope.effect(() => () => {
      try {
        disposeTab?.();
      } catch {
      }
    }, "dsh-interpret: dock type cleanup");
    scope.slots.inject("sidebar.right.pane.tab", () => scope.slots.register({
      name: "sidebar.right.pane.tab",
      key: DOCK_ID
    }, Dock));
    const definition = tabs.get?.(DOCK_KIND);
    if (!definition || definition.id !== DOCK_ID) throw new Error("\u53F3\u680F\u5B57\u5E55\u7C7B\u578B\u6CE8\u518C\u672A\u751F\u6548");
    return true;
  };
  const openDock = () => {
    const current = Boolean(controller.getSnapshot().dock?.open);
    controller.setDock({ open: !current });
  };
  const Panel = () => (0, import_react6.createElement)(Boundary, null, (0, import_react6.createElement)(PanelView, { controller, openDock }));
  const Dock = () => (0, import_react6.createElement)(Boundary, null, (0, import_react6.createElement)(CaptionDock, { controller }));
  try {
    ctx.slots.inject("main", () => ctx.slots.register({ name: "main", key: "interpret" }, Panel));
    ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
      name: "sidebar.panellist",
      id: "interpret",
      order: 9,
      label: () => "\u540C\u4F20"
    }, InterpretIcon));
  } catch (error) {
    failure = String(error?.message || error);
    console.error("[dsh-interpret] panel registration failed:", failure);
  }
  try {
    ctx.inject(["sidebarRight", "sidebarRightTabs"], (scope) => {
      if (dockTimeout) clearTimeout(dockTimeout);
      dockTimeout = null;
      sidebarRight = scope.sidebarRight;
      sidebarRightTabs = scope.sidebarRightTabs;
      setTimeout(() => {
        try {
          registerDock(scope);
          dockAvailable = true;
          failure = null;
        } catch (error) {
          failure = String(error?.message || error);
          console.warn("[dsh-interpret] right dock unavailable:", failure);
        }
        reportStatus();
      }, 0);
    });
  } catch (error) {
    failure = String(error?.message || error);
    console.warn("[dsh-interpret] sidebarRight injection failed:", failure);
    reportStatus();
  }
  dockTimeout = setTimeout(() => {
    dockTimeout = null;
    if (!dockAvailable && !failure) failure = "\u53F3\u4FA7\u680F\u670D\u52A1\u672A\u5C31\u7EEA\uFF083 \u79D2\u8D85\u65F6\uFF09\uFF0C\u8BF7\u5237\u65B0\u9875\u9762";
    reportStatus();
  }, 3e3);
  ctx.effect(() => () => {
    if (dockTimeout) clearTimeout(dockTimeout);
    try {
      controller.dispose();
    } catch {
    }
  }, "dsh-interpret: dispose client controller");
  reportStatus();
}
return module.exports;
}});
//# sourceMappingURL=client.js.map
