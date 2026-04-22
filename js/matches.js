// matches.js — Client openfootball/worldcup.json
// Source : https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json
// Aucune clé API, aucune inscription, domaine public

const WCApi = (() => {

  const URL_2026 = 'https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json';
  // Fallback statique embarqué : utilisé si l'appel GitHub échoue (CORS, hors-ligne, panne…)
  // Contient les 104 matchs déjà normalisés (sans scores tant que la compétition n'a pas démarré).
  const FALLBACK_URL = 'data/matches.json';
  const CACHE_KEY = 'wc2026_openfootball_v3';
  const CACHE_TTL = 2 * 60 * 60 * 1000; // 2 heures

  // ── DRAPEAUX ──────────────────────────────────────────────────────────
  const FLAGS = {
    'Mexico': '🇲🇽', 'South Africa': '🇿🇦', 'South Korea': '🇰🇷',
    'Czech Republic': '🇨🇿', 'Czechia': '🇨🇿', 'Canada': '🇨🇦',
    'Bosnia and Herzegovina': '🇧🇦', 'Qatar': '🇶🇦', 'Switzerland': '🇨🇭',
    'Brazil': '🇧🇷', 'Morocco': '🇲🇦', 'Haiti': '🇭🇹', 'Scotland': '🏴󠁧󠁢󠁳󠁣󠁴󠁿',
    'USA': '🇺🇸', 'United States': '🇺🇸', 'Paraguay': '🇵🇾',
    'Australia': '🇦🇺', 'Turkey': '🇹🇷', 'Türkiye': '🇹🇷',
    'Germany': '🇩🇪', 'Curaçao': '🇨🇼', 'Ivory Coast': '🇨🇮',
    "Côte d'Ivoire": '🇨🇮', 'Ecuador': '🇪🇨', 'Netherlands': '🇳🇱',
    'Japan': '🇯🇵', 'Tunisia': '🇹🇳', 'Belgium': '🇧🇪', 'Egypt': '🇪🇬',
    'Iran': '🇮🇷', 'New Zealand': '🇳🇿', 'Spain': '🇪🇸', 'Cape Verde': '🇨🇻',
    'Saudi Arabia': '🇸🇦', 'Uruguay': '🇺🇾', 'France': '🇫🇷',
    'Senegal': '🇸🇳', 'Iraq': '🇮🇶', 'Norway': '🇳🇴',
    'Argentina': '🇦🇷', 'Algeria': '🇩🇿', 'Austria': '🇦🇹', 'Jordan': '🇯🇴',
    'Portugal': '🇵🇹', 'DR Congo': '🇨🇩', 'Congo DR': '🇨🇩',
    'Uzbekistan': '🇺🇿', 'Colombia': '🇨🇴', 'England': '🏴󠁧󠁢󠁥󠁮󠁧󠁿',
    'Croatia': '🇭🇷', 'Ghana': '🇬🇭', 'Panama': '🇵🇦',
    'Sweden': '🇸🇪', 'Poland': '🇵🇱', 'Serbia': '🇷🇸',
    'Ukraine': '🇺🇦', 'Denmark': '🇩🇰', 'Venezuela': '🇻🇪',
    'Nigeria': '🇳🇬', 'Cameroon': '🇨🇲', 'Peru': '🇵🇪',
    'Chile': '🇨🇱', 'Honduras': '🇭🇳', 'Costa Rica': '🇨🇷',
    'Jamaica': '🇯🇲', 'Greece': '🇬🇷', 'Slovakia': '🇸🇰',
    'Romania': '🇷🇴', 'Hungary': '🇭🇺', 'Cuba': '🇨🇺',
    'Indonesia': '🇮🇩', 'China': '🇨🇳', 'UAE': '🇦🇪',
    'Bahrain': '🇧🇭', 'Lebanon': '🇱🇧', 'Guatemala': '🇬🇹',
    'El Salvador': '🇸🇻', 'Trinidad and Tobago': '🇹🇹',
    'Bosnia & Herzegovina': '🇧🇦',
  };

  function getFlag(name) {
    if (!name) return '🏳️';
    if (FLAGS[name]) return FLAGS[name];
    const low = name.toLowerCase();
    const key = Object.keys(FLAGS).find(k => k.toLowerCase() === low);
    return key ? FLAGS[key] : '🏳️';
  }

  // ── PHASE ──────────────────────────────────────────────────────────────
  function mapPhase(round, group) {
    // Si le champ "group" est présent → phase de groupes
    if (group) return 'Groupes';
    if (!round) return 'Groupes';
    const r = round.toLowerCase();
    if (r.includes('round of 32') || r.includes('round of 16')) return 'Huitièmes';
    if (r.includes('quarter')) return 'Quarts';
    if (r.includes('semi')) return 'Demi-finales';
    if (r.includes('third') || r.includes('3rd') || r.includes('bronze') || r.includes('third place')) return 'Petite finale';
    if (r.includes('final')) return 'Finale';
    return 'Groupes';
  }

  // ── PARSING DATE ─────────────────────────────────────────────────────
  // "2026-06-11" + "13:00 UTC-6"  →  Date UTC
  function parseMatchDate(date, time) {
    if (!date) return new Date(date);
    if (!time) return new Date(date + 'T12:00:00Z');

    // Extraire heure locale + offset : "13:00 UTC-6", "20:00 UTC+2", "12:00 UTC-4"
    const m = time.match(/^(\d{1,2}):(\d{2})\s*UTC([+-]\d+)$/);
    if (!m) return new Date(date + 'T12:00:00Z');

    const [, hh, mm, offStr] = m;
    const offsetHours = parseInt(offStr, 10);

    // Construire la date locale naïve, puis corriger l'offset
    const localStr = `${date}T${hh.padStart(2, '0')}:${mm}:00`;
    // Heure UTC = heure locale - offset (ex: UTC-6 → ajouter 6h)
    const localMs  = new Date(localStr).getTime();
    const utcMs    = localMs - offsetHours * 3600 * 1000;
    return new Date(utcMs);
  }

  // ── NORMALISATION D'UN MATCH ──────────────────────────────────────────
  function normalizeMatch(m, index) {
    const phase = mapPhase(m.round, m.group);
    const group = m.group ? m.group.replace('Group ', '').trim() : '';
    const matchDate = parseMatchDate(m.date, m.time);

    // Scores : openfootball utilise score1/score2 quand le match est joué
    const resultHome = (m.score1 !== undefined && m.score1 !== null) ? Number(m.score1) : null;
    const resultAway = (m.score2 !== undefined && m.score2 !== null) ? Number(m.score2) : null;

    return {
      id:          'm' + String(index + 1).padStart(3, '0'),
      phase,
      group,
      date:        matchDate.toISOString(),
      home:        m.team1 || 'TBD',
      away:        m.team2 || 'TBD',
      homeFlag:    getFlag(m.team1),
      awayFlag:    getFlag(m.team2),
      venue:       m.ground || '',
      resultHome,
      resultAway,
    };
  }

  // ── FETCH + CACHE ─────────────────────────────────────────────────────
  async function fetchMatches({ forceRefresh = false } = {}) {
    // 1. Lire le cache localStorage
    if (!forceRefresh) {
      try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (raw) {
          const { ts, data } = JSON.parse(raw);
          if (Date.now() - ts < CACHE_TTL && Array.isArray(data) && data.length > 0) {
            console.log(`[WCApi] Cache — ${data.length} matchs`);
            return { ok: true, data, fromCache: true };
          }
        }
      } catch(e) { /* cache corrompu, on continue */ }
    }

    // 2. Requête GitHub Raw
    try {
      const res = await fetch(URL_2026);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();

      const raw = json.matches || [];
      if (!raw.length) throw new Error('Aucun match dans la réponse');

      // Trier par date avant de normaliser (pour que les IDs soient dans l'ordre chronologique)
      raw.sort((a, b) => {
        const da = parseMatchDate(a.date, a.time);
        const db = parseMatchDate(b.date, b.time);
        return da - db;
      });

      const data = raw.map(normalizeMatch);
      localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data }));
      console.log(`[WCApi] Fetch OK — ${data.length} matchs`);
      return { ok: true, data, fromCache: false };
    } catch(e) {
      console.warn('[WCApi] Fetch GitHub KO (' + e.message + ') — bascule sur le fallback local');
    }

    // 3. Fallback : JSON statique déjà normalisé livré avec le site
    try {
      const res = await fetch(FALLBACK_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data) || !data.length) throw new Error('Fallback vide');

      // On (re)peuple le cache pour éviter de taper le fichier à chaque render
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data }));
      } catch(_) { /* quota/localStorage indispo */ }

      console.log(`[WCApi] Fallback local OK — ${data.length} matchs (scores non inclus)`);
      return { ok: true, data, fromCache: false, fromFallback: true };
    } catch(e) {
      console.error('[WCApi] Fallback KO:', e.message);
      return { ok: false, error: e.message, data: [] };
    }
  }

  return { fetchMatches, getFlag };
})();

window.WCApi = WCApi;
