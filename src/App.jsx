import { useEffect, useMemo, useRef, useState } from 'react';
import { FALLBACK_STATIONS } from './stations.js';
import { fetchDirectoryStations, getCachedDirectory, registerClick, searchDirectory, shortCountry } from './radioApi.js';
import Pomodoro from './Pomodoro.jsx';
import Goals from './Goals.jsx';
import Scratchpad from './Scratchpad.jsx';

const MODES = [
  { id: 'radio', label: '📻 Radio', tagline: 'pick a country & tune in' },
  { id: 'lofi', label: '🎧 Lofi Café', tagline: 'chill beats to relax & study to' },
];

const COUNTRY_FLAGS = {
  Nigeria: '🇳🇬',
  Ghana: '🇬🇭',
  Kenya: '🇰🇪',
  'South Africa': '🇿🇦',
  Cameroon: '🇨🇲',
  Tanzania: '🇹🇿',
  Uganda: '🇺🇬',
  Ethiopia: '🇪🇹',
  Senegal: '🇸🇳',
  Germany: '🇩🇪',
  France: '🇫🇷',
  'United Kingdom': '🇬🇧',
  UK: '🇬🇧',
  'United States': '🇺🇸',
  USA: '🇺🇸',
  'United States Of America': '🇺🇸',
  'United Kingdom Of Great Britain And Northern Ireland': '🇬🇧',
};

function countryFlag(country) {
  return COUNTRY_FLAGS[country] ?? '🌍';
}

function stationKey(s) {
  return s.stationuuid || s.url_resolved;
}

// Old installs saved per-country modes (nigeria, africa, world, …);
// those are all Radio now.
function migrateMode(id) {
  if (MODES.some((m) => m.id === id)) return id;
  if (['nigeria', 'africa', 'world', 'germany', 'france', 'uk', 'usa'].includes(id)) return 'radio';
  return 'lofi';
}

const LAST_KEY = 'nlr-last';

function loadLast() {
  try {
    const raw = localStorage.getItem(LAST_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function resolveInitialStation(last) {
  if (last?.station?.url_resolved) {
    const match = FALLBACK_STATIONS.find((s) => stationKey(s) === stationKey(last.station));
    return match ?? last.station;
  }
  const modeId = migrateMode(last?.mode);
  return FALLBACK_STATIONS.find((s) => s.category === modeId) ?? FALLBACK_STATIONS[0];
}

function lagosHour(date) {
  return Number(
    new Intl.DateTimeFormat('en-GB', {
      hour: 'numeric',
      hour12: false,
      timeZone: 'Africa/Lagos',
    }).format(date),
  );
}

function greetingFor(date) {
  const h = lagosHour(date);
  if (h >= 5 && h < 12) return 'Good morning 🌅';
  if (h >= 12 && h < 17) return 'Good afternoon ☀️';
  if (h >= 17 && h < 22) return 'Good evening 🌆';
  return 'Up late? 🌙';
}

function lagosTime(date) {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'Africa/Lagos',
  }).format(date);
}

function lagosDate(date) {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'Africa/Lagos',
  }).format(date);
}

