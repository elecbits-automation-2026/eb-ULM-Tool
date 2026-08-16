import { createClient } from "@supabase/supabase-js";
import { tbl, withLayoutRetry } from "./tables.js";

/* ─── SUPABASE CLIENT ─────────────────────────────────────────────────────────
   Robust init: auto-repair the most common env-var mistakes (surrounding
   quotes, whitespace, trailing slash, the dashboard URL instead of the API URL,
   a missing protocol). If the client still can't start, we DON'T silently drop
   to demo — App.jsx shows an on-screen diagnostic naming the problem.          */

function stripWrap(v) {
  return String(v || "").trim().replace(/^["']+|["']+$/g, "").trim();
}
function sanitizeUrl(raw) {
  let u = stripWrap(raw);
  if (!u) return "";
  // Someone pasted the dashboard link → derive the API URL from the ref.
  const dash = u.match(/supabase\.com\/dashboard\/project\/([a-z0-9]+)/i);
  if (dash) return `https://${dash[1]}.supabase.co`;
  if (!/^https?:\/\//i.test(u)) u = "https://" + u; // add missing protocol
  u = u.replace(/\/+$/, ""); // strip trailing slash(es)
  return u;
}

const rawUrl = import.meta.env.VITE_SUPABASE_URL;
const rawKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const url = sanitizeUrl(rawUrl);
const anonKey = stripWrap(rawKey);

// The user intended to use Supabase if either var is present at all.
export const supabaseConfigured = Boolean(stripWrap(rawUrl) || stripWrap(rawKey));
export const supabaseUrl = url;

let client = null;
let initError = "";
if (url && anonKey) {
  try {
    client = createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
  } catch (e) {
    initError = e?.message || String(e);
    // eslint-disable-next-line no-console
    console.error("[Supabase] Could not initialise:", initError, "(URL used:", url + ")");
  }
} else if (supabaseConfigured) {
  const missing = [];
  if (!url) missing.push("VITE_SUPABASE_URL");
  if (!anonKey) missing.push("VITE_SUPABASE_ANON_KEY");
  initError = `Missing or empty: ${missing.join(" and ")}`;
}

export const supabase = client;
export const supabaseAnonKey = anonKey;
export const supabaseEnabled = Boolean(client);
export const supabaseInitError = initError;

/* Key-value store for the workspace blob. Lives in `pms.workspace` after the
   schema split, `public.app_kv` before it — withLayoutRetry finds out which
   this database is and goes there, so the app works on either, and keeps
   working if the migration runs (or is rolled back) mid-session. */
export function supabaseStorage(sb) {
  return {
    get: async (key) => {
      const { data, error } = await withLayoutRetry(sb, () =>
        tbl(sb, "workspace").select("value").eq("key", key).maybeSingle());
      if (error) throw error;
      return data ? { value: data.value } : null;
    },
    set: async (key, value) => {
      const { error } = await withLayoutRetry(sb, () =>
        tbl(sb, "workspace").upsert({ key, value, updated_at: new Date().toISOString() }));
      if (error) throw error;
    },
    delete: async (key) => {
      const { error } = await withLayoutRetry(sb, () =>
        tbl(sb, "workspace").delete().eq("key", key));
      if (error) throw error;
    },
  };
}
