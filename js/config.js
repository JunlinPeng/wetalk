/* ============================================================
   Wetalk - public runtime configuration

   This file is SAFE TO COMMIT. Only public values belong here:
   the Supabase URL + anon (public) key, and the URL of the AI
   feedback Edge Function. NEVER put a service-role key or an
   AI provider API key in this file.

   Live project: Wetalk (Supabase, free tier).
   Connected: 2026-11-06.
   Full setup guide: docs/SUPABASE_SETUP.md
   ============================================================ */
window.WETALK_CONFIG = {
  // Supabase project URL (no trailing slash, no /rest/v1/)
  supabaseUrl: "https://efhprhfonzgmpwzkzjup.supabase.co",
  // Public "publishable" / anon key from Supabase Project Settings > API
  supabaseAnonKey: "sb_publishable_RmgoWbrsIOGNI944m58Kiw_SrrmKyEn",
  // Deployed AI feedback Edge Function URL (empty until the proxy is deployed)
  aiProxyUrl: "",
  // Optional canonical site URL used for auth redirects.
  // Defaults to the page origin at runtime.
  siteUrl: ""
};
