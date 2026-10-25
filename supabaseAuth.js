const { createClient } = require('@supabase/supabase-js');
const { supabaseUrl, supabasePublishableKey } = require('./config');

const supabaseAuth = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

module.exports = supabaseAuth;
