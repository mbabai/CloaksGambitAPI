const express = require('express');
const router = express.Router();
const { resolveSessionFromRequest } = require('../../../utils/requestSession');
const { ensureAdminRequest } = require('../../../utils/adminAccess');
const eventBus = require('../../../eventBus');
const {
  isTournamentTestModeEnabled,
  listLiveTournaments,
  consumeTournamentAlerts,
  getTournamentClientState,
  getCurrentTournamentForSession,
  createTournament,
  updateTournamentConfig,
  joinTournamentAsPlayer,
  joinTournamentAsViewer,
  leaveTournament,
  cancelTournament,
  addBotToTournament,
  kickTournamentPlayer,
  reallowTournamentPlayer,
  startTournament,
  startElimination,
  transferTournamentHost,
  updateTournamentMessage,
  listAllTournamentsForAdmin,
  deleteTournamentForAdmin,
  getTournamentBotDifficultyOptions,
} = require('../../../services/tournaments/liveTournaments');

const LOGIN_REQUIRED_MESSAGE = 'Log in to participate in tournaments.';

async function resolveTournamentSession(req) {
  return resolveSessionFromRequest(req, { createGuest: true });
}

function assertParticipationAllowed(session) {
  if (!session?.userId) {
    const err = new Error(LOGIN_REQUIRED_MESSAGE);
    err.statusCode = 401;
    throw err;
  }

  if (session.isGuest && !isTournamentTestModeEnabled()) {
    const err = new Error(LOGIN_REQUIRED_MESSAGE);
    err.statusCode = 403;
    throw err;
  }
}

function handleRouteError(res, err) {
  const status = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
  return res.status(status).json({ message: err?.message || 'Tournament request failed.' });
}

router.get('/', async (req, res) => {
  try {
    const session = await resolveSessionFromRequest(req, { createGuest: false });
    return res.json({
      testModeEnabled: isTournamentTestModeEnabled(),
      tournaments: await listLiveTournaments({ session }),
      alerts: consumeTournamentAlerts(session?.userId),
      botDifficultyOptions: getTournamentBotDifficultyOptions(),
    });
  } catch (err) {
    return handleRouteError(res, err);
  }
});

router.get('/test-mode', (req, res) => {
  return res.json({ enabled: isTournamentTestModeEnabled() });
});

router.get('/current', async (req, res) => {
  try {
    const session = await resolveSessionFromRequest(req, { createGuest: false });
    return res.json(await getCurrentTournamentForSession({ session }));
  } catch (err) {
    return handleRouteError(res, err);
  }
});

router.post('/create', async (req, res) => {
  try {
    const session = await resolveTournamentSession(req);
    assertParticipationAllowed(session);

    const tournament = await createTournament({
      hostSession: session,
      label: req.body?.label,
      config: req.body?.config || {},
    });

    return res.json({
      tournament,
      testModeEnabled: isTournamentTestModeEnabled(),
    });
  } catch (err) {
    return handleRouteError(res, err);
  }
});

router.post('/config', async (req, res) => {
  try {
    const session = await resolveTournamentSession(req);
    assertParticipationAllowed(session);

    const tournament = await updateTournamentConfig({
      tournamentId: req.body?.tournamentId,
      session,
      config: req.body?.config || {},
    });

    return res.json({ tournament });
  } catch (err) {
    return handleRouteError(res, err);
  }
});

router.post('/join', async (req, res) => {
  try {
    const session = await resolveTournamentSession(req);
    assertParticipationAllowed(session);

    const tournamentId = req.body?.tournamentId;
    const role = String(req.body?.role || 'player').toLowerCase();
    const tournament = role === 'viewer'
      ? await joinTournamentAsViewer({ tournamentId, session })
      : await joinTournamentAsPlayer({ tournamentId, session });

    return res.json({ tournament });
  } catch (err) {
    return handleRouteError(res, err);
  }
});

router.post('/leave', async (req, res) => {
  try {
    const session = await resolveTournamentSession(req);
    assertParticipationAllowed(session);
    const tournament = await leaveTournament({ tournamentId: req.body?.tournamentId, session });
    return res.json({ tournament });
  } catch (err) {
    return handleRouteError(res, err);
  }
});

