import { useEffect, useRef, useState } from 'react';

const DEFAULT_SETTINGS = { work: 25, short: 5, long: 15, cycle: 4 };
const PHASE_META = {
  work: { label: 'focus time', emoji: '🍅' },
  short: { label: 'short break', emoji: '☕' },
  long: { label: 'long break', emoji: '🌴' },
};

function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem('nlr-pomo-settings') || '{}') };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function lagosDay(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Lagos',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function loadDoneToday() {
  try {
    const saved = JSON.parse(localStorage.getItem('nlr-pomo-day') || 'null');
    return saved && saved.day === lagosDay() ? saved.done : 0;
  } catch {
    return 0;
  }
}

/** Snapshot of an in-progress phase so a refresh can resume it. */
const STATE_KEY = 'nlr-pomo-state';

function loadSnapshot() {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || typeof s.endsAt !== 'number' || !PHASE_META[s.phase]) return null;
    return s;
  } catch {
    return null;
  }
}

function saveSnapshot(s) {
  try {
    if (!s) localStorage.removeItem(STATE_KEY);
    else localStorage.setItem(STATE_KEY, JSON.stringify(s));
  } catch {
    /* noop */
  }
}

function fmt(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Append a finished phase to the persistent session history. */
const HISTORY_KEY = 'nlr-pomo-history';
const HISTORY_LIMIT = 200;

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function logSession(entry) {
  try {
    const arr = loadHistory();
    arr.unshift({ id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, ...entry });
    localStorage.setItem(HISTORY_KEY, JSON.stringify(arr.slice(0, HISTORY_LIMIT)));
  } catch {
    /* noop */
  }
  return loadHistory();
}

function fmtClock(ts) {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Africa/Lagos',
    }).format(new Date(ts));
  } catch {
    return '';
  }
}

function fmtDay(ts) {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'Africa/Lagos',
    }).format(new Date(ts));
  } catch {
    return '';
  }
}

/** Alert chime synthesized with Web Audio — no audio files needed. */
function useChime() {
  const ctxRef = useRef(null);
  const lastRef = useRef(0);

  function ensure() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!ctxRef.current) ctxRef.current = new AC();
    if (ctxRef.current.state === 'suspended') ctxRef.current.resume();
    return ctxRef.current;
  }

  function tone(ctx, freq, when, dur, vol = 0.22) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(vol, when + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(when);
    osc.stop(when + dur + 0.05);
  }

  function chime(kind) {
    // Guard against double-firing (e.g. StrictMode dev double-effects).
    if (Date.now() - lastRef.current < 2000) return;
    lastRef.current = Date.now();
    const ctx = ensure();
    if (!ctx) return;
    const t = ctx.currentTime + 0.05;
    const notes =
      kind === 'break' ? [523.25, 659.25, 783.99, 1046.5] : [783.99, 659.25, 587.33, 523.25];
    notes.forEach((f, i) => {
      tone(ctx, f, t + i * 0.24, 0.9);
      tone(ctx, f * 2, t + i * 0.24, 0.6, 0.07);
    });
    if (navigator.vibrate) {
      try {
        navigator.vibrate([120, 60, 120]);
      } catch {
        /* noop */
      }
    }
  }

  return { ensureCtx: ensure, chime };
}

