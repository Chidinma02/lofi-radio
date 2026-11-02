// Tiny client for the free, community-run Radio Browser directory.
// Docs: https://www.radio-browser.info/
const SERVERS = [
  'https://de1.api.radio-browser.info',
  'https://de2.api.radio-browser.info',
  'https://nl1.api.radio-browser.info',
];

async function getJson(path) {
  let lastError;
  for (const base of SERVERS) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(`${base}${path}`, {
        headers: { 'User-Agent': 'NaijaLofiRadio/1.0' },
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError ?? new Error('All directory servers unreachable');
}

/** Plain <audio> tags can't play HLS (.m3u8) playlists, so drop those. */
export function isDirectPlayable(station) {
  const url = station?.url_resolved ?? '';
  if (!url) return false;
  if (station.hls === 1) return false;
  if (url.includes('.m3u8')) return false;
  return true;
}

const NIGERIA_RE = /(nigeria|naija|lagos|afrobeats|afropop|wazobia|yoruba|igbo|hausa|pidgin|kool|brila)/;

// Non-Nigerian African countries get their own category so the app can
// offer a data-driven country picker (Nigeria, Ghana, …).
const AFRICAN_COUNTRIES = new Set([
  'Ghana', 'Kenya', 'South Africa', 'Cameroon', 'Tanzania', 'Uganda', 'Rwanda',
  'Ethiopia', 'Senegal', 'Ivory Coast', "Côte d'Ivoire", 'Mali', 'Guinea',
  'Guinea-Bissau', 'Sierra Leone', 'Liberia', 'Gambia', 'Togo', 'Benin', 'Niger',
  'Burkina Faso', 'Chad', 'Congo', 'Democratic Republic of the Congo', 'Gabon',
  'Angola', 'Zambia', 'Zimbabwe', 'Botswana', 'Namibia', 'Malawi', 'Mozambique',
  'Somalia', 'Djibouti', 'Sudan', 'South Sudan', 'Egypt', 'Morocco', 'Algeria',
  'Tunisia', 'Libya', 'Mauritania', 'Mauritius', 'Seychelles', 'Cape Verde',
  'Comoros', 'Burundi', 'Eritrea', 'Lesotho', 'Eswatini', 'Central African Republic',
  'Equatorial Guinea', 'Sao Tome and Principe',
]);

// Western countries each get their own category so they can be
// separate tabs (Germany, France, UK, USA).
const WORLD_CATEGORIES = {
  Germany: 'germany',
  France: 'france',
  'United Kingdom': 'uk',
  UK: 'uk',
  'United States': 'usa',
  USA: 'usa',
};

/** Strict lofi check: lofi/chillhop must lead the tags or the name.
 * Mega-mixes that merely mention "lo-fi" among 20+ tags (lounge,
 * ambient, house, …) don't qualify — those belong in Radio. */
export function isLofiStation(station) {
  const tags = (station.tags ?? '').toLowerCase();
  const name = (station.name ?? '').toLowerCase();
  // News brands with a lofi side-stream (e.g. "France Info Lofi")
  // belong in Radio, not Lofi.
  if (/france\s*info/i.test(name)) return false;
  // Tags must LEAD with lofi — a "lo-fi" buried 5th in a 20-tag
  // mega-mix (lounge, ambient, house…) doesn't count.
  if (/^(lo-?fi( hip-hop)?|chillhop|jazz beats)\b/.test(tags.trim())) return true;
  // Name counts only if it's a real lofi name, not a comma-stuffed
  // genre list ("IBIZA CHILLOUT LOUNGE - AMBIENT, …, LO-FI, …").
  const commas = (station.name ?? '').split(',').length - 1;
  if (commas >= 3) return false;
  if (/(^|\[|\(|\s)(lo-?fi|chillhop)(\s|#|$|:|\]|\))/.test(name)) return true;
  return false;
}

export function categorize(station) {
  // Lofi first: a true lofi stream stays lofi no matter which
  // country hosts it. Everything else with a real country (or
  // Naija markers in its name/tags) is radio — the app's country
  // picker (inside Radio mode) splits it per country.
  if (isLofiStation(station)) return 'lofi';
  if (station.country === 'Nigeria' || station.countrycode === 'NG') return 'radio';
  if (AFRICAN_COUNTRIES.has(station.country)) return 'radio';
  if (WORLD_CATEGORIES[station.country]) return 'radio';
  const hay = `${station.name ?? ''} ${station.tags ?? ''}`.toLowerCase();
  if (NIGERIA_RE.test(hay)) return 'radio';
  // Any other station with a known country is still a radio station.
  if (station.country) return 'radio';
  return 'other';
}

/** Directory country names are verbose — shorten the worst offenders. */
export function shortCountry(country) {
  const c = (country ?? '').trim();
  if (/united states/i.test(c)) return 'USA';
  if (/united kingdom|great britain/i.test(c)) return 'UK';
  return c;
}

export function normalize(station) {
  return {
    stationuuid: station.stationuuid,
    name: (station.name || 'Unknown station').trim(),
    url_resolved: station.url_resolved,
    favicon: station.favicon || '',
    tags: station.tags || '',
    country: station.country || '',
    language: station.language || '',
    votes: station.votes ?? 0,
    clicks: station.clickcount ?? 0,
    codec: station.codec || '',
    bitrate: station.bitrate ?? 0,
    category: categorize(station),
  };
}

const score = (s) => s.clicks * 10 + s.votes;

export async function fetchDirectoryStations() {
  // Serve a cached snapshot (24h) instantly in the background while fresh
  // data loads — callers use `getCachedDirectory()` for the instant path.
  const queries = [
    // Everything Nigerian in the directory (~84)
    '/json/stations/search?country=Nigeria&hidebroken=true&order=clickcount&reverse=true&limit=500',
    // Afrobeats/afropop from anywhere in the world
    '/json/stations/search?tag=afrobeats&hidebroken=true&order=clickcount&reverse=true&limit=200',
    '/json/stations/search?tag=afropop&hidebroken=true&order=clickcount&reverse=true&limit=100',
    // Lofi only — no generic chill/ambient/lounge filler
    '/json/stations/search?tag=lofi&hidebroken=true&order=clickcount&reverse=true&limit=300',
    '/json/stations/search?tag=lofi-hip-hop&hidebroken=true&order=clickcount&reverse=true&limit=100',
    '/json/stations/search?tag=chillhop&hidebroken=true&order=clickcount&reverse=true&limit=100',
    // Africa country picker: Ghana, Kenya, SA + neighbours
    '/json/stations/search?country=Ghana&hidebroken=true&order=clickcount&reverse=true&limit=200',
    '/json/stations/search?country=Kenya&hidebroken=true&order=clickcount&reverse=true&limit=150',
    '/json/stations/search?country=South Africa&hidebroken=true&order=clickcount&reverse=true&limit=150',
    '/json/stations/search?country=Cameroon&hidebroken=true&order=clickcount&reverse=true&limit=100',
    '/json/stations/search?country=Tanzania&hidebroken=true&order=clickcount&reverse=true&limit=100',
    '/json/stations/search?country=Uganda&hidebroken=true&order=clickcount&reverse=true&limit=100',
    '/json/stations/search?country=Ethiopia&hidebroken=true&order=clickcount&reverse=true&limit=100',
    '/json/stations/search?country=Senegal&hidebroken=true&order=clickcount&reverse=true&limit=100',
    // World country picker: Germany, France, UK, USA
    '/json/stations/search?country=Germany&hidebroken=true&order=clickcount&reverse=true&limit=150',
    '/json/stations/search?country=France&hidebroken=true&order=clickcount&reverse=true&limit=150',
    '/json/stations/search?country=United Kingdom&hidebroken=true&order=clickcount&reverse=true&limit=150',
    '/json/stations/search?country=United States&hidebroken=true&order=clickcount&reverse=true&limit=200',
  ];
  // Cap the whole fan-out: slow queries resolve to [] instead of holding
  // up the merge. Fast servers still contribute their results.
  const withTimeout = (q) =>
    Promise.race([
      getJson(q).catch(() => []),
      new Promise((resolve) => setTimeout(() => resolve([]), 9000)),
    ]);
  const batches = await Promise.all(queries.map(withTimeout));
  const seen = new Set();
  const radio = [];
  const lofi = [];
  for (const batch of batches) {
    for (const raw of batch) {
      if (!raw?.stationuuid || seen.has(raw.stationuuid)) continue;
      if (!isDirectPlayable(raw)) continue;
      seen.add(raw.stationuuid);
      const s = normalize(raw);
      if (s.category === 'radio') radio.push(s);
      else if (s.category === 'lofi') lofi.push(s);
    }
  }
  // Best first, with generous caps so the lists feel deep but stay fast.
  radio.sort((a, b) => score(b) - score(a));
  lofi.sort((a, b) => score(b) - score(a));
  const merged = [...radio.slice(0, 900), ...lofi.slice(0, 240)];
  try {
    localStorage.setItem(
      DIRECTORY_CACHE_KEY,
      JSON.stringify({ savedAt: Date.now(), stations: merged }),
    );
  } catch {
    /* noop */
  }
  return merged;
}

const DIRECTORY_CACHE_KEY = 'nlr-directory-cache';
const DIRECTORY_CACHE_TTL = 24 * 60 * 60 * 1000;

/** Instant optional path: last good directory snapshot (≤24h old). */
export function getCachedDirectory() {
  try {
    const raw = localStorage.getItem(DIRECTORY_CACHE_KEY);
    if (!raw) return null;
    const { savedAt, stations } = JSON.parse(raw);
    if (!Array.isArray(stations) || stations.length === 0) return null;
    if (Date.now() - savedAt > DIRECTORY_CACHE_TTL) return null;
    return stations;
  } catch {
    return null;
  }
}

export async function searchDirectory(query) {
  const raw = await getJson(
    `/json/stations/byname/${encodeURIComponent(query)}?hidebroken=true&order=clickcount&reverse=true&limit=60`,
  );
  return raw.filter(isDirectPlayable).map(normalize);
}

/** Tell the directory a station was played (fire-and-forget, used for stats). */
export function registerClick(stationuuid) {
  if (!stationuuid || stationuuid.startsWith('fb-')) return;
  getJson(`/json/url/${stationuuid}`).catch(() => {});
}
