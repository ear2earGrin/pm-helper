// ============================================================
//  Redesign Studio — shared Supabase client
//  Used by login.html and dashboard.html
// ============================================================
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// Public project URL + anon key. The anon key is meant to be public;
// all data is protected by Row-Level Security (only signed-in partners
// can read/write the pmh_ tables).
export const SUPABASE_URL = 'https://wtzrxscdlqdgdiefsmru.supabase.co';
export const SUPABASE_ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind0enJ4c2NkbHFkZ2RpZWZzbXJ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2OTI4MjcsImV4cCI6MjA4OTI2ODgyN30.dLheIKz9anuM58O3Ebsr2rVCOGA-xBGRD9voiXNvIcg';

// Usernames sign in as <username>@pm-helper.app under the hood.
export const EMAIL_DOMAIN = '@pm-helper.app';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'pmh-auth' },
});

// Convenience: the current signed-in username (without the domain), or null.
export async function currentUsername() {
  const { data } = await supabase.auth.getSession();
  const email = data?.session?.user?.email || '';
  if (!email) return null;
  const meta = data.session.user.user_metadata || {};
  return meta.username || email.replace(EMAIL_DOMAIN, '');
}
