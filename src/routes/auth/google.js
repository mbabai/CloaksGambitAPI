const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const User = require('../../models/User');

const router = express.Router();

const scopes = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile'
];

router.get('/google', (req, res) => {
  const redirectUri = `${req.protocol}://${req.get('host')}/api/auth/google/callback`;
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes.join(' '),
    access_type: 'offline',
    prompt: 'consent'
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

router.get('/google/callback', async (req, res) => {
  const code = req.query.code;
  if (!code) {
    return res.status(400).json({ message: 'Missing authorization code' });
  }

  try {
    const redirectUri = `${req.protocol}://${req.get('host')}/api/auth/google/callback`;
    const client = new OAuth2Client(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      redirectUri
    );

    const { tokens } = await client.getToken(code);
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();
    const email = payload.email;
    const photoUrl = payload.picture;

    let user = await User.findOne({ email });
    if (!user) {
      user = await User.create({ username: email, email, photoUrl });
    } else {
      user.photoUrl = photoUrl;
      await user.save();
    }

    res.json({ id: user._id, email: user.email, photoUrl: user.photoUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Authentication failed' });
  }
});

module.exports = router;
