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
var import_react4 = require("react");

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
  async start(deviceId) {
    if (this.active) return;
    const audio = {
      channelCount: 1,
      echoCancellation: false,
      noiseSuppression: true,
      autoGainControl: true
    };
    if (deviceId) audio.deviceId = { exact: deviceId };
    this.stream = await navigator.mediaDevices.getUserMedia({ audio, video: false });
    try {
      this.ctx = new AudioContext({ sampleRate: 16e3 });
    } catch {
      this.ctx = new AudioContext();
    }
    if (this.ctx.state === "suspended") await this.ctx.resume();
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.processor = this.ctx.createScriptProcessor(4096, 1, 1);
    this.processor.onaudioprocess = (event) => {
      try {
        const input = event.inputBuffer.getChannelData(0);
        const samples = this.ctx.sampleRate === 16e3 ? input : resample(input, this.ctx.sampleRate);
        const pcm = toPcm16(samples);
        let sum = 0;
        for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
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
  draft: null,
  glossary: null,
  history: null,
  historyView: null,
  models: null,
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
    this.disposed = false;
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
        this.stopPolling();
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
  }
  handleEvent(type, data) {
    if (!type) return;
    if (type === "state") {
      this.setState(data, { status: "ready" });
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
      this.segmentMap.set(data.id, data);
      const segments = [...this.segmentMap.values()].sort((a, b) => (a.seq || 0) - (b.seq || 0));
      if (segments.length > 800) {
        for (const segment of segments.slice(0, segments.length - 800)) this.segmentMap.delete(segment.id);
      }
      this.update({ segments: segments.slice(-800), status: "ready" });
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
  startPolling() {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      this.refresh();
    }, 1200);
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
    try {
      const payload = await this.request("/state");
      const map = /* @__PURE__ */ new Map();
      for (const segment of payload.segments || []) map.set(segment.id, segment);
      this.segmentMap = map;
      this.setState(payload.data, {
        status: "ready",
        segments: [...map.values()].sort((a, b) => (a.seq || 0) - (b.seq || 0)).slice(-800),
        error: payload.data?.error?.message || null,
        draft: null
      });
    } catch (error) {
      this.update({ status: "error", error: messageOf(error) });
    }
  }
  async start() {
    if (this.snapshot.busy) return;
    if (this.snapshot.state?.phase === "listening") return;
    this.update({ busy: true, error: null });
    try {
      await this.capture.start();
      const payload = await this.request("/session/start", { method: "POST", body: { title: "" } });
      this.segmentMap = /* @__PURE__ */ new Map();
      this.setState(payload.data, { segments: [], draft: null, error: null, status: "ready" });
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
      this.setState(payload.data, { status: "ready" });
    } catch (error) {
      this.update({ error: messageOf(error) });
    } finally {
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
  async prepareVad() {
    try {
      await this.request("/models/vad/prepare", { method: "POST", body: {} });
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
var import_react2 = require("react");

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

// src/client/panel.js
var PHASE_LABEL = {
  idle: "\u7A7A\u95F2",
  listening: "\u6B63\u5728\u76D1\u542C",
  stopping: "\u6B63\u5728\u6536\u5C3E",
  completed: "\u5DF2\u7ED3\u675F",
  error: "\u51FA\u9519"
};
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
  return (0, import_react2.createElement)(
    "span",
    { className: "di-chip" },
    (0, import_react2.createElement)("span", { className: "di-dot " + (props.tone || "") }),
    props.children
  );
}
function Kv(props) {
  return (0, import_react2.createElement)("div", { className: "di-kv" }, (0, import_react2.createElement)("span", null, props.label), (0, import_react2.createElement)("span", null, props.value));
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
  const pending = segment.status === "translating" || segment.status === "asr";
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
      (0, import_react2.createElement)(StatusBadge, { segment })
    ),
    (0, import_react2.createElement)("div", { className: "di-en" }, segment.en || "\u2026"),
    segment.zh ? (0, import_react2.createElement)("div", { className: "di-zh" }, segment.zh) : segment.status === "translating" ? (0, import_react2.createElement)("div", { className: "di-zh pending" }, "\u7FFB\u8BD1\u4E2D\u2026") : null,
    segment.error ? (0, import_react2.createElement)("div", { className: "di-note" }, segment.error.code + ": " + segment.error.message) : null
  );
}
function PanelView({ controller, openDock, dockAvailable }) {
  const snapshot = (0, import_react2.useSyncExternalStore)(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const { state, segments, busy, error, connection, modelProgress, elapsed, testResult, testBusy, draft, history, historyView, models } = snapshot;
  const listRef = (0, import_react2.useRef)(null);
  const stickRef = (0, import_react2.useRef)(true);
  const [showDropped, setShowDropped] = (0, import_react2.useState)(false);
  const [dismissed, setDismissed] = (0, import_react2.useState)(null);
  const [testText, setTestText] = (0, import_react2.useState)("The eigenvalue decomposition of a symmetric matrix is always possible.");
  const [settingsOpen, setSettingsOpen] = (0, import_react2.useState)(true);
  const [glossaryText, setGlossaryText] = (0, import_react2.useState)("");
  const [glossaryDirty, setGlossaryDirty] = (0, import_react2.useState)(false);
  const [brief, setBrief] = (0, import_react2.useState)("");
  const [briefDirty, setBriefDirty] = (0, import_react2.useState)(false);
  const glossary = snapshot.glossary;
  (0, import_react2.useEffect)(() => {
    if (glossaryDirty) return;
    const entries = glossary?.entries;
    if (!Array.isArray(entries)) return;
    setGlossaryText(entries.map((entry) => entry.source + " => " + entry.target).join("\n"));
  }, [glossary, glossaryDirty]);
  (0, import_react2.useEffect)(() => {
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
  (0, import_react2.useEffect)(() => {
    const el = listRef.current;
    if (!el) return;
    if (stickRef.current) el.scrollTop = el.scrollHeight;
  }, [segments.length]);
  (0, import_react2.useEffect)(() => {
    if (!state) controller.refresh();
  }, []);
  const running = state?.phase === "listening";
  const stopping = state?.phase === "stopping";
  const picked = state?.asr?.picked;
  const providerReady = picked?.preparation?.phase === "ready";
  const autoTranslate = state?.config?.autoTranslate !== false;
  const mt = state?.mt;
  const visible = segments.filter((segment) => showDropped || segment.status !== "dropped");
  const errorText = error || state?.lastError?.message || "";
  const showError = errorText && dismissed !== errorText;
  const blockedReason = !providerReady ? "\u8BED\u97F3\u6A21\u578B\u672A\u5C31\u7EEA\uFF0C\u8BF7\u5148\u5728\u53F3\u4FA7\u51C6\u5907\u6A21\u578B" : autoTranslate && !mt?.provider ? "\u6CA1\u6709\u53EF\u7528\u7684\u7FFB\u8BD1\u6A21\u578B\u8DEF\u7531" : "";
  const canStart = !busy && !running && !stopping && !blockedReason;
  const listeningTone = running ? "live" : stopping ? "warn" : "";
  const modelPercent = prepPercent(modelProgress?.preparation || picked?.preparation);
  const elapsedMs = running ? elapsed : state?.elapsedMs || 0;
  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
  };
  return (0, import_react2.createElement)(
    "div",
    { className: "dsh-interpret-root" },
    (0, import_react2.createElement)(
      "header",
      { className: "di-header" },
      (0, import_react2.createElement)("div", { className: "di-title" }, (0, import_react2.createElement)(InterpretIcon, { size: 18 }), (0, import_react2.createElement)("span", null, "\u540C\u58F0\u4F20\u8BD1")),
      (0, import_react2.createElement)(Chip, { tone: listeningTone }, running ? "\u6B63\u5728\u76D1\u542C " + fmtClock(elapsedMs) : PHASE_LABEL[state?.phase] || "\u52A0\u8F7D\u4E2D"),
      (0, import_react2.createElement)("span", { className: "di-sub" }, segments.length + " \u6BB5"),
      (0, import_react2.createElement)("span", { className: "di-spacer" }),
      running || stopping ? (0, import_react2.createElement)("button", {
        className: "di-btn danger",
        disabled: busy || stopping,
        onClick: () => controller.stop()
      }, stopping ? "\u6B63\u5728\u6536\u5C3E\u2026" : "\u505C\u6B62") : (0, import_react2.createElement)("button", {
        className: "di-btn primary",
        disabled: !canStart,
        title: blockedReason || "\u5F00\u59CB\u9EA6\u514B\u98CE\u540C\u4F20",
        onClick: () => controller.start()
      }, busy ? "\u542F\u52A8\u4E2D\u2026" : "\u5F00\u59CB\u540C\u4F20"),
      (0, import_react2.createElement)("button", {
        className: "di-btn ghost",
        disabled: busy,
        onClick: () => controller.refresh(),
        title: "\u5237\u65B0\u72B6\u6001"
      }, "\u5237\u65B0"),
      dockAvailable ? (0, import_react2.createElement)("button", {
        className: "di-btn ghost",
        onClick: () => openDock && openDock(),
        title: "\u5728\u53F3\u4FA7\u680F\u6253\u5F00\u5B9E\u65F6\u5B57\u5E55"
      }, "\u53F3\u680F\u663E\u793A") : null,
      (0, import_react2.createElement)("button", {
        className: "di-btn ghost",
        onClick: () => setSettingsOpen((value) => !value),
        title: "\u663E\u793A\u6216\u9690\u85CF\u53F3\u4FA7\u8BBE\u7F6E"
      }, settingsOpen ? "\u9690\u85CF\u8BBE\u7F6E" : "\u8BBE\u7F6E")
    ),
    showError ? (0, import_react2.createElement)(
      "div",
      { className: "di-banner" },
      (0, import_react2.createElement)("span", null, errorText),
      (0, import_react2.createElement)("span", { className: "di-spacer" }),
      (0, import_react2.createElement)("button", { className: "di-btn ghost", onClick: () => setDismissed(errorText) }, "\u5173\u95ED")
    ) : null,
    (0, import_react2.createElement)(
      "div",
      { className: "di-body" },
      (0, import_react2.createElement)(
        "main",
        { className: "di-main" },
        (0, import_react2.createElement)(
          "div",
          { className: "di-list", ref: listRef, onScroll },
          visible.length ? visible.map((segment) => (0, import_react2.createElement)(CaptionRow, { key: segment.id, segment })) : (0, import_react2.createElement)(
            "div",
            { className: "di-empty" },
            (0, import_react2.createElement)("strong", null, running ? "\u6B63\u5728\u8046\u542C\u82F1\u6587\u8BB2\u89E3\u2026" : "\u51C6\u5907\u5F00\u59CB\u5B9E\u65F6\u82F1\u4E2D\u5B57\u5E55"),
            (0, import_react2.createElement)("div", null, running ? "\u8BF4\u5B8C\u4E00\u53E5\u8BDD\u540E\uFF0C\u82F1\u6587\u539F\u53E5\u4E0E\u4E2D\u6587\u8BD1\u6587\u4F1A\u4F9D\u6B21\u51FA\u73B0\u3002" : "\u70B9\u51FB\u53F3\u4E0A\u89D2\u300C\u5F00\u59CB\u540C\u4F20\u300D\uFF0C\u5141\u8BB8\u9EA6\u514B\u98CE\u540E\u5373\u53EF\u5B9E\u65F6\u663E\u793A\u82F1\u6587\u539F\u53E5\u4E0E\u4E2D\u6587\u8BD1\u6587\u3002")
          ),
          draft?.en ? (0, import_react2.createElement)(
            "div",
            { className: "di-row di-draft" },
            (0, import_react2.createElement)("div", { className: "di-meta" }, "\u8349\u7A3F \xB7 " + (draft.track === "system" ? "\u7CFB\u7EDF\u97F3\u9891" : "\u9EA6\u514B\u98CE")),
            (0, import_react2.createElement)("div", { className: "di-en di-draft-en" }, draft.en)
          ) : null,
          (0, import_react2.createElement)("div", { style: { height: "1px" } })
        )
      ),
      settingsOpen ? (0, import_react2.createElement)(
        "aside",
        { className: "di-aside" },
        (0, import_react2.createElement)(
          "section",
          { className: "di-card" },
          (0, import_react2.createElement)("h4", null, "\u8BED\u97F3\u8BC6\u522B"),
          state?.asr?.providers?.length > 1 ? (0, import_react2.createElement)("select", {
            className: "di-select",
            value: picked?.id || "",
            onChange: (event) => controller.saveConfig({ asrProvider: event.target.value })
          }, state.asr.providers.map((provider) => (0, import_react2.createElement)("option", { key: provider.id, value: provider.id }, provider.name))) : (0, import_react2.createElement)(Kv, { label: "Provider", value: picked ? picked.name : "\u672A\u53D1\u73B0" }),
          (0, import_react2.createElement)(Kv, { label: "\u72B6\u6001", value: preparationLabel(picked?.preparation) }),
          (0, import_react2.createElement)(Kv, { label: "\u6A21\u578B\u76EE\u5F55", value: picked?.preparation?.directory || "\u2014" }),
          ["downloading", "checking", "loading"].includes(picked?.preparation?.phase) ? (0, import_react2.createElement)("div", { className: "di-actions" }, (0, import_react2.createElement)("button", { className: "di-btn", onClick: () => controller.cancelPrepare(picked?.id) }, "\u53D6\u6D88\u51C6\u5907")) : null,
          modelPercent !== null ? (0, import_react2.createElement)("div", { className: "di-progress" }, (0, import_react2.createElement)("div", { style: { width: modelPercent + "%" } })) : null,
          !providerReady ? (0, import_react2.createElement)(
            "div",
            { className: "di-actions" },
            (0, import_react2.createElement)("button", {
              className: "di-btn primary",
              disabled: busy || modelProgress?.preparation?.phase === "downloading",
              onClick: () => controller.prepare(picked?.id)
            }, modelProgress?.preparation?.phase === "downloading" ? "\u4E0B\u8F7D\u4E2D\u2026" : "\u51C6\u5907\u672C\u673A\u6A21\u578B"),
            (0, import_react2.createElement)("span", { className: "di-note" }, "\u9996\u6B21\u7EA6 239MB\uFF0C\u4EC5\u4E0B\u8F7D\u4E00\u6B21\u3002")
          ) : (0, import_react2.createElement)("div", { className: "di-note" }, "\u672C\u673A\u8BC6\u522B\uFF0C\u97F3\u9891\u4E0D\u51FA\u673A\u5668\u3002")
        ),
        (0, import_react2.createElement)(
          "section",
          { className: "di-card" },
          (0, import_react2.createElement)("h4", null, "\u964D\u566A / VAD"),
          (0, import_react2.createElement)(Kv, { label: "\u6A21\u5F0F", value: state?.config?.vadMode === "energy" ? "\u80FD\u91CF VAD" : models?.vad?.ready ? "Silero + \u80FD\u91CF\u56DE\u9000" : "\u80FD\u91CF VAD\uFF08Silero \u672A\u4E0B\u8F7D\uFF09" }),
          (0, import_react2.createElement)("select", {
            className: "di-select",
            value: state?.config?.vadMode || "auto",
            onChange: (event) => controller.saveConfig({ vadMode: event.target.value })
          }, ["auto", "silero", "energy"].map((mode) => (0, import_react2.createElement)("option", { key: mode, value: mode }, mode === "auto" ? "\u81EA\u52A8" : mode === "silero" ? "Silero" : "\u80FD\u91CF"))),
          !models?.vad?.ready ? (0, import_react2.createElement)(
            "div",
            { className: "di-actions" },
            (0, import_react2.createElement)("button", { className: "di-btn", onClick: () => controller.prepareVad() }, "\u4E0B\u8F7D Silero VAD\uFF082MB\uFF09")
          ) : (0, import_react2.createElement)("div", { className: "di-note" }, "\u672C\u673A\u8BED\u97F3\u6D3B\u52A8\u68C0\u6D4B\u5DF2\u5C31\u7EEA\u3002")
        ),
        (0, import_react2.createElement)(
          "section",
          { className: "di-card" },
          (0, import_react2.createElement)("h4", null, "\u7FFB\u8BD1"),
          (0, import_react2.createElement)(Kv, { label: "\u8DEF\u7531", value: mt?.provider || "\u672A\u9009\u62E9" }),
          (0, import_react2.createElement)(Kv, { label: "\u6A21\u578B", value: mt?.model || "\u2014" }),
          (0, import_react2.createElement)(Kv, { label: "\u6A21\u5F0F", value: autoTranslate ? "\u82F1\u8BD1\u4E2D" : "\u53EA\u8F6C\u5199" }),
          (0, import_react2.createElement)(
            "label",
            { className: "di-note", style: { display: "flex", gap: "6px", alignItems: "center", marginTop: "6px" } },
            (0, import_react2.createElement)("input", {
              type: "checkbox",
              checked: autoTranslate,
              onChange: (event) => controller.saveConfig({ autoTranslate: event.target.checked })
            }),
            "\u542F\u7528\u4E2D\u6587\u7FFB\u8BD1"
          ),
          (0, import_react2.createElement)(
            "label",
            { className: "di-note", style: { display: "flex", gap: "6px", alignItems: "center", marginTop: "4px" } },
            (0, import_react2.createElement)("input", {
              type: "checkbox",
              checked: state?.config?.systemAudio !== "off",
              onChange: (event) => controller.saveConfig({ systemAudio: event.target.checked ? "auto" : "off" })
            }),
            "\u91C7\u96C6\u7CFB\u7EDF\u97F3\u9891\uFF08\u4E0B\u6B21\u5F00\u59CB\u751F\u6548\uFF09"
          ),
          (0, import_react2.createElement)(
            "label",
            { className: "di-note", style: { display: "flex", gap: "6px", alignItems: "center", marginTop: "4px" } },
            (0, import_react2.createElement)("input", {
              type: "checkbox",
              checked: state?.config?.draftMode !== false,
              onChange: (event) => controller.saveConfig({ draftMode: event.target.checked })
            }),
            "\u6D41\u5F0F\u8349\u7A3F\uFF08\u8FB9\u8BF4\u8FB9\u51FA\u82F1\u6587\uFF09"
          ),
          (0, import_react2.createElement)("textarea", {
            style: { width: "100%", minHeight: "48px", boxSizing: "border-box", resize: "vertical", border: "1px solid var(--di-border)", borderRadius: "8px", padding: "6px 8px", marginTop: "6px", background: "var(--di-surface)", color: "var(--di-fg)", font: "inherit", fontSize: "12px" },
            value: brief,
            placeholder: "\u573A\u666F\u8BF4\u660E\uFF1A\u5982\u300C\u7EBF\u6027\u4EE3\u6570\u7814\u7A76\u751F\u8BFE\uFF0C\u542C\u4F17\u6709\u6570\u5B66\u80CC\u666F\uFF1B\u4FDD\u6301\u5B9A\u7406\u4E0E\u7B26\u53F7\u51C6\u786E\u300D",
            onChange: (event) => {
              setBrief(event.target.value);
              setBriefDirty(true);
            },
            spellCheck: false
          }),
          (0, import_react2.createElement)(
            "div",
            { className: "di-actions" },
            (0, import_react2.createElement)("button", {
              className: "di-btn",
              onClick: () => {
                controller.saveConfig({ brief }).then(() => setBriefDirty(false));
              }
            }, "\u4FDD\u5B58\u573A\u666F\u8BF4\u660E")
          ),
          (0, import_react2.createElement)(
            "div",
            { className: "di-actions" },
            (0, import_react2.createElement)("button", { className: "di-btn", disabled: busy, onClick: () => controller.refresh() }, "\u91CD\u65B0\u68C0\u6D4B\u8DEF\u7531")
          )
        ),
        (0, import_react2.createElement)(
          "section",
          { className: "di-card" },
          (0, import_react2.createElement)("h4", null, "\u7FFB\u8BD1\u81EA\u6D4B"),
          (0, import_react2.createElement)(
            "div",
            { className: "di-test" },
            (0, import_react2.createElement)("textarea", {
              value: testText,
              onChange: (event) => setTestText(event.target.value),
              spellCheck: false
            }),
            (0, import_react2.createElement)(
              "div",
              { className: "di-actions" },
              (0, import_react2.createElement)("button", {
                className: "di-btn",
                disabled: testBusy || !testText.trim(),
                onClick: () => controller.translateTest(testText)
              }, testBusy ? "\u7FFB\u8BD1\u4E2D\u2026" : "\u8BD5\u7FFB\u8BD1")
            )
          ),
          testResult ? (0, import_react2.createElement)(
            "div",
            { className: "di-result", style: { marginTop: "8px" } },
            testResult.ok ? testResult.text : "\u5931\u8D25: " + testResult.message
          ) : null
        ),
        (0, import_react2.createElement)(
          "section",
          { className: "di-card" },
          (0, import_react2.createElement)("h4", null, "\u672F\u8BED\u8868 (" + (glossary?.count ?? 0) + ")"),
          (0, import_react2.createElement)("textarea", {
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
          (0, import_react2.createElement)(
            "div",
            { className: "di-actions" },
            (0, import_react2.createElement)("button", { className: "di-btn", disabled: snapshot.glossaryBusy, onClick: saveGlossary }, snapshot.glossaryBusy ? "\u4FDD\u5B58\u4E2D\u2026" : "\u4FDD\u5B58\u672F\u8BED"),
            (0, import_react2.createElement)(
              "label",
              { className: "di-btn", style: { cursor: "pointer" } },
              "\u5BFC\u5165",
              (0, import_react2.createElement)("input", { type: "file", accept: ".csv,.tsv,.tmx,.json,text/plain", style: { display: "none" }, onChange: importGlossaryFile })
            )
          ),
          (0, import_react2.createElement)("div", { className: "di-note" }, "\u6BCF\u884C source => target\uFF1B\u5BFC\u5165\u652F\u6301 CSV/TSV/TMX/JSON\u3002")
        ),
        (0, import_react2.createElement)(
          "section",
          { className: "di-card" },
          (0, import_react2.createElement)("h4", null, "\u5BFC\u51FA"),
          (0, import_react2.createElement)(
            "div",
            { className: "di-actions" },
            (0, import_react2.createElement)("a", { className: "di-btn", href: controller.exportUrl("srt-bilingual"), download: "interpret-bilingual.srt" }, "\u53CC\u8BED SRT"),
            (0, import_react2.createElement)("a", { className: "di-btn", href: controller.exportUrl("srt-en"), download: "interpret-en.srt" }, "\u82F1\u6587 SRT"),
            (0, import_react2.createElement)("a", { className: "di-btn", href: controller.exportUrl("srt-zh"), download: "interpret-zh.srt" }, "\u4E2D\u6587 SRT"),
            (0, import_react2.createElement)("a", { className: "di-btn", href: controller.exportUrl("md"), download: "interpret.md" }, "Markdown")
          ),
          (0, import_react2.createElement)("div", { className: "di-note" }, "\u5BFC\u51FA\u5F53\u524D\u4F1A\u8BDD\u5DF2\u5B8C\u6210\u7684\u53CC\u8BED\u5B57\u5E55\u3002")
        ),
        (0, import_react2.createElement)(
          "section",
          { className: "di-card" },
          (0, import_react2.createElement)("h4", null, "\u672C\u6B21\u7EDF\u8BA1"),
          (0, import_react2.createElement)(Kv, { label: "\u5B8C\u6210\u53E5\u6570", value: String(state?.stats?.segments ?? 0) }),
          (0, import_react2.createElement)(Kv, { label: "\u5DF2\u8FC7\u6EE4", value: String(state?.stats?.dropped ?? 0) }),
          (0, import_react2.createElement)(Kv, { label: "\u56DE\u58F0\u53BB\u91CD", value: String(state?.stats?.echoDropped ?? 0) }),
          (0, import_react2.createElement)(Kv, { label: "\u9519\u8BEF", value: String(state?.stats?.errors ?? 0) }),
          (0, import_react2.createElement)(Kv, { label: "ASR \u5E73\u5747", value: state?.stats?.avgAsrMs ? state.stats.avgAsrMs + "ms" : "\u2014" }),
          (0, import_react2.createElement)(Kv, { label: "\u7FFB\u8BD1\u5E73\u5747", value: state?.stats?.avgMtMs ? state.stats.avgMtMs + "ms" : "\u2014" }),
          (0, import_react2.createElement)(Kv, { label: "\u9996\u5B57\u5E73\u5747", value: state?.stats?.avgFirstTokenMs ? state.stats.avgFirstTokenMs + "ms" : "\u2014" }),
          (0, import_react2.createElement)(Kv, { label: "\u672F\u8BED\u7EA0\u6B63", value: String(state?.stats?.termRepairs ?? 0) }),
          (0, import_react2.createElement)(Kv, { label: "\u8D28\u68C0\u4FEE\u6B63", value: String(state?.stats?.qaRepairs ?? 0) }),
          (0, import_react2.createElement)(
            "label",
            { className: "di-note", style: { display: "flex", gap: "6px", alignItems: "center", marginTop: "8px" } },
            (0, import_react2.createElement)("input", {
              type: "checkbox",
              checked: showDropped,
              onChange: (event) => setShowDropped(event.target.checked)
            }),
            "\u663E\u793A\u5DF2\u8FC7\u6EE4\u7247\u6BB5"
          )
        ),
        (0, import_react2.createElement)(
          "section",
          { className: "di-card" },
          (0, import_react2.createElement)("h4", null, "\u5386\u53F2\u4F1A\u8BDD"),
          (0, import_react2.createElement)(
            "div",
            { className: "di-actions" },
            (0, import_react2.createElement)("button", { className: "di-btn", onClick: () => controller.loadSessions() }, "\u5237\u65B0\u5386\u53F2")
          ),
          !history?.length ? (0, import_react2.createElement)("div", { className: "di-note" }, "\u8FD8\u6CA1\u6709\u5DF2\u4FDD\u5B58\u7684\u4F1A\u8BDD\u3002") : history.slice(0, 8).map((item) => (0, import_react2.createElement)(
            "div",
            { className: "di-history-item", key: item.id },
            (0, import_react2.createElement)("div", { className: "di-history-title" }, item.title),
            (0, import_react2.createElement)("div", { className: "di-note" }, (item.startedAt ? new Date(item.startedAt).toLocaleString() : item.id) + " \xB7 " + item.segments + " \u53E5"),
            (0, import_react2.createElement)(
              "div",
              { className: "di-actions" },
              (0, import_react2.createElement)("button", { className: "di-btn", onClick: () => controller.openSession(item.id) }, "\u67E5\u770B"),
              (0, import_react2.createElement)("a", { className: "di-btn", href: controller.exportUrl("srt-bilingual", item.id), download: "interpret-" + item.id + ".srt" }, "\u5BFC\u51FA"),
              (0, import_react2.createElement)("button", { className: "di-btn danger", onClick: () => {
                if (window.confirm("\u5220\u9664\u4F1A\u8BDD\u300C" + item.title + "\u300D\uFF1F\u6B64\u64CD\u4F5C\u4E0D\u53EF\u6062\u590D\u3002")) controller.deleteSession(item.id);
              } }, "\u5220\u9664")
            )
          ))
        ),
        (0, import_react2.createElement)(
          "section",
          { className: "di-card" },
          (0, import_react2.createElement)("h4", null, "\u8FD0\u884C\u4FE1\u606F\u4E0E\u8BCA\u65AD"),
          (0, import_react2.createElement)(Kv, { label: "\u9636\u6BB5", value: PHASE_LABEL[state?.phase] || state?.phase || "\u2014" }),
          (0, import_react2.createElement)(Kv, { label: "\u8FDE\u63A5", value: connection === "open" ? "SSE \u5B9E\u65F6" : "\u8F6E\u8BE2\u515C\u5E95" }),
          (0, import_react2.createElement)(Kv, { label: "\u97F3\u8F68", value: [state?.tracks?.mic ? "\u9EA6\u514B\u98CE" : null, state?.tracks?.system ? "\u7CFB\u7EDF\u97F3\u9891" : null].filter(Boolean).join(" + ") || "\u672A\u91C7\u96C6" }),
          (0, import_react2.createElement)(Kv, { label: "ASR", value: picked?.id || "\u2014" }),
          (0, import_react2.createElement)(Kv, { label: "\u7FFB\u8BD1", value: mt ? mt.provider + " / " + mt.model : "\u672A\u9009\u62E9" }),
          (0, import_react2.createElement)(Kv, { label: "\u505C\u6B62\u539F\u56E0", value: state?.stopReason || "\u2014" }),
          (0, import_react2.createElement)(Kv, { label: "\u7A7A\u95F2", value: state?.idleMs ? Math.round(state.idleMs / 1e3) + "s" : "\u2014" }),
          (0, import_react2.createElement)(Kv, { label: "\u6570\u636E\u76EE\u5F55", value: state?.config?.dataDir || "\u2014" }),
          (0, import_react2.createElement)(Kv, { label: "VAD \u9608\u503C", value: String(state?.config?.vadThreshold ?? "\u2014") }),
          (0, import_react2.createElement)("div", { className: "di-note" }, "\u97F3\u9891\u4EC5\u5728\u672C\u673A\u8BC6\u522B\uFF1B\u53EA\u6709\u8BC6\u522B\u6587\u672C\u4F1A\u53D1\u9001\u5230\u4F60\u914D\u7F6E\u7684 DSH \u6A21\u578B\u8DEF\u7531\u3002")
        )
      ) : null
    ),
    (0, import_react2.createElement)(
      "footer",
      { className: "di-footer" },
      (0, import_react2.createElement)("span", null, connection === "open" ? "\u5B9E\u65F6\u8FDE\u63A5\u6B63\u5E38" : "\u8FDE\u63A5\u4E2D\u65AD\uFF0C\u6B63\u5728\u91CD\u8FDE\u2026"),
      (0, import_react2.createElement)("span", { className: "di-spacer" }),
      (0, import_react2.createElement)("span", null, "\u4F1A\u8BDD " + (state?.sessionId || "\u2014")),
      (0, import_react2.createElement)("span", null, "\u7528\u65F6 " + fmtClock(elapsedMs))
    ),
    historyView ? (0, import_react2.createElement)(
      "div",
      { className: "di-modal-backdrop" },
      (0, import_react2.createElement)(
        "div",
        { className: "di-modal" },
        (0, import_react2.createElement)(
          "div",
          { className: "di-modal-head" },
          (0, import_react2.createElement)("strong", null, historyView.title || historyView.id),
          (0, import_react2.createElement)("span", { className: "di-spacer" }),
          (0, import_react2.createElement)("button", { className: "di-btn", onClick: () => controller.closeSession() }, "\u5173\u95ED")
        ),
        (0, import_react2.createElement)(
          "div",
          { className: "di-modal-list" },
          (historyView.segments || []).filter((segment) => segment.status !== "dropped").map((segment) => (0, import_react2.createElement)(CaptionRow, { key: segment.id, segment }))
        ),
        (0, import_react2.createElement)(
          "div",
          { className: "di-footer" },
          (0, import_react2.createElement)("span", null, (historyView.segments || []).length + " \u6BB5"),
          (0, import_react2.createElement)("span", { className: "di-spacer" }),
          (0, import_react2.createElement)("a", { className: "di-btn", href: controller.exportUrl("srt-bilingual", historyView.id), download: "interpret-" + historyView.id + ".srt" }, "\u53CC\u8BED SRT"),
          (0, import_react2.createElement)("a", { className: "di-btn", href: controller.exportUrl("md", historyView.id), download: "interpret-" + historyView.id + ".md" }, "Markdown")
        )
      )
    ) : null
  );
}

// src/client/dock.js
var import_react3 = require("react");
function CaptionDock({ controller }) {
  const snapshot = (0, import_react3.useSyncExternalStore)(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const { state, segments, busy, connection, error, draft } = snapshot;
  const listRef = (0, import_react3.useRef)(null);
  const stickRef = (0, import_react3.useRef)(true);
  const running = state?.phase === "listening";
  const stopping = state?.phase === "stopping";
  const picked = state?.asr?.picked;
  const providerReady = picked?.preparation?.phase === "ready";
  const mt = state?.mt;
  const autoTranslate = state?.config?.autoTranslate !== false;
  const canStart = !busy && !running && !stopping && providerReady && (!autoTranslate || Boolean(mt?.provider));
  const visible = segments.filter((segment) => segment.status !== "dropped").slice(-60);
  const elapsed = running ? snapshot.elapsed : state?.elapsedMs || 0;
  (0, import_react3.useEffect)(() => {
    const el = listRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [segments.length]);
  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };
  return (0, import_react3.createElement)(
    "div",
    { className: "dsh-interpret-root di-dock" },
    (0, import_react3.createElement)(
      "div",
      { className: "di-dock-head" },
      (0, import_react3.createElement)("span", { className: "di-title" }, "\u540C\u4F20\u5B57\u5E55"),
      (0, import_react3.createElement)("span", { className: "di-chip" }, (0, import_react3.createElement)("span", { className: "di-dot " + (running ? "live" : "") }), running ? fmtClock(elapsed) : state?.phase === "completed" ? "\u5DF2\u7ED3\u675F" : "\u7A7A\u95F2"),
      (0, import_react3.createElement)("span", { className: "di-spacer" }),
      running || stopping ? (0, import_react3.createElement)("button", { className: "di-btn danger", disabled: busy || stopping, onClick: () => controller.stop() }, stopping ? "\u6536\u5C3E\u4E2D" : "\u505C\u6B62") : (0, import_react3.createElement)("button", { className: "di-btn primary", disabled: !canStart, onClick: () => controller.start(), title: !providerReady ? "\u5148\u5728\u4E3B\u9762\u677F\u51C6\u5907\u6A21\u578B" : !mt?.provider && autoTranslate ? "\u6CA1\u6709\u7FFB\u8BD1\u8DEF\u7531" : "\u5F00\u59CB\u540C\u4F20" }, busy ? "\u542F\u52A8\u4E2D" : "\u5F00\u59CB")
    ),
    error ? (0, import_react3.createElement)("div", { className: "di-banner" }, (0, import_react3.createElement)("span", null, error)) : null,
    (0, import_react3.createElement)(
      "div",
      { className: "di-list di-dock-list", ref: listRef, onScroll },
      visible.length ? visible.map((segment) => (0, import_react3.createElement)(CaptionRow, { key: segment.id, segment })) : (0, import_react3.createElement)(
        "div",
        { className: "di-empty" },
        (0, import_react3.createElement)("strong", null, running ? "\u6B63\u5728\u8046\u542C\u2026" : "\u7B49\u5F85\u5F00\u59CB"),
        (0, import_react3.createElement)("div", null, running ? "\u82F1\u4E2D\u5B57\u5E55\u4F1A\u51FA\u73B0\u5728\u8FD9\u91CC\u3002" : "\u53EF\u5728\u4E3B\u9762\u677F\u5F00\u59CB\uFF0C\u6216\u70B9\u8FD9\u91CC\u76F4\u63A5\u5F00\u59CB\u3002")
      ),
      draft?.en ? (0, import_react3.createElement)("div", { className: "di-row di-draft" }, (0, import_react3.createElement)("div", { className: "di-meta" }, "\u8349\u7A3F"), (0, import_react3.createElement)("div", { className: "di-en" }, draft.en)) : null,
      (0, import_react3.createElement)("div", { style: { height: "1px" } })
    ),
    (0, import_react3.createElement)(
      "div",
      { className: "di-footer" },
      (0, import_react3.createElement)("span", null, connection === "open" ? "\u5B9E\u65F6" : "\u8F6E\u8BE2"),
      (0, import_react3.createElement)("span", { className: "di-spacer" }),
      (0, import_react3.createElement)("span", null, state?.stats?.segments ? state.stats.segments + " \u53E5" : "\u2014"),
      (0, import_react3.createElement)("span", null, state?.tracks?.system ? "\u53CC\u97F3\u8F68" : "\u9EA6\u514B\u98CE")
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
.di-draft { opacity: .66; border-bottom-style: dotted; }
.di-draft .di-meta { color: var(--di-accent); }
.di-draft-en { font-style: italic; }
.di-history-item { border-top: 1px dashed var(--di-border); padding: 7px 0 3px; margin-top: 6px; }
.di-history-title { font-size: 12px; font-weight: 600; word-break: break-word; }
.di-modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.45); display: flex; align-items: center; justify-content: center; z-index: 60; padding: 24px; }
.di-modal { width: min(860px, 92vw); height: min(680px, 86vh); background: var(--di-surface); color: var(--di-fg); border: 1px solid var(--di-border); border-radius: 12px; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 18px 60px rgba(0,0,0,.35); }
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
function apply(ctx) {
  ensureStyles();
  const controller = new Controller();
  controller.connect();
  let dockAvailable = false;
  let sidebarRight = null;
  let failure = null;
  const reportClient = () => {
    fetch("/interpret/api/client-ready", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dockAvailable,
        failure,
        hasSidebarRight: Boolean(sidebarRight)
      })
    }).catch(() => {
    });
  };
  const openDock = () => {
    try {
      if (!sidebarRight) throw new Error("\u5F53\u524D DSH \u672A\u63D0\u4F9B\u53F3\u4FA7\u680F");
      sidebarRight.openTab(DOCK_KIND);
    } catch (error) {
      controller.update({ error: "\u53F3\u680F\u5B57\u5E55\u6253\u5F00\u5931\u8D25\uFF1A" + String(error?.message || error) });
    }
  };
  const Panel = () => (0, import_react4.createElement)(PanelView, { controller, openDock, dockAvailable });
  ctx.inject(["sidebarRight", "sidebarRightTabs"], (scope) => {
    sidebarRight = scope.sidebarRight;
    try {
      scope.effect(() => scope.sidebarRightTabs.register({
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
      }), "dsh-interpret: dock type");
      scope.slots.inject("sidebar.right.pane.tab", () => scope.slots.register({
        name: "sidebar.right.pane.tab",
        key: DOCK_ID
      }, () => (0, import_react4.createElement)(CaptionDock, { controller })));
      dockAvailable = true;
      failure = null;
    } catch (error) {
      failure = String(error?.message || error);
      console.warn("[dsh-interpret] right dock unavailable:", failure);
    }
    reportClient();
  });
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
  ctx.effect(() => () => controller.dispose(), "dsh-interpret: dispose client controller");
  reportClient();
}
return module.exports;
}});
//# sourceMappingURL=client.js.map
