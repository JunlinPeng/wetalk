// ============================================================
// Wetalk - AI feedback Edge Function (Supabase / Deno)
//
// POST /functions/v1/ai-feedback
//   Authorization: Bearer <Supabase user access token>
//   apikey:        <public anon key>
//   body:          { messages: [{role, content}], temperature?, max_tokens? }
//   response:      { content: string, remaining: number, limit: number }
//   errors:        { error: "quota_exceeded" | "no_key" | "upstream" | "bad_request" | "unauthorized" }
//
// Flow:
//   1. Verify the caller JWT with supabase-js + the anon key -> 401 otherwise.
//   2. Validate the payload (<= 12000 input characters, max_tokens <= 1200,
//      temperature <= 0.7) -> 400/413 otherwise.
//   3. Read the caller's row in public.ai_usage for the current UTC day; if the
//      daily limit is reached -> 429 quota_exceeded (the AI is never called).
//   4. Call DeepSeek with the server-side DEEPSEEK_API_KEY -> 502 on failure.
//   5. Count the successful call exactly once (optimistic-concurrency update on
//      public.ai_usage), then return the content + remaining quota.
//
// Auto-provided env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
// Required secret:   DEEPSEEK_API_KEY
// Optional secret:   DAILY_AI_LIMIT (default 20 per user per day)
//                    GLOBAL_DAILY_LIMIT (default 500 across all users per day;
//                    caps the owner's AI bill if the site gets popular)
//
// Deploy notes: docs/AI_PROXY_SETUP.md
// ============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";
const DEEPSEEK_MODEL = "deepseek-chat";
const USAGE_TABLE = "ai_usage";

const MAX_INPUT_CHARS = 12000;
const MAX_TOKENS_CAP = 1200;
const MAX_TEMPERATURE = 0.7;
const MAX_MESSAGES = 50;
const DEFAULT_DAILY_LIMIT = 20;
const DEFAULT_GLOBAL_DAILY_LIMIT = 500;
const DEEPSEEK_TIMEOUT_MS = 45000;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" },
  });
}

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

function readDailyLimit(): number {
  const raw = Deno.env.get("DAILY_AI_LIMIT");
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n) || n < 1) return DEFAULT_DAILY_LIMIT;
  return Math.min(n, 10000);
}

function readGlobalDailyLimit(): number {
  const raw = Deno.env.get("GLOBAL_DAILY_LIMIT");
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n) || n < 1) return DEFAULT_GLOBAL_DAILY_LIMIT;
  return Math.min(n, 1000000);
}

function clampNumber(value: number, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function sanitizeMessages(input: unknown): ChatMessage[] | null {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_MESSAGES) return null;
  const out: ChatMessage[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") return null;
    const role = (item as Record<string, unknown>).role;
    const content = (item as Record<string, unknown>).content;
    if (role !== "system" && role !== "user" && role !== "assistant") return null;
    if (typeof content !== "string" || content.trim().length === 0) return null;
    out.push({ role, content });
  }
  return out;
}

function estimateTokens(...parts: string[]): number {
  // Rough accounting only: ~4 characters per token. Used for usage stats.
  const chars = parts.reduce((n, p) => n + (p ? p.length : 0), 0);
  return Math.max(1, Math.round(chars / 4));
}

// ---------- quota accounting ----------

type SupabaseClient = ReturnType<typeof createClient>;

async function readUsage(
  admin: SupabaseClient,
  userId: string,
  day: string,
): Promise<{ requests: number; tokens: number } | null> {
  const { data, error } = await admin
    .from(USAGE_TABLE)
    .select("requests,tokens")
    .eq("user_id", userId)
    .eq("day", day)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    requests: Number((data as Record<string, unknown>).requests) || 0,
    tokens: Number((data as Record<string, unknown>).tokens) || 0,
  };
}

/**
 * Increment the caller's counter for the given day exactly once and return
 * the new request count. Uses a compare-and-set update (WHERE requests =
 * the value we read) so two concurrent requests cannot both count the same
 * row; a lost race is retried with fresh values instead of double-counting.
 */
/** Total AI requests made by everybody on the given UTC day. */
async function readGlobalUsage(admin: SupabaseClient, day: string): Promise<number> {
  const { data, error } = await admin
    .from(USAGE_TABLE)
    .select("requests")
    .eq("day", day);
  if (error) throw error;
  return (data || []).reduce((total: number, row: unknown) => {
    return total + (Number((row as Record<string, unknown>).requests) || 0);
  }, 0);
}

async function incrementUsage(
  admin: SupabaseClient,
  userId: string,
  day: string,
  tokens: number,
): Promise<number> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await readUsage(admin, userId, day);

    if (!current) {
      const { data, error } = await admin
        .from(USAGE_TABLE)
        .insert({ user_id: userId, day, requests: 1, tokens })
        .select("requests")
        .maybeSingle();
      if (!error) {
        const inserted = data ? Number((data as Record<string, unknown>).requests) : NaN;
        return Number.isFinite(inserted) ? inserted : 1;
      }
      // 23505 = unique violation: another request inserted the row first.
      const code = (error as { code?: string }).code;
      if (code !== "23505") throw error;
      continue;
    }

    const nextRequests = current.requests + 1;
    const { data, error } = await admin
      .from(USAGE_TABLE)
      .update({ requests: nextRequests, tokens: current.tokens + tokens })
      .eq("user_id", userId)
      .eq("day", day)
      .eq("requests", current.requests)
      .select("requests")
      .maybeSingle();
    if (error) throw error;
    if (data) {
      const updated = Number((data as Record<string, unknown>).requests);
      return Number.isFinite(updated) ? updated : nextRequests;
    }
    // Someone else updated the same row between read and write; retry.
  }

  // Could not win the CAS race: report the value we can read, but never
  // increment a row we did not successfully claim.
  const fallback = await readUsage(admin, userId, day);
  return fallback ? fallback.requests : 1;
}

