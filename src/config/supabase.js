const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws'); // <-- FIX FOR NODE 20
const dotenv = require('dotenv');

dotenv.config();

// WebSocket global assignment for Supabase client in Node
global.WebSocket = WebSocket;

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.warn('⚠️ Supabase xatosi: SUPABASE_URL yoki SUPABASE_SERVICE_ROLE_KEY .env faylida topilmadi.');
}

// Ensure dummy defaults if env variables are missing during local init (to avoid app crash)
const supabase = createClient(
  supabaseUrl || 'https://example.supabase.co', 
  supabaseKey || 'public-anon-key'
);

module.exports = supabase;
