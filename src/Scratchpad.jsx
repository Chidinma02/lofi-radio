import { useEffect, useState } from 'react';

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw !== null ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export default function Scratchpad() {
  const [notes, setNotes] = useState(() => load('nlr-scratchpad', ''));
  const [savedFlash, setSavedFlash] = useState(false);

  // Autosave the scratchpad (debounced) with a little "saved" wink.
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        localStorage.setItem('nlr-scratchpad', JSON.stringify(notes));
        setSavedFlash(true);
        setTimeout(() => setSavedFlash(false), 1200);
      } catch {
        /* noop */
      }
    }, 600);
    return () => clearTimeout(id);
  }, [notes]);

  return (
    <div className="focus-card">
      <div className="focus-head">
        <h2>📝 scratchpad</h2>
        <span className={savedFlash ? 'saved flash' : 'saved'}>
          {savedFlash ? '✓ saved' : 'autosaves'}
        </span>
      </div>
      <textarea
        className="scratch"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder={'brain dump here…\nlyrics, ideas, reminders — it all autosaves.'}
        rows={12}
        aria-label="Scratchpad notes"
      />
    </div>
  );
}
