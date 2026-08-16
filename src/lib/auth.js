import { tbl, withLayoutRetry } from "./tables.js";
import { supabase } from "./supabase.js";

/* ─── AUTH ─────────────────────────────────────────────────────────────────────
   Thin wrapper over Supabase Auth. Only meaningful when Supabase is configured;
   App.jsx guards every call behind `supabaseEnabled`, so the demo mode (no env)
   never touches these.                                                          */

export async function getSession() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export function onAuthChange(cb) {
  if (!supabase) return { unsubscribe() {} };
  const { data } = supabase.auth.onAuthStateChange((event, session) => cb(session, event));
  return data.subscription;
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signUp(email, password, name) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { name } },
  });
  if (error) throw error;
  return data;
}

/* A reset or confirmation link can come back refusing to work — most often
   because it has already been used or has timed out. Supabase says so in the
   URL fragment, where nobody reads it; without this the person lands on a
   blank login page with a frightening address bar and no idea what happened. */
export function authReturnError() {
  if (typeof window === "undefined") return "";
  const read = (str) => new URLSearchParams(str.replace(/^[#?]/, ""));
  const frag = read(window.location.hash), query = read(window.location.search);
  const code = frag.get("error_code") || query.get("error_code") || frag.get("error") || query.get("error");
  if (!code) return "";
  const desc = (frag.get("error_description") || query.get("error_description") || "").replace(/\+/g, " ");
  // clear it, or it reappears on every reload of this tab
  try { window.history.replaceState({}, "", window.location.pathname); } catch { /* ignore */ }
  if (/otp_expired|expired/i.test(`${code} ${desc}`))
    return "That link has expired — they are one-time and short-lived. Put your email in below and send yourself a fresh one.";
  if (/access_denied/i.test(code))
    return "That link is no longer valid — it may already have been used. Send yourself a fresh one below.";
  return desc || "That link didn't work. Send yourself a fresh one below.";
}

/* Email them a link back into the app to choose a new password. The link
   lands on the same origin, where PASSWORD_RECOVERY switches the login card
   into "set a new password". */
export async function resetPassword(email) {
  if (!supabase) return;
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: typeof window !== "undefined" ? window.location.origin : undefined,
  });
  if (error) throw error;
}

export async function setPassword(password) {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
}

export async function signOut() {
  if (!supabase) return;
  await supabase.auth.signOut();
}

export const ROLE_TITLES = {
  superadmin: "Super Admin",
  dept_head: "Dept Head — Project Management",
  pm: "Project Manager",
  engineer: "Engineer",
};
const RESOURCE_TITLES = {
  jr_pm: "Jr. Project Manager", sr_pm: "Sr. Project Manager",
  jr_fw: "Jr. Firmware Engineer", sr_fw: "Sr. Firmware Engineer",
  jr_hw: "Jr. Hardware Engineer", sr_hw: "Sr. Hardware Engineer",
  sc: "Supply Chain", ind_design: "Industrial Designer", sol_arch: "Solution Architect",
};
const PALETTE = ["#2563eb", "#7c3aed", "#ea580c", "#0891b2", "#16a34a", "#d97706", "#db2777", "#0d9488", "#9333ea", "#dc2626", "#4f46e5", "#0284c7"];

/* Roster. Prefers `core.people`; falls back to the legacy `public.users` table
   when it is empty or absent, so the real team shows post-login. */
export async function fetchProfiles() {
  if (!supabase) return [];
  let rows = [];
  try {
    const { data, error } = await withLayoutRetry(supabase, () =>
      tbl(supabase, "people").select("*").order("created_at"));
    if (!error && data) rows = data;
  } catch { /* ignore */ }
  if (!rows.length) {
    try {
      const { data, error } = await supabase.from("users").select("*");
      if (!error && data) rows = data;
    } catch { /* ignore */ }
  }
  return rows.map((p, i) => {
    const role = p.role === "developer" ? "engineer" : (p.role || "engineer");
    return {
      id: p.id,
      // The login behind this person, once they have one. Null while a PM has
      // added them as a resource but they have not signed up yet.
      authId: p.auth_id || null,
      name: p.name || (p.email || "").split("@")[0] || "User",
      role,
      title: p.title || RESOURCE_TITLES[p.resource_role] || ROLE_TITLES[role] || "Team",
      color: p.color || PALETTE[i % PALETTE.length],
      email: p.email || "",
      // Full resource record, so Dept / capacity / skills survive a refresh.
      dept: p.dept || "",
      resourceRole: p.resource_role || "",
      skills: p.skills || [],
      maxProjects: p.max_projects || undefined,
      projectTags: p.project_tags || [],
    };
  });
}