router.post('/cancel', async (req, res) => {
  try {
    const session = await resolveTournamentSession(req);
    assertParticipationAllowed(session);
    const tournament = await cancelTournament({ tournamentId: req.body?.tournamentId, session });
    return res.json({ tournament });
  } catch (err) {
    return handleRouteError(res, err);
  }
});

router.post('/add-bot', async (req, res) => {
  try {
    const session = await resolveTournamentSession(req);
    assertParticipationAllowed(session);
    const tournament = await addBotToTournament({
      tournamentId: req.body?.tournamentId,
      session,
      botName: req.body?.name,
      difficulty: req.body?.difficulty,
    });
    return res.json({ tournament });
  } catch (err) {
    return handleRouteError(res, err);
  }
});

router.post('/start', async (req, res) => {
  try {
    const session = await resolveTournamentSession(req);
    assertParticipationAllowed(session);
    const tournament = await startTournament({ tournamentId: req.body?.tournamentId, session });
    eventBus.emit('adminRefresh');
    return res.json({ tournament });
  } catch (err) {
    return handleRouteError(res, err);
  }
});

router.post('/start-elimination', async (req, res) => {
  try {
    const session = await resolveTournamentSession(req);
    assertParticipationAllowed(session);
    const tournament = await startElimination({ tournamentId: req.body?.tournamentId, session });
    eventBus.emit('adminRefresh');
    return res.json({ tournament });
  } catch (err) {
    return handleRouteError(res, err);
  }
});

router.post('/transfer-host', async (req, res) => {
  try {
    const session = await resolveTournamentSession(req);
    assertParticipationAllowed(session);
    const tournament = await transferTournamentHost({
      tournamentId: req.body?.tournamentId,
      session,
      targetUserId: req.body?.userId,
    });
    return res.json({ tournament });
  } catch (err) {
    return handleRouteError(res, err);
  }
});

router.post('/message', async (req, res) => {
  try {
    const session = await resolveTournamentSession(req);
    assertParticipationAllowed(session);
    const tournament = await updateTournamentMessage({
      tournamentId: req.body?.tournamentId,
      session,
      message: req.body?.message,
    });
    return res.json({ tournament });
  } catch (err) {
    return handleRouteError(res, err);
  }
});

router.post('/kick-player', async (req, res) => {
  try {
    const session = await resolveTournamentSession(req);
    assertParticipationAllowed(session);
    const tournament = await kickTournamentPlayer({
      tournamentId: req.body?.tournamentId,
      session,
      targetUserId: req.body?.userId,
    });
    return res.json({ tournament });
  } catch (err) {
    return handleRouteError(res, err);
  }
});

router.post('/reallow-player', async (req, res) => {
  try {
    const session = await resolveTournamentSession(req);
    assertParticipationAllowed(session);
    const tournament = await reallowTournamentPlayer({
      tournamentId: req.body?.tournamentId,
      session,
      targetUserId: req.body?.userId,
    });
    return res.json({ tournament });
  } catch (err) {
    return handleRouteError(res, err);
  }
});

router.post('/details', async (req, res) => {
  try {
    const session = await resolveTournamentSession(req);
    if (!session?.userId) {
      const err = new Error(LOGIN_REQUIRED_MESSAGE);
      err.statusCode = 401;
      throw err;
    }

    return res.json(await getTournamentClientState(req.body?.tournamentId, { session }));
  } catch (err) {
    return handleRouteError(res, err);
  }
});

router.get('/admin/list', async (req, res) => {
  try {
    const adminSession = await ensureAdminRequest(req, res);
    if (!adminSession) return;
    const tournaments = await listAllTournamentsForAdmin();
    return res.json({ tournaments });
  } catch (err) {
    return handleRouteError(res, err);
  }
});

router.post('/admin/delete', async (req, res) => {
  try {
    const adminSession = await ensureAdminRequest(req, res);
    if (!adminSession) return;
    const result = await deleteTournamentForAdmin(req.body?.tournamentId);
    eventBus.emit('adminRefresh');
    return res.json(result);
  } catch (err) {
    return handleRouteError(res, err);
  }
});

module.exports = router;
