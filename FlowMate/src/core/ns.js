/* FlowMate — global namespace. Every module attaches to FM.
 * No bundler: files are concatenated in order by build.py into one offline HTML file,
 * and loaded individually by tests/harness.html. */
var FM = (typeof globalThis !== 'undefined' ? globalThis : window).FM || {};
(typeof globalThis !== 'undefined' ? globalThis : window).FM = FM;
FM.version = '0.2.0';
FM.appName = 'FlowMate';
/* The project: one place for its links and its author. */
FM.project = {
  author: 'Shir Harel',
  email: 'rlshir302010@gmail.com',
  repo: 'https://github.com/rlshir302010-cpu/flowmate',
  site: 'https://rlshir302010-cpu.github.io/flowmate/',
  licence: 'MIT',
};

/* Browser storage under flowmate.*. It still reads what FlowMotion (flowmotion.*) and
 * Gatewell (gatewell.*) saved, so preferences, autosaves and panels survive the renames.
 * Every call is guarded: storage can be missing, full or blocked. */
FM.store = (function () {
  const LEGACY = ['flowmotion.', 'gatewell.'];
  const ls = () => { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (_) { return null; } };
  return {
    get(key) {
      const s = ls(); if (!s) return null;
      try {
        let v = s.getItem('flowmate.' + key);
        for (let i = 0; v == null && i < LEGACY.length; i++) v = s.getItem(LEGACY[i] + key);
        return v;
      } catch (_) { return null; }
    },
    set(key, value) { const s = ls(); if (!s) return false; try { s.setItem('flowmate.' + key, value); return true; } catch (_) { return false; } },
    remove(key) { const s = ls(); if (!s) return; try { s.removeItem('flowmate.' + key); LEGACY.forEach(p => s.removeItem(p + key)); } catch (_) { /* ignore */ } },
    getJSON(key, fallback) { try { const v = this.get(key); return v ? JSON.parse(v) : fallback; } catch (_) { return fallback; } },
    setJSON(key, v) { return this.set(key, JSON.stringify(v)); },
  };
})();
