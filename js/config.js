/* ============================================================
   Wetalk - public runtime configuration

   This file is SAFE TO COMMIT. Only public values belong here:
   the Supabase URL + anon (public) key, and the URL of the AI
   feedback Edge Function. NEVER put a service-role key or an
   AI provider API key in this file.

   Leave the values empty to run Wetalk in Preview mode:
   accounts and works are stored in the visitor's browser only.

   Full setup guide: docs/SUPABASE_SETUP.md
   ============================================================ */
window.WETALK_CONFIG = {
  // Example: "https://abcdefghijklmnop.supabase.co"
  supabaseUrl: "",
  // The public "anon" key from Supabase Project Settings > API
  supabaseAnonKey: "",
  // Example: "https://abcdefghijklmnop.supabase.co/functions/v1/ai-feedback"
  aiProxyUrl: "",
  // Optional: canonical site URL used for auth redirects.
  // Defaults to the page origin at runtime.
  siteUrl: ""
};