export default function Pomodoro() {
  const [settings, setSettings] = useState(loadSettings);
  const [snapshot] = useState(loadSnapshot);
  // If a phase was mid-flight on refresh, resume it from the wall clock —
  // elapsed = seconds since endsAt minus remaining, so the timer stays accurate.
  const restored = (() => {
    if (!snapshot) return null;
    const remaining = Math.round((snapshot.endsAt - Date.now()) / 1000);
    if (remaining <= 0) return null;
    return {
      phase: snapshot.phase,
      left: Math.min(remaining, snapshot.total),
      total: snapshot.total,
      cycle: snapshot.cycle ?? 0,
      running: snapshot.running,
    };
  })();
  const [phase, setPhase] = useState(restored?.phase ?? 'work');
  const [left, setLeft] = useState(() =>
    restored ? restored.left : loadSettings().work * 60,
  );
  const [running, setRunning] = useState(() => !!restored?.running);
  const [cycle, setCycle] = useState(restored?.cycle ?? 0);
  const [doneToday, setDoneToday] = useState(loadDoneToday);
  const [history, setHistory] = useState(loadHistory);
  const [showHistory, setShowHistory] = useState(false);
  const { ensureCtx, chime } = useChime();

  // Fresh mirror for the ticking effect so it never goes stale.
  const live = useRef({});
  live.current = { phase, settings, cycle, doneToday, left };

  // Persist a snapshot (phase + wall-clock deadline) every second while
  // running, so a refresh resumes mid-phase instead of restarting.
  useEffect(() => {
    if (!running) return;
    saveSnapshot({
      phase,
      endsAt: Date.now() + left * 1000,
      total: settings[phase] * 60,
      cycle,
      running: true,
    });
  }, [running, phase, left, settings, cycle]);

  function stopAndClear() {
    setRunning(false);
    saveSnapshot(null);
  }

  function persistDone(done) {
    try {
      localStorage.setItem('nlr-pomo-day', JSON.stringify({ day: lagosDay(), done }));
    } catch {
      /* noop */
    }
  }

  function advance() {
    const s = live.current;
    if (s.phase === 'work') {
      const completed = s.cycle + 1;
      const nd = s.doneToday + 1;
      setCycle(completed % s.settings.cycle);
      setDoneToday(nd);
      persistDone(nd);
      const next = completed % s.settings.cycle === 0 ? 'long' : 'short';
      setPhase(next);
      setLeft(s.settings[next] * 60);
      // Next phase starts paused after an auto-advance — snapshot it paused
      // so a refresh keeps the phase instead of resetting to work.
      saveSnapshot({
        phase: next,
        endsAt: Date.now() + s.settings[next] * 60 * 1000,
        total: s.settings[next] * 60,
        cycle: completed % s.settings.cycle,
        running: false,
      });
      setRunning(false);
    } else {
      setPhase('work');
      setLeft(s.settings.work * 60);
      saveSnapshot({
        phase: 'work',
        endsAt: Date.now() + s.settings.work * 60 * 1000,
        total: s.settings.work * 60,
        cycle: s.cycle,
        running: false,
      });
      setRunning(false);
    }
  }

  function finish() {
    const s = live.current;
    chime(s.phase === 'work' ? 'break' : 'work');
    saveSnapshot(null);
    // Log the completed phase before advancing to the next one.
    setHistory(
      logSession({
        phase: s.phase,
        minutes: Math.max(1, Math.round(s.settings[s.phase])),
        endedAt: Date.now(),
      }),
    );
    advance();
  }

  // Countdown driver. Auto-advances (and chimes) when a phase ends.
  useEffect(() => {
    if (!running) return;
    if (left <= 0) {
      finish();
      return;
    }
    const id = setTimeout(() => setLeft((l) => l - 1), 1000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, left]);

  // Live tab title while the timer runs.
  useEffect(() => {
    if (running) {
      document.title = `${fmt(left)} ${PHASE_META[phase].emoji} ${PHASE_META[phase].label} — Naija Lofi Radio`;
    } else {
      document.title = 'Naija Lofi Radio';
    }
    return () => {
      document.title = 'Naija Lofi Radio';
    };
  }, [running, left, phase]);

  function start() {
    ensureCtx(); // unlock audio on the user gesture so the chime can play later
    if (left <= 0) setLeft(settings[phase] * 60);
    setRunning(true);
  }

  function pause() {
    setRunning(false);
    // Keep a paused snapshot so refresh restores the exact remaining time.
    const s = live.current;
    saveSnapshot({
      phase: s.phase,
      endsAt: Date.now() + s.left * 1000,
      total: s.settings[s.phase] * 60,
      cycle: s.cycle,
      running: false,
    });
  }

  function switchPhase(next) {
    setPhase(next);
    setLeft(settings[next] * 60);
    stopAndClear();
  }

  function skip() {
    ensureCtx();
    advance();
  }

  function reset() {
    stopAndClear();
    setLeft(settings[phase] * 60);
  }

  function updateSetting(key, raw) {
    const v = Math.min(180, Math.max(1, Math.round(Number(raw) || 1)));
    setSettings((prev) => {
      const next = { ...prev, [key]: v };
      try {
        localStorage.setItem('nlr-pomo-settings', JSON.stringify(next));
      } catch {
        /* noop */
      }
      return next;
    });
    if (!running && phase === key) setLeft(v * 60);
  }

  const total = settings[phase] * 60;
  const pct = total > 0 ? Math.min(100, ((total - left) / total) * 100) : 0;

  const todayId = lagosDay();
  const todaySessions = history.filter((h) => lagosDay(new Date(h.endedAt)) === todayId);
  const focusMinutesToday = todaySessions
    .filter((h) => h.phase === 'work')
    .reduce((sum, h) => sum + (h.minutes || 0), 0);
  const focusCountToday = todaySessions.filter((h) => h.phase === 'work').length;

  function clearHistory() {
    try {
      localStorage.removeItem(HISTORY_KEY);
    } catch {
      /* noop */
    }
    setHistory([]);
  }

  return (
    <section className="pomo-card" aria-label="Pomodoro timer">
      <div className="pomo-head">
        <h2>⏲ pomodoro</h2>
        <span className="pomo-today" title="Focus sessions completed today">
          {doneToday} 🍅 today
        </span>
      </div>

      <div className="pomo-tabs" role="tablist" aria-label="Timer phase">
        {Object.keys(PHASE_META).map((p) => (
          <button
            key={p}
            role="tab"
            aria-selected={phase === p}
            className={phase === p ? 'ptab active' : 'ptab'}
            onClick={() => switchPhase(p)}
          >
            {PHASE_META[p].emoji} {p}
          </button>
        ))}
      </div>

      <p className="pomo-phase">{PHASE_META[phase].label}</p>
      <p className="pomo-time" aria-live="off">
        {fmt(left)}
      </p>
      <div className="pomo-bar" aria-hidden>
        <span style={{ width: `${pct}%` }} />
      </div>
      <div className="pomo-dots" title="Sessions in this cycle" aria-hidden>
        {Array.from({ length: settings.cycle }).map((_, i) => (
          <span key={i} className={i < cycle ? 'pdot fill' : 'pdot'} />
        ))}
      </div>

      <div className="pomo-controls">
        <button className="pomo-btn primary" onClick={running ? pause : start}>
          {running ? '⏸ pause' : '▶ start'}
        </button>
        <button className="pomo-btn" onClick={skip} title="Skip to next phase">
          ⏭ skip
        </button>
        <button className="pomo-btn" onClick={reset} title="Reset current phase">
          ↺ reset
        </button>
      </div>

      <div className="pomo-settings">
        {[
          ['work', 'focus'],
          ['short', 'short'],
          ['long', 'long'],
        ].map(([key, label]) => (
          <label key={key}>
            {label}
            <input
              type="number"
              min="1"
              max="180"
              value={settings[key]}
              onChange={(e) => updateSetting(key, e.target.value)}
              aria-label={`${label} length in minutes`}
            />
          </label>
        ))}
      </div>

      <button
        className={showHistory ? 'history-toggle open' : 'history-toggle'}
        onClick={() => setShowHistory((v) => !v)}
        aria-expanded={showHistory}
      >
        {showHistory ? '▾ hide pomodoro history' : '▸ pomodoro history'}
        <span className="history-count">
          {focusCountToday} 🍅 · {focusMinutesToday}m today
        </span>
      </button>

      {showHistory && (
        <div className="history">
          {history.length === 0 ? (
            <p className="hint">no sessions yet — finish a focus or break to log it here.</p>
          ) : (
            <>
              <ul className="history-list">
                {history.slice(0, 30).map((h) => (
                  <li key={h.id} className={`hrow ${h.phase}`}>
                    <span className="hrow-emoji">
                      {h.phase === 'work' ? '🍅' : h.phase === 'short' ? '☕' : '🌴'}
                    </span>
                    <span className="hrow-text">
                      <strong>
                        {h.phase === 'work' ? 'focus' : h.phase === 'short' ? 'short break' : 'long break'}
                        {' · '}
                        {h.minutes}m
                      </strong>
                      <small>
                        {fmtDay(h.endedAt)} · {fmtClock(h.endedAt)}
                      </small>
                    </span>
                  </li>
                ))}
              </ul>
              {history.length > 30 && (
                <p className="hint">showing latest 30 of {history.length}</p>
              )}
              <button className="ghost-btn" onClick={clearHistory}>
                🧹 clear history
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
