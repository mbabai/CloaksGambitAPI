const express = require('express');
const router = express.Router();
const { fetchMatchList } = require('../../../services/matches/activeMatches');

async function handleGetList(req, res) {
  try {
    const source = req.method === 'GET' ? req.query : req.body;
    const payload = (source && typeof source === 'object') ? source : {};

    const rawUserId = Array.isArray(payload.userId) ? payload.userId[0] : payload.userId;
    const rawStatus = Array.isArray(payload.status) ? payload.status[0] : payload.status;
    const rawIncludeUsers = Array.isArray(payload.includeUsers)
      ? payload.includeUsers[payload.includeUsers.length - 1]
      : payload.includeUsers;
    const rawPage = Array.isArray(payload.page) ? payload.page[0] : payload.page;
    const rawType = Array.isArray(payload.type) ? payload.type[0] : payload.type;
    const rawLimit = Array.isArray(payload.limit) ? payload.limit[0] : payload.limit;

    const includeUserDetails = typeof rawIncludeUsers === 'string'
      ? rawIncludeUsers.trim().toLowerCase() === 'true'
      : Boolean(rawIncludeUsers);
    const normalizedUserId = typeof rawUserId === 'string' ? rawUserId.trim() : rawUserId;
    const normalizedStatus = typeof rawStatus === 'string' ? rawStatus.trim() : rawStatus;
    const normalizedPage = typeof rawPage === 'string' ? rawPage.trim() : rawPage;
    const normalizedType = typeof rawType === 'string' ? rawType.trim() : rawType;
    const normalizedLimit = typeof rawLimit === 'string' ? rawLimit.trim() : rawLimit;

    const matches = await fetchMatchList({
      status: normalizedStatus,
      userId: normalizedUserId,
      includeUsers: includeUserDetails,
      limit: normalizedLimit,
      page: normalizedPage,
      type: normalizedType,
    });

    res.json(matches);
  } catch (err) {
    console.error('Failed to fetch match list:', err);
    res.status(500).json({ message: err?.message || 'Failed to load matches' });
  }
}

router.post('/', handleGetList);
router.get('/', handleGetList);

module.exports = router; 
