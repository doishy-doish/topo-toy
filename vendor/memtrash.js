// memtrash.js — the memory trash system for JS: ECC for memory (liveness layer).
// Zero dependencies. Browser + worker + node clean.
//
// Same shape as memtrash.hpp: a Registry that LOGS every tracked area
// (key, size, tag, site, age), a sweep() that PATCHES leaks by calling the
// registered dispose() for stale entries (GPU deleteBuffer, pool push-back,
// cache evict — the releaser), and an orphan predicate for cross-checking
// (like andra-voxel's memAudit orphans: mesh keys with no chunk).
// Explicit ownership only: entries without dispose() are REPORTED, never
// force-freed. Permanent entries (the live sim) are audited, never swept.
(function (root, factory) {
  var M = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = M;
  root.MemTrash = M.MemTrash;
  root.createMemTrash = M.createMemTrash;
  root.startShed = M.startShed;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var nextId = 1;

  function MemTrash(opts) {
    opts = opts || {};
    this.now = opts.now || function () { return Date.now(); };
    this.maxTracked = opts.maxTracked || 4096; // cap: refuse, don't sprawl
    this.recs = new Map(); // key -> {id,size,tag,site,born,touched,permanent,dispose}
    this.sweeps = 0;
    this.peak = 0;
  }

  MemTrash.prototype.track = function (key, info) {
    info = info || {};
    if (key === undefined || key === null) return false;
    var t = this.now();
    var r = this.recs.get(key);
    if (r) {
      r.size = info.size || 0; r.tag = info.tag || r.tag;
      r.site = info.site || r.site; r.touched = t;
      if (info.dispose !== undefined) r.dispose = info.dispose;
      if (info.permanent !== undefined) r.permanent = !!info.permanent;
      return true;
    }
    if (this.recs.size >= this.maxTracked) return false;
    this.recs.set(key, {
      id: nextId++, size: info.size || 0, tag: info.tag || "?",
      site: info.site || "?", born: t, touched: t,
      permanent: !!info.permanent, dispose: info.dispose || null
    });
    var b = this.bytes();
    if (b > this.peak) this.peak = b;
    return true;
  };

  MemTrash.prototype.untrack = function (key) { return this.recs.delete(key); };
  MemTrash.prototype.touch = function (key) {
    var r = this.recs.get(key);
    if (r) r.touched = this.now();
  };
  MemTrash.prototype.live = function () { return this.recs.size; };
  MemTrash.prototype.bytes = function () {
    var b = 0;
    this.recs.forEach(function (r) { b += r.size; });
    return b;
  };

  // The smarter check: learn the expected maximum (baseline) on first sight,
  // then patch AUTOMATICALLY when memory grows past the hard budget or past
  // baseline*growthFactor. sweep(0) releases everything non-permanent —
  // "starts patching anyways". Permanent entries are never patched, only counted.
  MemTrash.prototype.setBudget = function (b) {
    b = b || {};
    this.budgetBytes = b.maxBytes || 0;
    this.growthFactor = b.growthFactor || 0;
    this.growthMin = b.growthMin || 0;
    this.baseline = 0; this.wasOver = false; // re-latch on next check
  };
  MemTrash.prototype.checkBudget = function (orphan) {
    var b = this.bytes();
    if (!this.baseline && b > 0) this.baseline = b; // latch the expected max
    var hard = this.budgetBytes > 0 && b > this.budgetBytes;
    var growth = this.growthFactor > 0 && b > this.growthMin && b > this.baseline * this.growthFactor;
    var over = !!(hard || growth);
    var rep = { over: over, newlyOver: over && !this.wasOver,
      why: hard ? "over-budget" : (growth ? "growth-trip" : ""),
      released: 0, reported: 0, skipped: 0 };
    this.wasOver = over;
    if (!over) return rep;
    var s = this.sweep(0, orphan);
    rep.released = s.released; rep.reported = s.reported; rep.skipped = s.skipped;
    return rep;
  };

  // sweep(maxIdleMs, orphan): dispose stale non-permanent entries.
  // orphan(key, rec) -> true means "owner gone" (e.g. mesh key with no chunk):
  // disposed immediately regardless of age. Returns {released, reported, skipped}.
  MemTrash.prototype.sweep = function (maxIdleMs, orphan) {
    var t = this.now(), released = 0, reported = 0, skipped = 0;
    var self = this;
    Array.from(this.recs.keys()).forEach(function (key) {
      var r = self.recs.get(key);
      if (!r) return;
      if (r.permanent) { skipped++; return; }
      var isOrphan = false;
      try { isOrphan = !!(orphan && orphan(key, r)); } catch (e) { isOrphan = false; }
      if (!isOrphan && (t - r.touched) < (maxIdleMs || 0)) return;
      if (typeof r.dispose === "function") {
        try { r.dispose(key, r); } catch (e) { /* dispose must never throw the sweep */ }
        self.recs.delete(key);
        released++;
      } else {
        reported++; // logged, not freed: no owner, no patch
      }
    });
    if (released) this.sweeps++;
    return { released: released, reported: reported, skipped: skipped };
  };

  MemTrash.prototype.audit = function (extra) {
    var t = this.now();
    var out = [];
    this.recs.forEach(function (r, key) {
      out.push({ key: String(key), size: r.size, tag: r.tag, site: r.site,
        ageMs: t - r.touched, permanent: r.permanent,
        hasDispose: typeof r.dispose === "function" });
    });
    var heapMB = -1;
    try {
      if (typeof performance !== "undefined" && performance.memory &&
          performance.memory.usedJSHeapSize) {
        heapMB = +(performance.memory.usedJSHeapSize / 1048576).toFixed(1);
      }
    } catch (e) { /* non-Chrome: unknown, not zero */ }
    return { tickMs: t, live: this.live(), bytes: this.bytes(), peak: this.peak,
      sweeps: this.sweeps, heapMB: heapMB, extra: extra || null, records: out };
  };

  MemTrash.prototype.log = function (extra) { return JSON.stringify(this.audit(extra)); };

  // startShed(mt, {everyMs, maxIdleMs, orphan, onShed}): the patrol scrub.
  // Each patrol runs the age sweep AND the budget check (auto-patch on growth).
  // onShed fires only when something was patched/reported or a budget trip is
  // new — no spam while over-budget with nothing releasable left.
  // Returns a stop() function. Mirrors andra-voxel's memShed interval.
  function startShed(mt, opts) {
    opts = opts || {};
    var every = opts.everyMs || 30000;
    var maxIdle = opts.maxIdleMs == null ? 120000 : opts.maxIdleMs;
    var id = setInterval(function () {
      var rep = { released: 0, reported: 0, skipped: 0 };
      var bc = null;
      try { rep = mt.sweep(maxIdle, opts.orphan); }
      catch (e) { rep = { released: 0, reported: 0, skipped: 0, error: String(e) }; }
      try { bc = mt.checkBudget(opts.orphan); }
      catch (e) { bc = null; }
      var news = (rep.released || rep.reported) ||
        (bc && (bc.released || bc.reported || bc.newlyOver));
      if (news && typeof opts.onShed === "function") {
        try { opts.onShed({ age: rep, budget: bc }, mt.audit()); } catch (e) { /* never throw the patrol */ }
      }
    }, every);
    if (id && typeof id.unref === "function") { try { id.unref(); } catch (e) {} }
    return function stop() { clearInterval(id); };
  }

  function createMemTrash(opts) { return new MemTrash(opts); }

  return { MemTrash: MemTrash, createMemTrash: createMemTrash, startShed: startShed };
});
