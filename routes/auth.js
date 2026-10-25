const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { jwtSecret } = require('../config');

// User Login (Admin & Student)
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    const result = await db.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase().trim()]);
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const user = result.rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // Sign JWT
    const token = jwt.sign(
      { id: user.id, name: user.name, email: user.email, role: user.role },
      jwtSecret,
      { expiresIn: '24h' }
    );

    res.json({
      message: 'Login successful.',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        points: user.points
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'An error occurred during login. Please try again.' });
  }
});

// Student Self-Registration
router.post('/register', async (req, res) => {
  const { name, email, password, instagram_username, youtube_handle, linkedin_profile, facebook_profile, facebook_display_name } = req.body;

  // 1. Validation
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'All fields (Full Name, Email Address, Password) are required.' });
  }

  const trimmedName = name.trim();
  const trimmedEmail = email.toLowerCase().trim();
  const trimmedPassword = password;

  if (trimmedName.length < 2) {
    return res.status(400).json({ error: 'Name must be at least 2 characters long.' });
  }

  // Email format validation regex
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(trimmedEmail)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  if (trimmedPassword.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
  }

  try {
    // 2. Check if email already exists
    const emailCheckResult = await db.query('SELECT 1 FROM users WHERE email = $1', [trimmedEmail]);
    if (emailCheckResult.rows.length > 0) {
      return res.status(400).json({ error: 'An account with this email address already exists.' });
    }

    // 3. Hash password using bcryptjs
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(trimmedPassword, salt);

    // 4. Create new user record
    const insertQuery = `
      INSERT INTO users (name, email, password_hash, role, points, instagram_username, youtube_handle, linkedin_profile, facebook_profile, facebook_display_name)
      VALUES ($1, $2, $3, 'Student', 0, $4, $5, $6, $7, $8)
      RETURNING id, name, email, role, points, instagram_username, youtube_handle, linkedin_profile, facebook_profile, facebook_display_name
    `;
    const result = await db.query(insertQuery, [
      trimmedName, 
      trimmedEmail, 
      passwordHash,
      instagram_username ? instagram_username.trim() : null,
      youtube_handle ? youtube_handle.trim() : null,
      linkedin_profile ? linkedin_profile.trim() : null,
      facebook_profile ? facebook_profile.trim() : null,
      facebook_display_name ? facebook_display_name.trim() : null
    ]);

    res.status(201).json({
      message: 'Registration successful. You can now sign in.',
      user: result.rows[0]
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'An error occurred during registration. Please try again.' });
  }
});

module.exports = router;