// ---------- handler ----------

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ error: "bad_request", message: "Use POST." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    console.error("Missing SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY");
    return json({ error: "upstream", message: "The AI proxy is not configured on the server." }, 500);
  }

  // 1. Verify the caller's Supabase session.
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return json({ error: "unauthorized", message: "Missing Authorization bearer token." }, 401);
  }
  const accessToken = authHeader.slice(7).trim();
  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  // Pass the JWT explicitly: the anon client has no session storage here.
  const { data: userData, error: userError } = await userClient.auth.getUser(accessToken);
  const user = userData?.user;
  if (userError || !user) {
    return json({ error: "unauthorized", message: "Invalid or expired session - sign in again." }, 401);
  }

  // 2. Parse and validate the request.
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "bad_request", message: "Body must be JSON." }, 400);
  }
  if (!body || typeof body !== "object") {
    return json({ error: "bad_request", message: "Body must be a JSON object." }, 400);
  }

  const messages = sanitizeMessages(body.messages);
  if (!messages) {
    return json({ error: "bad_request", message: "messages must be a non-empty array of {role, content}." }, 400);
  }

  const inputChars = messages.reduce((n, m) => n + m.content.length, 0);
  if (inputChars > MAX_INPUT_CHARS) {
    return json({
      error: "bad_request",
      message: "Input too long: " + inputChars + " characters (max " + MAX_INPUT_CHARS + ").",
    }, 413);
  }

  const temperature = clampNumber(Number(body.temperature), 0.7, 0, MAX_TEMPERATURE);
  const maxTokens = Math.round(clampNumber(Number(body.max_tokens), MAX_TOKENS_CAP, 1, MAX_TOKENS_CAP));

  const deepseekKey = Deno.env.get("DEEPSEEK_API_KEY") ?? "";
  if (!deepseekKey) {
    console.error("DEEPSEEK_API_KEY is not set");
    return json({ error: "no_key", message: "The AI provider key is not configured on the server." }, 503);
  }

  const dailyLimit = readDailyLimit();
  const day = todayUTC();
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 3. Quota check (one successful answer = one request).
  let usage: { requests: number; tokens: number } | null = null;
  try {
    usage = await readUsage(admin, user.id, day);
  } catch (err) {
    console.error("Could not read ai_usage", err);
    return json({ error: "upstream", message: "The usage store is unavailable." }, 500);
  }
  const used = usage ? usage.requests : 0;
  if (used >= dailyLimit) {
    return json({
      error: "quota_exceeded",
      message: "Daily AI limit reached - using offline scoring.",
      limit: dailyLimit,
      remaining: 0,
    }, 429);
  }

  // Global cap: protects the owner's AI bill when the site gets popular.
  const globalLimit = readGlobalDailyLimit();
  let globalUsed = 0;
  try {
    globalUsed = await readGlobalUsage(admin, day);
  } catch (err) {
    console.error("Could not read global ai_usage", err);
    return json({ error: "upstream", message: "The usage store is unavailable." }, 500);
  }
  if (globalUsed >= globalLimit) {
    return json({
      error: "quota_exceeded",
      message: "The shared daily AI limit has been reached - using offline scoring.",
      limit: dailyLimit,
      remaining: Math.max(0, dailyLimit - used),
      global_limit: globalLimit,
    }, 429);
  }

  // 4. Call DeepSeek.
  let content = "";
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEEPSEEK_TIMEOUT_MS);
    let aiResponse: Response | null = null;
    try {
      aiResponse = await fetch(DEEPSEEK_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + deepseekKey,
        },
        body: JSON.stringify({
          model: DEEPSEEK_MODEL,
          messages,
          temperature,
          max_tokens: maxTokens,
          stream: false,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!aiResponse || !aiResponse.ok) {
      const status = aiResponse ? aiResponse.status : 0;
      const detail = aiResponse ? await aiResponse.text().catch(() => "") : "";
      console.error("DeepSeek error", status, detail.slice(0, 500));
      return json({ error: "upstream", message: "The AI provider returned an error (" + status + ")." }, 502);
    }

    const aiData = await aiResponse.json();
    content = aiData?.choices?.[0]?.message?.content ?? "";
  } catch (err) {
    console.error("DeepSeek request failed", err);
    return json({ error: "upstream", message: "The AI provider is unreachable right now." }, 502);
  }

  if (typeof content !== "string" || !content.trim()) {
    return json({ error: "upstream", message: "The AI provider returned an empty answer." }, 502);
  }

  // 5. Count the successful call once; never fail the answer on a bookkeeping error.
  let newRequests = used + 1;
  try {
    const inputText = messages.map((m) => m.content).join("\n");
    newRequests = await incrementUsage(admin, user.id, day, estimateTokens(inputText, content));
  } catch (err) {
    console.error("Could not update ai_usage", err);
  }

  const remaining = Math.max(0, dailyLimit - newRequests);
  return json({ content, remaining, limit: dailyLimit });
});
