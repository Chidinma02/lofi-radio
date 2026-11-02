import { useEffect, useMemo, useState } from 'react';

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw !== null ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
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

function dayLabel(isoDay) {
  try {
    const [y, m, d] = isoDay.split('-').map(Number);
    return new Intl.DateTimeFormat('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: 'Africa/Lagos',
    }).format(new Date(Date.UTC(y, m - 1, d, 12)));
  } catch {
    return isoDay;
  }
}

function shortDayLabel(isoDay) {
  try {
    const [y, m, d] = isoDay.split('-').map(Number);
    return new Intl.DateTimeFormat('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'Africa/Lagos',
    }).format(new Date(Date.UTC(y, m - 1, d, 12)));
  } catch {
    return isoDay;
  }
}

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const ARCHIVE_KEY = 'nlr-goals-archive';
const ARCHIVE_LIMIT = 60;

function loadArchive() {
  const raw = load(ARCHIVE_KEY, {});
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

function saveArchive(archive) {
  try {
    const days = Object.keys(archive).sort().slice(-ARCHIVE_LIMIT);
    const trimmed = {};
    for (const d of days) trimmed[d] = archive[d];
    localStorage.setItem(ARCHIVE_KEY, JSON.stringify(trimmed));
  } catch {
    /* noop */
  }
}

export default function Goals() {
  const todayId = lagosDay();
  // Today's live list + archive of past days: { 'YYYY-MM-DD': { items: [...] } }
  const [goals, setGoals] = useState(() => load('nlr-goals', { day: todayId, items: [] }));
  const [archive, setArchive] = useState(loadArchive);
  const [draft, setDraft] = useState('');
  const [viewDay, setViewDay] = useState(todayId);

  // Roll over to a fresh day: stash yesterday's list into the archive first.
  useEffect(() => {
    setGoals((prev) => {
      if (prev.day === lagosDay()) return prev;
      if (prev.day && Array.isArray(prev.items) && prev.items.length > 0) {
        setArchive((old) => {
          const next = { ...old, [prev.day]: { items: prev.items } };
          saveArchive(next);
          return next;
        });
      }
      return { day: lagosDay(), items: [] };
    });
    setViewDay(lagosDay());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('nlr-goals', JSON.stringify(goals));
    } catch {
      /* noop */
    }
    // Keep today's archive entry in sync so it survives even before rollover.
    if (goals.day === lagosDay() && goals.items.length > 0) {
      setArchive((old) => {
        if (JSON.stringify(old[goals.day]?.items) === JSON.stringify(goals.items)) return old;
        const next = { ...old, [goals.day]: { items: goals.items } };
        saveArchive(next);
        return next;
      });
    }
  }, [goals]);

  function addGoal(e) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setViewDay(lagosDay());
    setGoals((prev) => ({
      day: lagosDay(),
      items: [...prev.items, { id: uid(), text, done: false }],
    }));
    setDraft('');
  }

  function toggleGoal(id) {
    setGoals((prev) => ({
      ...prev,
      items: prev.items.map((g) => (g.id === id ? { ...g, done: !g.done } : g)),
    }));
  }

  function removeGoal(id) {
    setGoals((prev) => ({ ...prev, items: prev.items.filter((g) => g.id !== id) }));
  }

  function clearDone() {
    setGoals((prev) => ({ ...prev, items: prev.items.filter((g) => !g.done) }));
  }

  // All known days, newest first — today (live) plus archived days.
  const days = useMemo(() => {
    const set = new Set([lagosDay(), goals.day, ...Object.keys(archive)].filter(Boolean));
    return [...set].sort().reverse();
  }, [archive, goals.day]);

  const viewingToday = viewDay === lagosDay();
  const items = viewingToday
    ? goals.items
    : (archive[viewDay]?.items ?? (viewDay === goals.day ? goals.items : []));

  const done = items.filter((g) => g.done).length;
  const total = items.length;
  const goalPct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="focus-card">
      <div className="focus-head">
        <h2>✅ goals</h2>
        <span className="focus-day">{dayLabel(viewDay)}</span>
      </div>

      <div className="day-picker" role="tablist" aria-label="Goal days">
        {days.slice(0, 7).map((d) => (
          <button
            key={d}
            role="tab"
            aria-selected={viewDay === d}
            className={viewDay === d ? 'day-chip active' : 'day-chip'}
            onClick={() => setViewDay(d)}
            title={dayLabel(d)}
          >
            {d === lagosDay() ? 'today' : shortDayLabel(d)}
          </button>
        ))}
      </div>

      <div className="goal-bar" aria-hidden>
        <span style={{ width: `${goalPct}%` }} />
      </div>
      <p className="goal-count">
        {total === 0
          ? viewingToday
            ? 'fresh page — add your first goal 👇'
            : 'no goals were set this day.'
          : `${done}/${total} smashed (${goalPct}%)`}
      </p>

      {viewingToday && (
        <form className="goal-form" onSubmit={addGoal}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="e.g. finish 4 pomodoros"
            maxLength={140}
            aria-label="New goal"
          />
          <button type="submit">＋ add</button>
        </form>
      )}

      {total === 0 ? (
        <p className="hint">
          {viewingToday
            ? 'nothing here yet — your list resets fresh every day.'
            : 'nothing logged for this date.'}
        </p>
      ) : (
        <ul className="goal-list">
          {items.map((g) => (
            <li key={g.id} className={g.done ? 'goal done' : 'goal'}>
              {viewingToday ? (
                <button
                  className="goal-check"
                  onClick={() => toggleGoal(g.id)}
                  title={g.done ? 'Mark as not done' : 'Mark as done'}
                  aria-pressed={g.done}
                >
                  {g.done ? '✔' : ''}
                </button>
              ) : (
                <span className={g.done ? 'goal-check static done' : 'goal-check static'}>
                  {g.done ? '✔' : ''}
                </span>
              )}
              <span className="goal-text">{g.text}</span>
              {viewingToday && (
                <button className="goal-x" onClick={() => removeGoal(g.id)} title="Delete goal">
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {viewingToday && done > 0 && (
        <button className="ghost-btn" onClick={clearDone}>
          🧹 clear completed
        </button>
      )}
    </div>
  );
}
