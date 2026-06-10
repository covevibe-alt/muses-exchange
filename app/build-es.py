#!/usr/bin/env python3
"""Generate mundial2026.html — the Spanish twin of wc2026.html.

Same pool, same Supabase backend, same data feed; only the UI language
differs. Runs inside .github/workflows/wc2026-results.yml after each fetch,
so any change to the English page propagates automatically. Replacements
that stop matching (because the English source changed) are reported as
warnings and simply stay English until this table is updated — the build
never fails over a missing translation.
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "wc2026.html"
OUT = ROOT / "mundial2026.html"

# Applied in order; longer/more specific strings must come before substrings.
TRANSLATIONS = [
    # ── document head ──
    ('<html lang="en">', '<html lang="es">'),
    ('<title>WC 2026 · Predictions Pool</title>',
     '<title>Mundial 2026 · Predicciones</title>'),
    ('<meta property="og:title" content="⚽ World Cup 2026 — Predictions Pool">',
     '<meta property="og:title" content="⚽ Mundial 2026 — Quiniela de predicciones">'),
    ('<meta property="og:description" content="Predict every match, beat your friends. Scores update live, points count themselves.">',
     '<meta property="og:description" content="Predice cada partido y gana a tus amigos. Marcadores en vivo, puntos automáticos.">'),
    ('<meta property="og:url" content="https://muses.exchange/wc2026">',
     '<meta property="og:url" content="https://muses.exchange/mundial2026">'),

    # ── header / tabs / hero shell ──
    ('<h1>World Cup 2026<small>Predictions Pool</small></h1>',
     '<h1>Mundial 2026<small>Predicciones</small></h1>'),
    ('🌐 ES</a>', '🌐 EN</a>'),
    ('<span class="sub">Loading schedule…</span>', '<span class="sub">Cargando calendario…</span>'),
    ('<span class="ico">📅</span>Matches', '<span class="ico">📅</span>Partidos'),
    ('<span class="ico">🏟️</span>Groups', '<span class="ico">🏟️</span>Grupos'),
    ('<span class="ico">🏆</span>Leaderboard', '<span class="ico">🏆</span>Tabla'),
    ('<span class="ico">📖</span>Rules', '<span class="ico">📖</span>Reglas'),

    # ── filters ──
    ('data-f="all">All</button>', 'data-f="all">Todos</button>'),
    ('data-f="today">Today</button>', 'data-f="today">Hoy</button>'),
    ('data-f="open">To predict <span class="n" id="openCount"></span></button>',
     'data-f="open">Por predecir <span class="n" id="openCount"></span></button>'),
    ('data-f="live">Live</button>', 'data-f="live">En vivo</button>'),
    ('data-f="done">Finished</button>', 'data-f="done">Terminados</button>'),

    # ── groups view ──
    ('Standings update automatically from results. Top 2 of each group advance, plus the 8 best third-placed teams.',
     'La clasificación se actualiza sola con los resultados. Avanzan los 2 primeros de cada grupo y los 8 mejores terceros.'),

    # ── rules view ──
    ('<h3>How it works</h3>', '<h3>Cómo funciona</h3>'),
    ('Predict the score of every World Cup match before kickoff. Points are awarded automatically when matches finish — no admin, no spreadsheets.',
     'Predice el marcador de cada partido del Mundial antes del inicio. Los puntos se asignan automáticamente al terminar cada partido: sin admin y sin hojas de cálculo.'),
    ('<h3>Scoring</h3>', '<h3>Puntuación</h3>'),
    ('<b>5 points</b> — exact score (you said 2–1, it ended 2–1)',
     '<b>5 puntos</b> — marcador exacto (dijiste 2–1 y terminó 2–1)'),
    ('<b>3 points</b> — right winner and right goal difference (you said 2–1, it ended 3–2) — or a correctly predicted draw with the wrong score',
     '<b>3 puntos</b> — ganador y diferencia de goles correctos (dijiste 2–1 y terminó 3–2), o un empate acertado con otro marcador'),
    ('<b>2 points</b> — right winner only', '<b>2 puntos</b> — solo el ganador correcto'),
    ('<b>0 points</b> — wrong result', '<b>0 puntos</b> — resultado equivocado'),
    ('<b>+15 points</b> — your champion pick wins the World Cup (Bonus tab)',
     '<b>+15 puntos</b> — tu campeón gana el Mundial (pestaña Bonus)'),
    ("<b>+10 points</b> — your top-scorer pick wins the Golden Boot (Bonus tab; a tie for most goals counts, own goals and shootout kicks don't)",
     '<b>+10 puntos</b> — tu máximo goleador gana la Bota de Oro (pestaña Bonus; un empate a goles cuenta, no cuentan autogoles ni penales de tanda)'),
    ('<h3>The fine print</h3>', '<h3>La letra pequeña</h3>'),
    ('Predictions save automatically and <b>lock 30 minutes before kickoff</b> (enforced server-side). Until then, use <b>Edit</b> to change them as often as you like.',
     'Las predicciones se guardan automáticamente y <b>se cierran 30 minutos antes del inicio</b> (verificado en el servidor). Hasta entonces puedes cambiarlas con <b>Editar</b> cuantas veces quieras.'),
    ("Other people's predictions stay <b>hidden until the lock</b> (30 min before kickoff). After that they show on the match card — and you can tap any player on the leaderboard to see everything they filled in.",
     'Las predicciones de los demás permanecen <b>ocultas hasta el cierre</b> (30 min antes del inicio). Después aparecen en la tarjeta del partido, y puedes tocar a cualquier jugador en la tabla para ver todo lo que rellenó.'),
    ("Knockout matches count the score <b>after extra time</b>; penalty shootouts don't add goals. Predicting a draw in a knockout match is allowed.",
     'En eliminatorias cuenta el marcador <b>tras la prórroga</b>; la tanda de penales no suma goles. Se permite predecir empate en eliminatorias.'),
    ('Bonus picks (champion + top scorer) lock 30 minutes before the opening match.',
     'Los picks bonus (campeón + máximo goleador) se cierran 30 minutos antes del partido inaugural.'),
    ('Tiebreakers: most exact scores, then most correct results.',
     'Desempates: más marcadores exactos, luego más aciertos.'),
    ('Results come from ESPN automatically: live scores roughly every minute while you have the page open, final results within ~30 minutes.',
     'Los resultados llegan de ESPN automáticamente: marcadores en vivo aprox. cada minuto con la página abierta, resultados finales en ~30 minutos.'),
    ('<h3>Invite friends</h3>', '<h3>Invita a tus amigos</h3>'),
    ('Anyone with the link can join with just a name and a PIN:',
     'Cualquiera con el enlace puede unirse solo con un nombre y un PIN:'),
    ('id="inviteBtn2">Share invite link</button>', 'id="inviteBtn2">Compartir enlace</button>'),

    # ── join modal ──
    ('<h2>Join the pool ⚽</h2>', '<h2>Únete a la quiniela ⚽</h2>'),
    ('Pick a name and a PIN. Same name + PIN signs you back in on any device.',
     'Elige un nombre y un PIN. El mismo nombre + PIN te conecta en cualquier dispositivo.'),
    ('<label>Your name</label>', '<label>Tu nombre</label>'),
    ('placeholder="e.g. Sander"', 'placeholder="p. ej. Sander"'),
    ('<label>PIN (4–8 digits)</label>', '<label>PIN (4–8 dígitos)</label>'),
    ('id="jGo">Join / Sign in</button>', 'id="jGo">Entrar / Registrarse</button>'),
    ('id="jSkip">Just browsing for now</button>', 'id="jSkip">Solo mirar por ahora</button>'),

    # ── save modal ──
    ('<h2>Save your prediction?</h2>', '<h2>¿Guardar tu predicción?</h2>'),
    ('From now on predictions save automatically as you type. You can change them with the Edit button until 30 min before kickoff.',
     'A partir de ahora las predicciones se guardan automáticamente al escribir. Puedes cambiarlas con el botón Editar hasta 30 min antes del inicio.'),
    ('id="saveModalGo">✓ Save prediction</button>', 'id="saveModalGo">✓ Guardar predicción</button>'),
    ('id="saveModalCancel">Cancel</button>', 'id="saveModalCancel">Cancelar</button>'),

    # ── user menu ──
    ('📲 Invite friends (WhatsApp-ready)', '📲 Invitar amigos (listo para WhatsApp)'),
    ('🎯 My bonus picks', '🎯 Mis picks bonus'),
    ("🛠️ Admin: reset a player's PIN", '🛠️ Admin: restablecer el PIN de un jugador'),
    ('🛠️ Admin: set official top scorer', '🛠️ Admin: fijar máximo goleador oficial'),
    ('🚪 Sign out on this device', '🚪 Cerrar sesión en este dispositivo'),
    ('>Close</button>', '>Cerrar</button>'),

    # ── JS: separate pool — own players, predictions and leaderboard ──
    ("const POOL = 'main';", "const POOL = 'es';"),

    # ── JS: localized date formatting ──
    ("new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })",
     "new Intl.DateTimeFormat('es', { hour: '2-digit', minute: '2-digit' })"),
    ("new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' })",
     "new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long' })"),

    # ── JS: stage labels ──
    ("{ GROUP: 'Group', R32: 'Round of 32', R16: 'Round of 16', QF: 'Quarter-final', SF: 'Semi-final', THIRD: 'Third place', FINAL: 'Final' }",
     "{ GROUP: 'Grupo', R32: 'Dieciseisavos', R16: 'Octavos', QF: 'Cuartos de final', SF: 'Semifinal', THIRD: 'Tercer puesto', FINAL: 'Final' }"),
    ("`Group ${m.group || '?'}`", "`Grupo ${m.group || '?'}`"),
    ('<h3>Group ${letter}</h3>', '<h3>Grupo ${letter}</h3>'),

    # ── JS: hero ──
    ('Schedule is loading… if this persists, results will appear automatically once the feed updates.',
     'El calendario se está cargando… si esto persiste, los resultados aparecerán automáticamente cuando se actualice el feed.'),
    ('⚠️ ${unpredicted} still to predict', '⚠️ ${unpredicted} por predecir'),
    ('👋 Join to play', '👋 Únete para jugar'),
    ('+${live.length - 1} more live', '+${live.length - 1} más en vivo'),
    ('Next match · kicks off in <b>${cd}</b> · ${esc(fmtTime.format(kickoffOf(next)))} your time',
     'Próximo partido · empieza en <b>${cd}</b> · ${esc(fmtTime.format(kickoffOf(next)))} tu hora'),
    ('🏆 ${esc(champ)} are world champions!', '🏆 ¡${esc(champ)} es campeón del mundo!'),
    ('Final standings on the leaderboard.', 'Clasificación final en la pestaña Tabla.'),
    ('No upcoming matches found.', 'No hay próximos partidos.'),

    # ── JS: match list ──
    ('Nothing here with this filter.', 'Nada aquí con este filtro.'),
    ("'Schedule loading…'", "'Cargando calendario…'"),
    ('<span class="today">Today · </span>', '<span class="today">Hoy · </span>'),
    ("`Results auto-update · feed refreshed ${new Date(state.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · source: ESPN`",
     "`Resultados automáticos · feed actualizado ${new Date(state.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · fuente: ESPN`"),
    ("'Results auto-update · source: ESPN'", "'Resultados automáticos · fuente: ESPN'"),
    ('Predictions open once both teams are known.', 'Las predicciones se abren cuando se conozcan ambos equipos.'),
    ('My prediction</span>', 'Mi predicción</span>'),
    ('>Edit</button>', '>Editar</button>'),
    ("'Saving…'", "'Guardando…'"),
    ("'✓ Saved'", "'✓ Guardado'"),
    ("'Failed'", "'Falló'"),
    ('✓ Saved:', '✓ Guardado:'),
    ('Your prediction: <b>', 'Tu predicción: <b>'),
    ("You didn't predict this one", 'No predijiste este partido'),
    ("'▲ Hide'", "'▲ Ocultar'"),
    ("▼ Everyone's predictions (${list.length})", '▼ Predicciones de todos (${list.length})'),

    # ── JS: groups ──
    ('Group tables appear once the schedule loads.', 'Los grupos aparecen cuando cargue el calendario.'),
    ('<tr><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>+/−</th><th>Pts</th></tr>',
     '<tr><th>Equipo</th><th>PJ</th><th>G</th><th>E</th><th>P</th><th>+/−</th><th>Pts</th></tr>'),

    # ── JS: bonus tab ──
    ('🎯 Your bonus picks', '🎯 Tus picks bonus'),
    ('World champion = <b>+${SCORING.champion}</b> · top scorer = <b>+${SCORING.topScorer}</b>. Lock 30 min before the opening match${h != null ? ` — in ~${h}h` : \'\'}.',
     'Campeón del mundo = <b>+${SCORING.champion}</b> · máximo goleador = <b>+${SCORING.topScorer}</b>. Se cierran 30 min antes del partido inaugural${h != null ? ` — en ~${h}h` : \'\'}.'),
    ('🏆 Who wins it all?', '🏆 ¿Quién gana el Mundial?'),
    ('⚽ Top scorer (e.g. Mbappé)', '⚽ Máximo goleador (p. ej. Mbappé)'),
    ('id="finalsSave">Save</button>', 'id="finalsSave">Guardar</button>'),
    ("'Pick a champion first'", "'Primero elige un campeón'"),
    ("'Bonus picks saved 🎯'", "'Picks bonus guardados 🎯'"),
    ('🎯 Bonus picks are locked', '🎯 Los picks bonus están cerrados'),
    ("Champion <b>+${SCORING.champion}</b> · top scorer <b>+${SCORING.topScorer}</b> (a tie for most goals counts). Everyone's picks are below.",
     'Campeón <b>+${SCORING.champion}</b> · máximo goleador <b>+${SCORING.topScorer}</b> (un empate a goles cuenta). Los picks de todos están abajo.'),
    ('⚽ Golden Boot race', '⚽ Carrera por la Bota de Oro'),
    ("Everyone's bonus picks appear here once picks lock — until then they're secret.",
     'Los picks bonus de todos aparecen aquí cuando se cierren; hasta entonces son secretos.'),
    ("<h3>Everyone's picks</h3>", '<h3>Picks de todos</h3>'),
    ('Nobody made bonus picks in time.', 'Nadie hizo picks bonus a tiempo.'),

    # ── JS: player detail ──
    ('${r.total} points · ${r.exacts} exact · ${r.predicted} predictions revealed',
     '${r.total} puntos · ${r.exacts} exactos · ${r.predicted} predicciones reveladas'),
    ('no top-scorer pick', 'sin pick de goleador'),
    ('No revealed predictions yet — predictions stay hidden until 30 min before each kickoff.',
     'Aún no hay predicciones reveladas: permanecen ocultas hasta 30 min antes de cada partido.'),
    ('Their prediction on the right · predictions stay hidden until 30 min before each kickoff.',
     'Su predicción a la derecha · las predicciones permanecen ocultas hasta 30 min antes de cada partido.'),

    # ── JS: leaderboard ──
    ('Nobody has joined yet.', 'Aún no se ha unido nadie.'),
    ('Be the first — join now', 'Sé el primero — únete ya'),
    ('📲 Invite your friends', '📲 Invita a tus amigos'),
    ('<th class="nm">Player</th>', '<th class="nm">Jugador</th>'),
    ("'<th>Today</th>'", "'<th>Hoy</th>'"),
    ('<th>Exact</th><th>Preds</th>', '<th>Exactos</th><th>Preds</th>'),
    ('Tap a player to see all their predictions. Points: exact ${SCORING.exact} · goal difference ${SCORING.diff} · winner ${SCORING.outcome} · bonus picks +${SCORING.champion}/+${SCORING.topScorer} (Bonus tab). Ties: exact scores, then correct results.',
     'Toca un jugador para ver todas sus predicciones. Puntos: exacto ${SCORING.exact} · diferencia de goles ${SCORING.diff} · ganador ${SCORING.outcome} · picks bonus +${SCORING.champion}/+${SCORING.topScorer} (pestaña Bonus). Desempates: exactos, luego aciertos.'),

    # ── JS: toasts & errors ──
    ("'Fill in both scores first'", "'Primero rellena ambos marcadores'"),
    ("'Too late — predictions close 30 min before kickoff.'", "'Demasiado tarde: las predicciones se cierran 30 min antes del inicio.'"),
    ("'This match isn\\'t open for predictions yet — try again in a bit.'",
     "'Este partido aún no está abierto a predicciones; inténtalo en un momento.'"),
    ("'Couldn\\'t save — check your connection.'", "'No se pudo guardar; revisa tu conexión.'"),
    ("'Prediction saved ✓ — autosaving from now on'", "'Predicción guardada ✓ — autoguardado a partir de ahora'"),
    ("'Session expired — join again'", "'Sesión caducada; únete de nuevo'"),
    ("'That name already exists — and the PIN doesn\\'t match.'", "'Ese nombre ya existe y el PIN no coincide.'"),
    ("'Name must be 2–24 characters.'", "'El nombre debe tener 2–24 caracteres.'"),
    ("'PIN must be 4–8 digits.'", "'El PIN debe tener 4–8 dígitos.'"),
    ("'The pool is full.'", "'La quiniela está llena.'"),
    ("'Could not join — try again.'", "'No se pudo entrar; inténtalo de nuevo.'"),
    ('`Welcome back, ${r.name}!`', '`¡Hola de nuevo, ${r.name}!`'),
    ("`You're in, ${r.name}! 🎉`", '`¡Dentro, ${r.name}! 🎉`'),
    ("'Signed out on this device'", "'Sesión cerrada en este dispositivo'"),
    ("'Bonus picks locked 30 min before the opening match.'", "'Los picks bonus se cierran 30 min antes del partido inaugural.'"),
    ("'Top scorer name looks too short/long.'", "'El nombre del goleador parece demasiado corto/largo.'"),
    ("'Couldn\\'t save your picks.'", "'No se pudieron guardar tus picks.'"),
    ("'Server unreachable — predictions disabled, scores still live.'",
     "'Servidor no disponible: predicciones desactivadas, los marcadores siguen en vivo.'"),

    # ── JS: user chip / menu / admin ──
    ("b.textContent = 'Join';", "b.textContent = 'Únete';"),
    ("'Pool admin'", "'Admin de la quiniela'"),
    ("'Pool member'", "'Miembro de la quiniela'"),
    ("'Player name to reset:'", "'Nombre del jugador a restablecer:'"),
    ('`New PIN for ${who} (4–8 digits):`', '`Nuevo PIN para ${who} (4–8 dígitos):`'),
    ('`PIN reset for ${who}`', '`PIN restablecido para ${who}`'),
    ("'Official top scorer (only needed if the automatic result is wrong/missing; comma-separate ties):'",
     "'Máximo goleador oficial (solo si el resultado automático falta o es erróneo; separa empates con comas):'"),
    ("'Official top scorer saved'", "'Máximo goleador oficial guardado'"),

    # ── JS: invite ──
    ('⚽ World Cup 2026 predictions pool — predict every match, live leaderboard, winner takes the glory. Join here: ${POOL_URL}',
     '⚽ Quiniela del Mundial 2026 — predice cada partido, tabla en vivo, el ganador se lleva la gloria. Únete aquí: ${POOL_URL}'),
]


def main():
    src = SRC.read_text(encoding="utf-8")
    out = src
    missing = []
    for en, es in TRANSLATIONS:
        if en not in out:
            missing.append(en)
            continue
        out = out.replace(en, es)
    OUT.write_text(out, encoding="utf-8")
    for m in missing:
        print(f"WARN: source string not found (stays English): {m[:90]}")
    print(f"OK: wrote {OUT.name} — {len(TRANSLATIONS) - len(missing)}/{len(TRANSLATIONS)} strings translated")
    return 0


if __name__ == "__main__":
    sys.exit(main())
