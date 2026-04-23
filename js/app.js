// app.js — Pronoboost
// Pronoboost — app.js avec intégration API openfootball/worldcup.json

const App = (() => {

  // ── FIREBASE (lecture différée) ───────────────────────────────────
  function getDb()          { return window._db; }
  function getFn(name)      { return window._dbFns[name]; }
  const ref    = (...a) => getFn('ref')(...a);
  const set    = (...a) => getFn('set')(...a);
  const get    = (...a) => getFn('get')(...a);
  const onValue= (...a) => getFn('onValue')(...a);
  const push   = (...a) => getFn('push')(...a);
  const update = (...a) => getFn('update')(...a);
  function db() { return getDb(); }

  let currentUser  = null;
  let currentTab   = 'matchs';
  let groupListeners = [];

  // ── INIT ──────────────────────────────────────────────────────────
  function init() {
    const saved = localStorage.getItem('pronoboost_user');
    if (saved) {
      try {
        currentUser = JSON.parse(saved);
        showApp();
      } catch(e) { localStorage.removeItem('pronoboost_user'); }
    }
    // Pre-fill group code from URL param
    const urlGroup = new URLSearchParams(location.search).get('groupe');
    if (urlGroup) {
      const el = document.getElementById('login-code');
      if (el) el.value = urlGroup;
    }
  }

  // ── AUTH ──────────────────────────────────────────────────────────
  async function login() {
    const name = document.getElementById('login-name').value.trim();
    const code = document.getElementById('login-code').value.trim().toUpperCase();
    if (!name || !code) return showError('Merci de remplir votre prénom et le code du groupe.');
    if (code.length < 3) return showError('Le code du groupe doit faire au moins 3 caractères.');
    try {
      const groupRef = ref(db(), `groups/${code}`);
      const snap = await get(groupRef);
      if (!snap.exists()) return showError('Groupe introuvable. Vérifiez le code ou créez un nouveau groupe.');
      const groupData = snap.val();
      const isAdmin = groupData.admin === name;
      await set(ref(db(), `groups/${code}/members/${name.replace(/\s/g,'_')}`), {
        name, joinedAt: Date.now()
      });
      currentUser = { name, groupCode: code, isAdmin, groupName: groupData.name || code };
      localStorage.setItem('pronoboost_user', JSON.stringify(currentUser));
      showApp();
    } catch(e) {
      showError('Erreur de connexion. Vérifiez votre configuration Firebase.');
      console.error(e);
    }
  }

  async function createGroup() {
    const name = document.getElementById('login-name').value.trim();
    const code = document.getElementById('new-group-code').value.trim().toUpperCase();
    if (!name || !code) return showError('Merci de remplir votre prénom et le code du groupe.');
    if (code.length < 3) return showError('Le code doit faire au moins 3 caractères.');
    try {
      const groupRef = ref(db(), `groups/${code}`);
      const snap = await get(groupRef);
      if (snap.exists()) return showError('Ce code est déjà pris. Choisissez-en un autre.');

      await set(groupRef, {
        name: code, admin: name,
        createdAt: Date.now(),
        members: { [name.replace(/\s/g,'_')]: { name, joinedAt: Date.now() } }
      });

      // Charger les matchs depuis l'API openfootball (GitHub, sans clé)
      const apiResult = await WCApi.fetchMatches({ forceRefresh: true });
      if (!apiResult.ok || !apiResult.data.length) {
        showError('Impossible de charger les matchs depuis l\'API. Vérifiez votre connexion.');
        return;
      }
      const matchUpdates = {};
      apiResult.data.forEach(m => {
        matchUpdates[`groups/${code}/matches/${m.id}`] = {
          id: m.id, phase: m.phase, group: m.group,
          date: m.date, home: m.home, away: m.away,
          homeFlag: m.homeFlag, awayFlag: m.awayFlag,
          venue: m.venue,
          // On ne stocke pas les scores API : l'admin les saisit manuellement
          resultHome: null, resultAway: null
        };
      });
      await update(ref(db()), matchUpdates);

      currentUser = { name, groupCode: code, isAdmin: true, groupName: code };
      localStorage.setItem('pronoboost_user', JSON.stringify(currentUser));
      showApp();
    } catch(e) {
      showError('Erreur lors de la création. Vérifiez votre configuration Firebase.');
      console.error(e);
    }
  }

  function logout() {
    groupListeners.forEach(unsub => unsub());
    groupListeners = [];
    currentUser = null;
    localStorage.removeItem('pronoboost_user');
    document.getElementById('screen-app').classList.remove('active'); // FIX: retirer active
    document.getElementById('screen-app').classList.add('hidden');
    document.getElementById('screen-login').classList.remove('hidden');
    document.getElementById('screen-login').classList.add('active');
  }

  function showCreateGroup() {
    document.getElementById('create-group-form').classList.toggle('hidden');
    return false;
  }

  function showError(msg) {
    const el = document.getElementById('login-error');
    el.textContent = msg;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 4000);
  }

  // ── SHOW APP ──────────────────────────────────────────────────────
  function showApp() {
    document.getElementById('screen-login').classList.remove('active');
    document.getElementById('screen-login').classList.add('hidden');
    document.getElementById('screen-app').classList.remove('hidden');
    document.getElementById('screen-app').classList.add('active'); // FIX: sans 'active', .screen{display:none} reste actif
    document.getElementById('header-user').textContent = currentUser.name;
    document.getElementById('header-group').textContent = currentUser.groupCode;

    if (currentUser.isAdmin) document.getElementById('nav-admin').style.display = '';

    const shareUrl = `${location.origin}${location.pathname}?groupe=${currentUser.groupCode}`;
    const shareEl = document.getElementById('share-url-display');
    if (shareEl) shareEl.textContent = shareUrl;

    loadTab('matchs');
    listenClassement();
  }

  // ── TABS ──────────────────────────────────────────────────────────
  function switchTab(tab) {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.tab-content').forEach(t => {
      t.classList.toggle('active', t.id === `tab-${tab}`);
      t.classList.toggle('hidden', t.id !== `tab-${tab}`);
    });
    currentTab = tab;
    loadTab(tab);
  }

  function loadTab(tab) {
    if (tab === 'matchs')      renderMatchs();
    else if (tab === 'classement') renderClassement();
    else if (tab === 'collegues')  renderCollegues();
    else if (tab === 'admin')      renderAdmin();
  }

  // ── MES PRONOS ───────────────────────────────────────────────────────────────
  // State: phase sélectionnée et groupe sélectionné pour cet onglet
  let _matchPhase = 'all';
  let _matchGroup = 'A';
  let _matchData  = null; // { matchesObj, myPronos } — cache session

  async function renderMatchs() {
    const container = document.getElementById('matches-list');
    container.innerHTML = '<div class="loading">Chargement des matchs…</div>';

    // Charger matchs + pronostics en parallèle
    const [matchSnap, pronoSnap] = await Promise.all([
      get(ref(db(), `groups/${currentUser.groupCode}/matches`)),
      get(ref(db(), `groups/${currentUser.groupCode}/pronostics/${currentUser.name.replace(/\s/g,'_')}`))
    ]);
    let matchesObj = matchSnap.val() || {};

    // ── AUTO-RÉPARATION ─────────────────────────────────────────────────
    // Si Firebase contient moins de 104 matchs (groupe créé alors que l'API
    // était KO, import partiel, etc.), on re-tire les données et on complète.
    // Utilise le fallback statique data/matches.json si GitHub est inaccessible.
    const EXPECTED = 104;
    const count = Object.keys(matchesObj).length;
    // Un nom d'équipe de phase de groupes est un placeholder si : vide, "TBD",
    // commence par un chiffre ("1A", "2B"), "W"/"L" ("W73", "L101"), contient "/"
    // ("3A/B/C/D/F"), ou commence par "Équipe" ("Équipe A1", vestige d'une ancienne
    // version du seed Firebase écrite avant le tirage au sort).
    const DEFAULT_FLAG = '🏳️';
    const isPlaceholderName = n =>
      !n || n === 'TBD' || /^[0-9WL]/.test(n) || n.includes('/') || n.startsWith('Équipe');
    const hasStaleData = Object.values(matchesObj).some(m =>
      !m.homeFlag || !m.awayFlag ||
      (m.phase === 'Groupes' && (
        isPlaceholderName(m.home) || isPlaceholderName(m.away) ||
        m.homeFlag === DEFAULT_FLAG || m.awayFlag === DEFAULT_FLAG
      ))
    );
    if (count < EXPECTED || hasStaleData) {
      console.warn(`[App] Données Firebase obsolètes (${count}/${EXPECTED} matchs, placeholders détectés) — re-synchronisation depuis l'API…`);
      container.innerHTML = '<div class="loading">Réparation des matchs manquants…</div>';
      const apiResult = await WCApi.fetchMatches({ forceRefresh: true });
      if (apiResult.ok && apiResult.data.length) {
        const updates = {};
        apiResult.data.forEach(m => {
          const existing = matchesObj[m.id] || {};
          // Conserver les résultats saisis manuellement par l'admin
          updates[`groups/${currentUser.groupCode}/matches/${m.id}`] = {
            id: m.id, phase: m.phase, group: m.group,
            date: m.date, home: m.home, away: m.away,
            homeFlag: m.homeFlag, awayFlag: m.awayFlag,
            venue: m.venue,
            resultHome: existing.resultHome ?? null,
            resultAway: existing.resultAway ?? null
          };
        });
        await update(ref(db()), updates);
        // Relire depuis Firebase pour avoir la version finale (au cas où d'autres
        // changements auraient eu lieu entre temps)
        const freshSnap = await get(ref(db(), `groups/${currentUser.groupCode}/matches`));
        matchesObj = freshSnap.val() || {};
        console.log(`[App] Réparation OK — ${Object.keys(matchesObj).length} matchs disponibles`);
      } else {
        console.error('[App] Réparation impossible : API et fallback KO');
      }
    }

    _matchData  = { matchesObj, myPronos: pronoSnap.val() || {} };
    _matchPhase = 'all';
    _matchGroup = 'A';

    // Masquer les sous-filtres de groupe au (re)chargement
    const subEl = document.getElementById('pronos-group-subfilters');
    if (subEl) { subEl.classList.add('hidden'); subEl.innerHTML = ''; }

    // Boutons de phase
    const phases = ['Groupes','Huitièmes','Quarts','Demi-finales','Petite finale','Finale'];
    document.getElementById('phase-filters').innerHTML =
      phases.map(p => `<button class="phase-btn" data-phase="${p}" onclick="App.filterPhase('${p}')">${p}</button>`).join('') +
      `<button class="phase-btn active" data-phase="all" onclick="App.filterPhase('all')">Tous</button>`;

    _renderMatchsView();
  }

  // Appelé quand on clique sur un bouton de phase (Groupes, Huitièmes, Tous…)
  function filterPhase(phase) {
    _matchPhase = phase;
    document.querySelectorAll('#tab-matchs .phase-btn').forEach(b => b.classList.toggle('active', b.dataset.phase === phase));

    const subEl = document.getElementById('pronos-group-subfilters');
    if (phase === 'Groupes') {
      // Construire les sous-filtres Groupe A → L à partir des données réelles
      const allMatches = Object.values((_matchData || {}).matchesObj || {});
      const letters = [...new Set(
        allMatches.filter(m => m.phase === 'Groupes' && m.group).map(m => m.group)
      )].sort();
      if (!letters.includes(_matchGroup)) _matchGroup = letters[0] || 'A';
      if (subEl) {
        subEl.innerHTML = letters.map(g =>
          `<button class="group-btn${g === _matchGroup ? ' active' : ''}" data-group="${g}" onclick="App.filterGroupMatchs('${g}')">Groupe ${g}</button>`
        ).join('');
        subEl.classList.remove('hidden');
      }
    } else {
      // Cacher les sous-filtres pour toutes les autres phases
      if (subEl) { subEl.classList.add('hidden'); subEl.innerHTML = ''; }
    }

    _renderMatchsView();
  }

  // Appelé quand on clique sur un sous-filtre de groupe (A, B, C…)
  function filterGroupMatchs(group) {
    _matchGroup = group;
    document.querySelectorAll('#pronos-group-subfilters .group-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.group === group)
    );
    _renderMatchsView();
  }

  // Rendu effectif de la liste selon _matchPhase et _matchGroup
  function _renderMatchsView() {
    if (!_matchData) return;
    const { matchesObj, myPronos } = _matchData;
    const now = Date.now();

    // Tri global par date croissante, puis filtrage
    let filtered = Object.values(matchesObj).sort((a,b) => new Date(a.date) - new Date(b.date));
    if (_matchPhase === 'Groupes') {
      filtered = filtered.filter(m => m.phase === 'Groupes' && m.group === _matchGroup);
    } else if (_matchPhase !== 'all') {
      filtered = filtered.filter(m => m.phase === _matchPhase);
    }

    let html = '';
    filtered.forEach(m => {
      const matchTime = new Date(m.date).getTime();
      const isDone    = m.resultHome != null && m.resultAway != null;
      const isOpen    = !isDone && matchTime > now + 60000;
      const myP       = myPronos[m.id];
      const points    = (isDone && myP) ? calcPoints(myP.home, myP.away, m.resultHome, m.resultAway) : null;
      const dateStr   = new Date(m.date).toLocaleDateString('fr-FR', {
        weekday:'short', day:'numeric', month:'short', hour:'2-digit', minute:'2-digit'
      });

      html += `<div class="match-card ${isDone ? 'done' : ''}">`;
      html += `<div class="match-meta">
        <span class="match-status ${isOpen ? 'open' : isDone ? 'done' : 'closed'}">${isOpen ? 'Ouvert' : isDone ? 'Terminé' : 'Fermé'}</span>
        <span class="match-date-str">${dateStr}</span>
        ${m.group && _matchPhase !== 'Groupes' ? `<span class="match-group">Gr. ${m.group}</span>` : ''}
      </div>`;

      html += `<div class="match-body">
        <div class="team"><span class="flag">${m.homeFlag}</span><span class="team-name">${m.home}</span></div>`;

      if (isDone) {
        const cls   = points === 3 ? 'exact' : points === 1 ? 'partial' : 'wrong';
        const label = points === 3 ? '+3 pts ✓' : points === 1 ? '+1 pt ~' : '0 pt ✗';
        html += `<div class="score-center">
          <div class="result-score">${m.resultHome} – ${m.resultAway}</div>
          ${myP ? `<div class="my-prono ${cls}">Prono : ${myP.home}–${myP.away} · ${label}</div>` : ''}
        </div>`;
      } else if (isOpen) {
        html += `<div class="score-center">
          <div class="prono-inputs">
            <input class="score-input" type="number" min="0" max="20" id="h_${m.id}" value="${myP !== undefined ? myP.home : ''}" placeholder="0">
            <span class="score-sep">–</span>
            <input class="score-input" type="number" min="0" max="20" id="a_${m.id}" value="${myP !== undefined ? myP.away : ''}" placeholder="0">
          </div>
          <button class="btn-save" id="btn_${m.id}" onclick="App.saveProno('${m.id}')">Valider</button>
        </div>`;
      } else {
        html += `<div class="score-center">
          <div class="closed-badge">Pronostics fermés</div>
          ${myP !== undefined ? `<div class="my-prono-locked">${myP.home}–${myP.away}</div>` : '<div class="closed-badge">—</div>'}
        </div>`;
      }

      html += `<div class="team"><span class="flag">${m.awayFlag}</span><span class="team-name">${m.away}</span></div>
      </div>`;
      if (m.venue) html += `<div class="match-venue">📍 ${m.venue}</div>`;
      html += `</div>`;
    });

    document.getElementById('matches-list').innerHTML = html || '<p class="empty">Aucun match trouvé.</p>';
  }

  async function saveProno(matchId) {
    const h = parseInt(document.getElementById(`h_${matchId}`).value);
    const a = parseInt(document.getElementById(`a_${matchId}`).value);
    if (isNaN(h) || isNaN(a) || h < 0 || a < 0) {
      alert('Entrez deux scores valides (nombres ≥ 0).'); return;
    }
    const key = currentUser.name.replace(/\s/g, '_');
    await set(ref(db(), `groups/${currentUser.groupCode}/pronostics/${key}/${matchId}`), {
      home: h, away: a, savedAt: Date.now()
    });
    const btn = document.getElementById(`btn_${matchId}`);
    if (btn) {
      btn.textContent = '✓ Enregistré';
      btn.classList.add('saved');
      setTimeout(() => { btn.textContent = 'Valider'; btn.classList.remove('saved'); }, 2000);
    }
  }

  // ── CLASSEMENT ────────────────────────────────────────────────────
  function listenClassement() {
    const unsub1 = onValue(ref(db(), `groups/${currentUser.groupCode}/matches`), () => {
      if (currentTab === 'classement') renderClassement();
    });
    const unsub2 = onValue(ref(db(), `groups/${currentUser.groupCode}/pronostics`), () => {
      if (currentTab === 'classement') renderClassement();
    });
    groupListeners.push(unsub1, unsub2);
  }

  async function renderClassement() {
    const [matchSnap, pronoSnap, memberSnap] = await Promise.all([
      get(ref(db(), `groups/${currentUser.groupCode}/matches`)),
      get(ref(db(), `groups/${currentUser.groupCode}/pronostics`)),
      get(ref(db(), `groups/${currentUser.groupCode}/members`))
    ]);
    const matches = matchSnap.val() || {};
    const allPronos = pronoSnap.val() || {};
    const members = memberSnap.val() || {};

    const scores = {};
    Object.values(members).forEach(m => {
      scores[m.name] = { name: m.name, pts: 0, exact: 0, winner: 0, played: 0 };
    });

    Object.values(matches).forEach(match => {
      if (match.resultHome === null || match.resultAway === null) return;
      Object.entries(allPronos).forEach(([userKey, userPronos]) => {
        const p = userPronos[match.id];
        if (!p) return;
        const memberName = Object.values(members).find(m => m.name.replace(/\s/g,'_') === userKey)?.name
          || userKey.replace(/_/g,' ');
        if (!scores[memberName]) scores[memberName] = { name: memberName, pts: 0, exact: 0, winner: 0, played: 0 };
        const pts = calcPoints(p.home, p.away, match.resultHome, match.resultAway);
        scores[memberName].pts += pts;
        scores[memberName].played++;
        if (pts === 3) scores[memberName].exact++;
        else if (pts === 1) scores[memberName].winner++;
      });
    });

    const ranked = Object.values(scores).sort((a,b) => b.pts - a.pts || b.exact - a.exact);
    document.getElementById('ranking-count').textContent = `${ranked.length} joueur${ranked.length > 1 ? 's' : ''}`;

    const medals = ['🥇','🥈','🥉'];
    const html = ranked.map((player, i) => {
      const isMe = player.name === currentUser.name;
      const medal = i < 3 ? medals[i] : `${i+1}`;
      return `<div class="ranking-row ${isMe ? 'me' : ''} ${i < 3 ? 'rank-top' : ''}">
        <div class="rank-pos">${medal}</div>
        <div class="rank-avatar" style="background:${avatarBg(player.name)};color:${avatarFg(player.name)}">${initials(player.name)}</div>
        <div class="rank-info">
          <div class="rank-name">${player.name}${isMe ? ' <span class="me-tag">Vous</span>' : ''}</div>
          <div class="rank-stats">${player.exact} score${player.exact > 1 ? 's' : ''} exact${player.exact > 1 ? 's' : ''} · ${player.winner} bon${player.winner > 1 ? 's' : ''} vainqueur · ${player.played} joué${player.played > 1 ? 's' : ''}</div>
        </div>
        <div class="rank-pts">${player.pts}<span class="pts-label">pts</span></div>
      </div>`;
    }).join('');

    document.getElementById('ranking-list').innerHTML = html || '<p class="empty">Aucun pronostic enregistré pour l\'instant.</p>';
  }

  // ── COLLÈGUES ─────────────────────────────────────────────────────
  async function renderCollegues() {
    const [matchSnap, pronoSnap, memberSnap] = await Promise.all([
      get(ref(db(), `groups/${currentUser.groupCode}/matches`)),
      get(ref(db(), `groups/${currentUser.groupCode}/pronostics`)),
      get(ref(db(), `groups/${currentUser.groupCode}/members`))
    ]);
    const matches = matchSnap.val() || {};
    const allPronos = pronoSnap.val() || {};
    const members = Object.values(memberSnap.val() || {});
    const now = Date.now();
    const startedMatches = Object.values(matches)
      .filter(m => new Date(m.date).getTime() <= now)
      .sort((a,b) => new Date(b.date) - new Date(a.date));

    const html = members.map(member => {
      if (member.name === currentUser.name) return '';
      const key = member.name.replace(/\s/g,'_');
      const userPronos = allPronos[key] || {};

      const rows = startedMatches.slice(0, 12).map(m => {
        const p = userPronos[m.id];
        if (!p) return '';
        const isDone = m.resultHome != null && m.resultAway != null;
        let cls = '', label = '';
        if (isDone) {
          const pts = calcPoints(p.home, p.away, m.resultHome, m.resultAway);
          cls = pts === 3 ? 'exact' : pts === 1 ? 'partial' : 'wrong';
          label = pts === 3 ? ' ✓' : pts === 1 ? ' ~' : ' ✗';
        }
        return `<div class="collegue-prono-row">
          <span class="collegue-match">${m.homeFlag} ${m.home} · ${m.awayFlag} ${m.away}</span>
          <span class="collegue-score ${cls}">${p.home}–${p.away}${label}</span>
        </div>`;
      }).filter(Boolean).join('');

      return `<div class="collegue-card">
        <div class="collegue-header">
          <div class="rank-avatar" style="background:${avatarBg(member.name)};color:${avatarFg(member.name)};width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700">${initials(member.name)}</div>
          <span class="collegue-name">${member.name}</span>
        </div>
        ${rows || '<p class="collegue-empty">Aucun pronostic sur les matchs commencés.</p>'}
      </div>`;
    }).filter(Boolean).join('');

    document.getElementById('collegues-list').innerHTML = html || '<p class="empty">Aucun autre membre dans ce groupe.</p>';
  }

  // ── ADMIN ─────────────────────────────────────────────────────────
  async function renderAdmin() {
    if (!currentUser.isAdmin) return;
    const shareUrl = `${location.origin}${location.pathname}?groupe=${currentUser.groupCode}`;
    document.getElementById('share-url-display').textContent = shareUrl;

    const snap = await get(ref(db(), `groups/${currentUser.groupCode}/matches`));
    const matches = snap.val() || {};
    const phases = ['Groupes','Huitièmes','Quarts','Demi-finales','Petite finale','Finale'];
    const now = Date.now();
    let html = '';

    phases.forEach(phase => {
      const phaseMatches = Object.values(matches)
        .filter(m => m.phase === phase && new Date(m.date).getTime() <= now + 3600000)
        .sort((a,b) => new Date(a.date) - new Date(b.date));
      if (!phaseMatches.length) return;

      html += `<div class="phase-group"><div class="phase-label">${phase}</div>`;
      phaseMatches.forEach(m => {
        const dateStr = new Date(m.date).toLocaleDateString('fr-FR', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
        const isDone = m.resultHome != null && m.resultAway != null;
        html += `<div class="match-card">
          <div class="match-meta">
            <span class="match-date-str">${dateStr}</span>
            ${isDone ? '<span class="match-status done">Résultat saisi</span>' : ''}
          </div>
          <div class="match-body">
            <div class="team"><span class="flag">${m.homeFlag}</span><span class="team-name">${m.home}</span></div>
            <div class="score-center">
              <div class="prono-inputs">
                <input class="score-input" type="number" min="0" max="20" id="rh_${m.id}" value="${m.resultHome != null ? m.resultHome : ''}" placeholder="0">
                <span class="score-sep">–</span>
                <input class="score-input" type="number" min="0" max="20" id="ra_${m.id}" value="${m.resultAway != null ? m.resultAway : ''}" placeholder="0">
              </div>
              <button class="btn-save admin-save" onclick="App.saveResult('${m.id}')">${isDone ? 'Modifier' : 'Saisir résultat'}</button>
            </div>
            <div class="team"><span class="flag">${m.awayFlag}</span><span class="team-name">${m.away}</span></div>
          </div>
        </div>`;
      });
      html += `</div>`;
    });

    document.getElementById('admin-matches-list').innerHTML = html
      || '<p class="empty">Les matchs apparaîtront ici à l\'approche du coup d\'envoi.</p>';
  }

  // Synchronise les matchs depuis l'API openfootball (met à jour noms d'équipes,
  // horaires et scores déjà joués selon l'API)
  async function syncFromApi() {
    const btn = document.getElementById('btn-sync-api');
    if (btn) { btn.textContent = 'Synchronisation…'; btn.disabled = true; }

    const apiResult = await WCApi.fetchMatches({ forceRefresh: true });
    if (!apiResult.ok || !apiResult.data.length) {
      alert('Impossible de contacter l\'API GitHub. Vérifiez votre connexion.');
      if (btn) { btn.textContent = 'Actualiser depuis l\'API'; btn.disabled = false; }
      return;
    }

    // Lire les résultats déjà saisis manuellement dans Firebase
    const existingSnap = await get(ref(db(), `groups/${currentUser.groupCode}/matches`));
    const existing = existingSnap.val() || {};

    const updates = {};
    apiResult.data.forEach(m => {
      const current = existing[m.id] || {};
      // Conserver les résultats saisis manuellement ; utiliser l'API seulement si
      // l'admin n'a pas encore saisi de résultat pour ce match
      const resultHome = (current.resultHome !== null && current.resultHome !== undefined)
        ? current.resultHome : m.resultHome;
      const resultAway = (current.resultAway !== null && current.resultAway !== undefined)
        ? current.resultAway : m.resultAway;

      updates[`groups/${currentUser.groupCode}/matches/${m.id}`] = {
        id: m.id, phase: m.phase, group: m.group,
        date: m.date, home: m.home, away: m.away,
        homeFlag: m.homeFlag, awayFlag: m.awayFlag,
        venue: m.venue, resultHome, resultAway
      };
    });

    await update(ref(db()), updates);
    if (btn) { btn.textContent = '✓ Synchronisé !'; btn.disabled = false; }
    setTimeout(() => renderAdmin(), 1000);
  }

  async function saveResult(matchId) {
    const h = parseInt(document.getElementById(`rh_${matchId}`).value);
    const a = parseInt(document.getElementById(`ra_${matchId}`).value);
    if (isNaN(h) || isNaN(a) || h < 0 || a < 0) { alert('Entrez deux scores valides.'); return; }
    await update(ref(db(), `groups/${currentUser.groupCode}/matches/${matchId}`), {
      resultHome: h, resultAway: a
    });
    const btn = document.querySelector(`[onclick="App.saveResult('${matchId}')"]`);
    if (btn) { btn.textContent = '✓ Enregistré'; setTimeout(() => renderAdmin(), 1500); }
  }

  async function copyLink() {
    const url = `${location.origin}${location.pathname}?groupe=${currentUser.groupCode}`;
    try { await navigator.clipboard.writeText(url); } catch(e) {}
    const btn = event.target;
    btn.textContent = '✓ Lien copié !';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = 'Copier le lien'; btn.classList.remove('copied'); }, 2000);
  }


  // ── SAVE PRONO ────────────────────────────────────────────────────
  

  function calcPoints(ph, pa, rh, ra) {
    ph = +ph; pa = +pa; rh = +rh; ra = +ra;
    if (ph === rh && pa === ra) return 3;
    const pw = ph > pa ? 'H' : ph < pa ? 'A' : 'D';
    const rw = rh > ra ? 'H' : rh < ra ? 'A' : 'D';
    return pw === rw ? 1 : 0;
  }

  function initials(name) {
    return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0,2);
  }

  // Light pastel avatars for the light theme
  const AVATAR_PALETTES = [
    { bg:'#dbeafe', fg:'#1d4ed8' },
    { bg:'#dcfce7', fg:'#15803d' },
    { bg:'#fef9c3', fg:'#a16207' },
    { bg:'#fce7f3', fg:'#9d174d' },
    { bg:'#ede9fe', fg:'#6d28d9' },
    { bg:'#ffedd5', fg:'#c2410c' },
    { bg:'#cffafe', fg:'#0e7490' },
    { bg:'#f1f5f9', fg:'#334155' },
  ];
  function avatarPalette(name) {
    let h = 0;
    for (let c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffffff;
    return AVATAR_PALETTES[Math.abs(h) % AVATAR_PALETTES.length];
  }
  function avatarBg(name) { return avatarPalette(name).bg; }
  function avatarFg(name) { return avatarPalette(name).fg; }

  return { init, login, logout, createGroup, showCreateGroup, switchTab, saveProno, filterPhase, filterGroupMatchs, saveResult, syncFromApi, copyLink };
})();
