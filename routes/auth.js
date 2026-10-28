const express = require('express');
const router = express.Router();
const db = require('../db');
const supabaseAuth = require('../supabaseAuth');

function serializeUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    points: user.points,
    instagram_username: user.instagram_username,
    youtube_handle: user.youtube_handle,
    linkedin_profile: user.linkedin_profile,
    facebook_profile: user.facebook_profile,
    facebook_display_name: user.facebook_display_name
  };
}

router.post('/login', async (req, res) => {
  const email = typeof req.body.email === 'string' ? req.body.email.toLowerCase().trim() : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    const { data, error } = await supabaseAuth.auth.signInWithPassword({ email, password });
    if (error || !data.user || !data.session) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const result = await db.query(
      'SELECT * FROM users WHERE supabase_user_id = $1',
      [data.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(403).json({ error: 'Your Supabase account is not linked to a Vinculo profile.' });
    }

    res.json({
      message: 'Login successful.',
      token: data.session.access_token,
      user: serializeUser(result.rows[0])
    });
  } catch (error) {
    console.error('Supabase login error:', error);
    res.status(500).json({ error: 'An error occurred during login. Please try again.' });
  }
});

router.post('/register', async (req, res) => {
  const {
    name,
    email,
    password,
    instagram_username,
    youtube_handle,
    linkedin_profile,
    facebook_profile,
    facebook_display_name
  } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'All fields (Full Name, Email Address, Password) are required.' });
  }

  const trimmedName = String(name).trim();
  const trimmedEmail = String(email).toLowerCase().trim();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (trimmedName.length < 2) {
    return res.status(400).json({ error: 'Name must be at least 2 characters long.' });
  }
  if (!emailRegex.test(trimmedEmail)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
  }

  try {
    const existing = await db.query('SELECT 1 FROM users WHERE email = $1', [trimmedEmail]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'An account with this email address already exists.' });
    }

    const { data, error } = await supabaseAuth.auth.signUp({
      email: trimmedEmail,
      password,
      options: { data: { name: trimmedName, role: 'Student' } }
    });
    if (error || !data.user) {
      return res.status(400).json({ error: error?.message || 'Supabase registration failed.' });
    }

    const result = await db.query(
      `INSERT INTO users (
         name, email, password_hash, supabase_user_id, role, points,
         instagram_username, youtube_handle, linkedin_profile,
         facebook_profile, facebook_display_name
       )
       VALUES ($1, $2, NULL, $3, 'Student', 0, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        trimmedName,
        trimmedEmail,
        data.user.id,
        instagram_username ? String(instagram_username).trim() : null,
        youtube_handle ? String(youtube_handle).trim() : null,
        linkedin_profile ? String(linkedin_profile).trim() : null,
        facebook_profile ? String(facebook_profile).trim() : null,
        facebook_display_name ? String(facebook_display_name).trim() : null
      ]
    );

    res.status(201).json({
      message: data.session
        ? 'Registration successful.'
        : 'Registration successful. Check your email to confirm your account.',
      token: data.session?.access_token || null,
      user: serializeUser(result.rows[0]),
      requiresEmailConfirmation: !data.session
    });
  } catch (error) {
    console.error('Supabase registration error:', error);
    res.status(500).json({ error: 'An error occurred during registration. Please try again.' });
  }
});

module.exports = router;