export default function App() {
  const [lastSaved] = useState(loadLast);
  const [directory, setDirectory] = useState(FALLBACK_STATIONS);
  const [directoryLive, setDirectoryLive] = useState(false);
  const [mode, setMode] = useState(() => migrateMode(lastSaved?.mode));
  const [country, setCountry] = useState(() => lastSaved?.country ?? 'all');
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [current, setCurrent] = useState(() => resolveInitialStation(lastSaved));
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(
    () => !!(lastSaved?.wasPlaying && lastSaved?.station?.url_resolved),
  );
  const [awaitingResume, setAwaitingResume] = useState(
    () => !!(lastSaved?.wasPlaying && lastSaved?.station?.url_resolved),
  );
  const [volume, setVolume] = useState(
    typeof lastSaved?.volume === 'number' ? lastSaved.volume : 0.8,
  );
  const [error, setError] = useState('');
  const [favsOnly, setFavsOnly] = useState(false);
  const [liveKeys, setLiveKeys] = useState(() => new Set());
  const [checkedKeys, setCheckedKeys] = useState(() => new Set());
  const [verifying, setVerifying] = useState(false);
  const [hideDead, setHideDead] = useState(false);
  const [focusTab, setFocusTab] = useState(lastSaved?.focusTab ?? 'pomodoro');
  const [now, setNow] = useState(() => new Date());
  const [favorites, setFavorites] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('nlr-favorites') || '[]');
    } catch {
      return [];
    }
  });
  const audioRef = useRef(null);
  const debounceRef = useRef(null);
  const titleRef = useRef(null);
  const [titleLong, setTitleLong] = useState(false);

  // Flag long station names so the player title flows (marquee)
  // instead of stretching the card. Short names sit still.
  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    const check = () => setTitleLong(el.scrollWidth > el.clientWidth + 4);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, [current]);

  // Upgrade from the curated list to live directory data.
  // If we restored a saved station, prefer the richer live entry for it.
  // A cached snapshot (≤24h) paints instantly; fresh data swaps in behind it.
  useEffect(() => {
    const cached = getCachedDirectory();
    if (cached) {
      setDirectory(cached);
      setDirectoryLive(true);
      if (lastSaved?.station) {
        const match = cached.find((s) => stationKey(s) === stationKey(lastSaved.station));
        if (match) setCurrent(match);
      }
    }
    fetchDirectoryStations()
      .then((stations) => {
        if (stations.length > 0) {
          setDirectory(stations);
          setDirectoryLive(true);
          if (lastSaved?.station) {
            const match = stations.find((s) => stationKey(s) === stationKey(lastSaved.station));
            if (match) setCurrent(match);
          }
        }
      })
      .catch(() => {
        // Keep the curated fallback list.
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    localStorage.setItem('nlr-favorites', JSON.stringify(favorites));
  }, [favorites]);

  // Try to resume the last-played station right after refresh.
  // Browsers block audible autoplay, so this succeeds only when the tab
  // kept playback permission — otherwise we show a "tap to resume" pill
  // and resume on the first click anywhere on the page.
  const resumeAttempted = useRef(false);
  useEffect(() => {
    if (resumeAttempted.current) return;
    if (!lastSaved?.wasPlaying || !lastSaved?.station?.url_resolved) return;
    resumeAttempted.current = true;
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = typeof lastSaved.volume === 'number' ? lastSaved.volume : 0.8;
    play(lastSaved.station, { silentOnAutoplayBlock: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Resume on first interaction if autoplay was blocked.
  useEffect(() => {
    if (!awaitingResume) return;
    const resume = () => {
      if (current) play(current, { markResumed: true });
    };
    window.addEventListener('pointerdown', resume, { once: true });
    return () => window.removeEventListener('pointerdown', resume);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [awaitingResume]);

  // Live clock, ticking every second.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
    saveLast({ volume });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [volume]);

  // Debounced directory search.
  useEffect(() => {
    clearTimeout(debounceRef.current);
    const q = query.trim();
    if (!q) {
      setSearchResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        setSearchResults(await searchDirectory(q));
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 450);
    return () => clearTimeout(debounceRef.current);
  }, [query]);

  const favoriteSet = useMemo(() => new Set(favorites), [favorites]);
  const searchingActive = query.trim().length > 0;
  const modePool = useMemo(
    () => (searchingActive ? (searchResults ?? []) : directory.filter((s) => s.category === mode)),
    [searchingActive, searchResults, directory, mode],
  );
  // Radio mode narrows by country (Nigeria, Ghana, Germany, USA, …).
  // Sorted by station count so the busiest countries come first.
  const countries = useMemo(() => {
    if (mode !== 'radio') return [];
    const counts = new Map();
    for (const s of modePool) {
      const c = shortCountry(s.country) || 'Other';
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }));
  }, [mode, modePool]);
  const countryValid = country === 'all' || countries.some((c) => c.name === country);
  const pool = useMemo(
    () =>
      mode === 'radio' && countryValid && country !== 'all'
        ? modePool.filter((s) => (shortCountry(s.country) || 'Other') === country)
        : modePool,
    [mode, countryValid, country, modePool],
  );
  const favList = useMemo(
    () => pool.filter((s) => favoriteSet.has(stationKey(s))),
    [pool, favoriteSet],
  );
  const restList = useMemo(
    () => pool.filter((s) => !favoriteSet.has(stationKey(s))),
    [pool, favoriteSet],
  );
  // Hide unverified listings when the ⚡ filter is on. Hosts we haven't
  // probed yet stay hidden too — but if NOTHING verified live (e.g. total
  // network block), fall back to showing everything rather than a blank list.
  const liveFilter = (arr) => {
    if (!hideDead || liveKeys.size === 0) return arr;
    return arr.filter((s) => {
      const key = stationKey(s);
      return liveKeys.has(key) || !checkedKeys.has(key);
    });
  };
  const visFav = liveFilter(favList);
  const visRest = liveFilter(restList);
  // Visual order matches playback order: favorites first, then everything else.
  const list = favsOnly ? visFav : [...visFav, ...visRest];

  // Background liveness check: the directory lists every known stream, but
  // plenty of hosts are dead. Browsers won't expose cross-origin HEAD
  // statuses, so we use no-cors requests — ANY response (even opaque)
  // proves the host is still up.
  const poolSig = useMemo(() => pool.map(stationKey).join('|'), [pool]);
  useEffect(() => {
    let cancelled = false;
    const targets = pool.slice(0, 200);
    setLiveKeys(new Set());
    setCheckedKeys(new Set());
    if (targets.length === 0) {
      setVerifying(false);
      return undefined;
    }
    setVerifying(true);
    const alive = new Set();
    const checked = new Set();
    let completed = 0;
    const flush = (done) => {
      if (cancelled) return;
      setLiveKeys(new Set(alive));
      setCheckedKeys(new Set(checked));
      if (done) setVerifying(false);
    };
    const probeOne = async (s) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10000);
      try {
        await fetch(s.url_resolved, { method: 'HEAD', mode: 'no-cors', signal: ctrl.signal });
        alive.add(stationKey(s));
      } catch {
        /* host down or blocked — marked checked but not live */
      } finally {
        checked.add(stationKey(s));
        clearTimeout(timer);
        completed += 1;
        if (completed % 5 === 0 || completed === targets.length) flush(completed === targets.length);
      }
    };
    const worker = async () => {
      while (!cancelled && targets.length > 0) {
        const s = targets.pop();
        await probeOne(s);
      }
    };
    const lanes = Math.min(6, targets.length);
    for (let i = 0; i < lanes; i += 1) worker();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poolSig]);
  const modeInfo = MODES.find((m) => m.id === mode);

  function saveLast(patch) {
    try {
      const prev = loadLast() ?? {};
      localStorage.setItem(LAST_KEY, JSON.stringify({ ...prev, ...patch }));
    } catch {
      /* noop */
    }
  }

  function play(
    station,
    { silentOnAutoplayBlock = false, markResumed = false } = {},
  ) {
    const audio = audioRef.current;
    if (!audio) return;
    setError('');
    setCurrent(station);
    setBuffering(true);
    audio.src = station.url_resolved;
    audio.play().then(
      () => {
        if (markResumed) setAwaitingResume(false);
        saveLast({ station, mode, wasPlaying: true });
      },
      () => {
        setBuffering(false);
        setPlaying(false);
        if (silentOnAutoplayBlock) {
          // Browser blocked sound before any click — stay in "tap to resume" mode.
          setAwaitingResume(true);
          setBuffering(false);
        } else {
          setError(`Couldn't play “${station.name}”. Try another station.`);
        }
      },
    );
    registerClick(station.stationuuid);
  }

  function toggle(station) {
    if (current && stationKey(current) === stationKey(station) && playing) {
      audioRef.current?.pause();
      saveLast({ wasPlaying: false });
    } else if (current && stationKey(current) === stationKey(station) && !playing) {
      if (awaitingResume) setAwaitingResume(false);
      audioRef.current?.play().then(
        () => saveLast({ station, mode, wasPlaying: true }),
        () => {},
      );
    } else {
      if (awaitingResume) setAwaitingResume(false);
      play(station);
    }
  }

  function selectMode(next) {
    setMode(next);
    saveLast({ mode: next });
    setQuery('');
    setSearchResults(null);
    setFavsOnly(false);
    setCountry('all');
    saveLast({ country: 'all' });
    const stations = directory.filter((s) => s.category === next);
    if (stations.length === 0) return;
    if (!current || !stations.some((s) => stationKey(s) === stationKey(current))) {
      if (awaitingResume) setAwaitingResume(false);
      play(stations[0]);
    }
  }

  function selectCountry(next) {
    setCountry(next);
    saveLast({ country: next });
    setQuery('');
    setSearchResults(null);
    setFavsOnly(false);
    if (next === 'all' || searchingActive) return;
    const stations = modePool.filter((s) => (shortCountry(s.country) || 'Other') === next);
    if (stations.length === 0) return;
    if (awaitingResume) setAwaitingResume(false);
    play(stations[0]);
  }

  function step(dir) {
    if (list.length === 0) return;
    const idx = current ? list.findIndex((s) => stationKey(s) === stationKey(current)) : -1;
    const next = list[(idx + dir + list.length) % list.length];
    if (awaitingResume) setAwaitingResume(false);
    play(next);
  }

  // Shuffle stays inside the current view (current country/mode + filters),
  // so Radio never suddenly flips to Lofi and vice-versa.
  function shuffle() {
    if (list.length === 0) return;
    let next = list[Math.floor(Math.random() * list.length)];
    if (list.length > 1 && current) {
      let guard = 0;
      while (stationKey(next) === stationKey(current) && guard < 10) {
        next = list[Math.floor(Math.random() * list.length)];
        guard += 1;
      }
    }
    if (awaitingResume) setAwaitingResume(false);
    play(next);
  }

  function toggleFavorite(station) {
    const key = stationKey(station);
    setFavorites((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  function renderRow(s, num) {
    const key = stationKey(s);
    const isCurrent = current && stationKey(current) === key;
    const isFav = favoriteSet.has(key);
    const isLive = liveKeys.has(key);
    return (
      <li key={key} className={isCurrent ? 'row current' : 'row'}>
        <button className="row-main" onClick={() => toggle(s)}>
          <span className="row-num">{num}</span>
          <span className="row-state">
            {isCurrent && buffering ? '⏳' : isCurrent && playing ? '🔊' : '▶'}
          </span>
          <span className="row-text">
            <strong>
              {s.name}
              {isLive && <span className="live-dot" title="Verified live" />}
            </strong>
            <small>
              {[shortCountry(s.country), s.tags.split(',').slice(0, 2).join(' · ')]
                .filter(Boolean)
                .join(' — ')}
            </small>
          </span>
        </button>
        <button
          className={isFav ? 'heart on' : 'heart'}
          onClick={() => toggleFavorite(s)}
          title="Favorite"
        >
          {isFav ? '♥' : '♡'}
        </button>
      </li>
    );
  }

  return (
    <div className="cafe" data-mode={mode}>
      <div className="glow glow-a" />
      <div className="glow glow-b" />
      <div className="vignette" />

      <audio
        ref={audioRef}
        preload="none"
        onPlaying={() => {
          setPlaying(true);
          setBuffering(false);
        }}
        onPause={() => setPlaying(false)}
        onWaiting={() => setBuffering(true)}
        onError={() => {
          setBuffering(false);
          setPlaying(false);
          if (current) setError(`Couldn't play “${current.name}”. Try another station.`);
        }}
      />

      <header className="top">
        <p className="logo">☕ naija · lofi radio</p>
        <div className="clock">
          <span className="clock-time">{lagosTime(now)}</span>
          <span className="clock-date">
            {lagosDate(now)} · Lagos
          </span>
        </div>
        <p className="live">
          <span className={directoryLive ? 'pulse on' : 'pulse'} />
          {directoryLive ? 'live directory' : 'curated stations'}
        </p>
      </header>

      <div className="ticker" aria-hidden>
        <div className="ticker-inner">
          {[0, 1].map((n) => (
            <span key={n}>
              {mode === 'lofi'
                ? ' ✦ CHILL BEATS ✦ STUDY VIBES ✦ 24/7 LOFI ✦ STAY COZY ✦ CHILL BEATS ✦ STUDY VIBES ✦ 24/7 LOFI ✦ STAY COZY'
                : ' ✦ WORLD RADIO ✦ PICK A COUNTRY ✦ TUNE IN ✦ WORLD RADIO ✦ PICK A COUNTRY ✦ TUNE IN'}
              {' '}
            </span>
          ))}
        </div>
      </div>

      <main className="stage">
        <div className="columns">
          <div className="col-radio">
            <label className="mode-label" htmlFor="mode-select">
              now tuning
            </label>
            <div className="select-wrap">
          <select id="mode-select" value={mode} onChange={(e) => selectMode(e.target.value)}>
            {MODES.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <p className="tagline">
          {searchingActive ? 'searching the airwaves…' : `${greetingFor(now)} — ${modeInfo.tagline}`}
        </p>
        {mode === 'radio' && (
          <div className="country-row">
            <label className="country-label" htmlFor="country-select">
              🌍 country
            </label>
            <div className="select-wrap country-select">
              <select
                id="country-select"
                value={countryValid ? country : 'all'}
                onChange={(e) => selectCountry(e.target.value)}
              >
                <option value="all">📻 All countries</option>
                {countries.map(({ name, count }) => (
                  <option key={name} value={name}>
                    {countryFlag(name)} {name} ({count})
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        <section className="player-card">
          <div className={playing ? 'eq' : 'eq paused'} aria-hidden>
            {[0, 1, 2, 3, 4, 5, 6].map((i) => (
              <span key={i} />
            ))}
          </div>
          <h1 ref={titleRef} className={titleLong ? 'player-title long' : 'player-title'}>
            <span className="player-title-track" key={current ? stationKey(current) : 'none'}>
              {current ? current.name : 'Pick a station below'}
            </span>
          </h1>
          <p className="meta">
            {current
              ? [
                  shortCountry(current.country),
                  current.language,
                  current.bitrate ? `${current.bitrate}kbps` : '',
                  buffering ? 'buffering…' : playing ? 'now playing' : 'paused',
                ]
                  .filter(Boolean)
                  .join(' · ')
              : '—'}
          </p>

          <div className="transport">
            <button className="skip" onClick={() => step(-1)} title="Previous station">
              ⏮
            </button>
            <button
              className="big-play"
              onClick={() => current && toggle(current)}
              disabled={!current}
              title={playing ? 'Pause' : 'Play'}
            >
              {buffering ? '⏳' : playing ? '⏸' : '▶'}
            </button>
            <button className="skip" onClick={() => step(1)} title="Next station">
              ⏭
            </button>
            <button className="skip" onClick={shuffle} title={`Shuffle ${mode === 'lofi' ? 'lofi' : 'radio'} stations`}>
              🔀
            </button>
          </div>

          <label className="volume">
            <span>🔈</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
            />
            <span>🔊</span>
          </label>
        </section>

        <section className="stations">
          <div className="stations-head">
            <h2>
              {searchingActive
                ? `results (${pool.length})`
                : `${mode === 'lofi' ? '🎧 lofi' : '📻 radio'} stations (${pool.length})`}
            </h2>
            <div className="stations-tools">
              <button
                className={hideDead ? 'chip active' : 'chip'}
                onClick={() => setHideDead((v) => !v)}
                title={
                  verifying
                    ? 'checking which streams are live…'
                    : liveKeys.size > 0
                      ? `show only verified-live stations (${liveKeys.size} live right now)`
                      : 'verify which stations are actually live'
                }
              >
                ⚡
              </button>
              <button
                className={favsOnly ? 'chip active' : 'chip'}
                onClick={() => setFavsOnly((v) => !v)}
                title="Show favorites only"
              >
                ♥
              </button>
              <input
                className="mini-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="search 400+ stations…"
              />
              {searchingActive && (
                <button className="chip" onClick={() => setQuery('')}>
                  ✕
                </button>
              )}
            </div>
          </div>

          {searching ? (
            <p className="hint">searching the directory…</p>
          ) : list.length === 0 ? (
            <p className="hint">
              {hideDead && liveKeys.size > 0
                ? 'no verified-live stations here — tap ⚡ to show everything.'
                : favsOnly
                  ? 'no favorites here yet — tap ♥ on a station.'
                  : 'no stations found. try another search.'}
            </p>
          ) : favsOnly ? (
            <ul className="station-list">
              {visFav.map((s, i) => renderRow(s, i + 1))}
            </ul>
          ) : (
            <>
              {visFav.length > 0 && (
                <>
                  <p className="list-div">♥ favorites ({visFav.length})</p>
                  <ul className="station-list">
                    {visFav.map((s, i) => renderRow(s, i + 1))}
                  </ul>
                </>
              )}
              {visRest.length > 0 && (
                <>
                  <p className="list-div">
                    all stations ({visRest.length})
                    {verifying && <span className="verifying"> · checking what&apos;s live…</span>}
                  </p>
                  <ul className="station-list">
                    {visRest.map((s, i) => renderRow(s, visFav.length + i + 1))}
                  </ul>
                </>
              )}
            </>
          )}
        </section>

          </div>
          <aside className="col-focus">
            <div className="focus-tabs" role="tablist" aria-label="Focus zone">
              {[
                ['pomodoro', '⏲ timer'],
                ['goals', '✅ goals'],
                ['notes', '📝 notes'],
              ].map(([id, label]) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={focusTab === id}
                  className={focusTab === id ? 'ftab active' : 'ftab'}
                  onClick={() => setFocusTab(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            {focusTab === 'pomodoro' && <Pomodoro />}
            {focusTab === 'goals' && <Goals />}
            {focusTab === 'notes' && <Scratchpad />}
          </aside>
        </div>
      </main>

      <footer className="foot">streams via the community radio-browser directory</footer>

      {awaitingResume && !playing && current && (
        <button
          className="resume-pill"
          onClick={() => play(current, { markResumed: true })}
        >
          <span className="resume-dot" />
          tap to resume “{current.name}”
        </button>
      )}

      {error && (
        <div className="toast" role="alert">
          {error}
          <button onClick={() => setError('')}>✕</button>
        </div>
      )}
    </div>
  );
}
