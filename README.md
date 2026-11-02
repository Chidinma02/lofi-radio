# Naija Lofi Radio

A React web app to fetch and switch between **lofi** stations and **Nigerian** radio stations, powered by the free [Radio Browser](https://www.radio-browser.info/) directory.

## Run it

```bash
cd naija-lofi-radio
npm install
npm run dev
```

Then open the URL Vite prints (default http://localhost:5174).

## Features

- 🇳🇬 / 🎧 category tabs (All, Nigerian, Lofi, Favorites)
- Live station list from the Radio Browser API, with a curated fallback list that works even if the API is down
- Search across the directory (debounced)
- Play / pause / stop, volume slider, buffering + error states
- Favorites saved to `localStorage`
- HLS (`.m3u8`) streams filtered out since plain `<audio>` tags can't play them
