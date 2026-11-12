import { createClient } from "npm:@supabase/supabase-js@2";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const SOURCE = "https://cdn.jsdelivr.net/gh/Raazimtech/jvault@5a5ff6cc86d32cd307fb79d02a75d29ffad86836/";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
async function serveSite(): Promise<Response> {
  const response = await fetch(SOURCE + "index.html", { headers: { "Cache-Control": "no-cache" } });
  if (!response.ok) return new Response("JVault frontend could not be loaded from its repository.", { status: 503 });
  let html = await response.text();
  html = html.replace(/href=["\']\.\/style\.css(?:\?[^"\']*)?["\']/i, 'href="' + SOURCE + 'style.css"').replace(/src=["\']\.\/app\.js(?:\?[^"\']*)?["\']/i, 'src="' + SOURCE + 'app.js"');
  return new Response(html, { headers: {
    "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "strict-origin-when-cross-origin", "X-Frame-Options": "DENY",
    "Content-Security-Policy": "default-src 'self' https://cdn.jsdelivr.net https://fonts.googleapis.com https://fonts.gstatic.com https://dpiwdhtbhwjgatvcfkcb.supabase.co; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self' https://dpiwdhtbhwjgatvcfkcb.supabase.co; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  }});
}
Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  const normalizedPath = new URL(request.url).pathname.replace(/\/$/, "");
  const route = normalizedPath.split("/").pop() || "";
  if (route === "bootstrap-status" && request.method === "GET") {
    const { data, error } = await admin.from("jvault_bootstrap_state").select("claimed").eq("id", 1).single();
    if (error || !data) return json({ error: "Setup status is unavailable." }, 500);
    return json({ claimed: data.claimed });
  }
  if (route === "bootstrap" && request.method === "POST") {
    let body: { username?: unknown; password?: unknown; bootstrapCode?: unknown };
    try { const raw = await request.text(); if (raw.length > 8000) return json({ error: "Request is too large." }, 413); body = JSON.parse(raw); }
    catch { return json({ error: "Invalid request body." }, 400); }
    const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const bootstrapCode = typeof body.bootstrapCode === "string" ? body.bootstrapCode.trim() : "";
    if (!/^[a-z0-9_]{3,24}$/.test(username)) return json({ error: "Username must be 3–24 letters, numbers, or underscores." }, 400);
    if (password.length < 12 || password.length > 128) return json({ error: "Password must be 12–128 characters." }, 400);
    if (!bootstrapCode || bootstrapCode.length > 256) return json({ error: "A valid creator bootstrap code is required." }, 403);
    const { data: secretRow, error: secretError } = await admin.from("jvault_bootstrap_secret").select("secret_sha256").eq("id", 1).single();
    if (secretError || !secretRow?.secret_sha256) return json({ error: "Creator verification is unavailable. Contact the vault administrator." }, 500);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(bootstrapCode));
    const submittedHash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
    const expectedHash = String(secretRow.secret_sha256).toLowerCase();
    let mismatch = submittedHash.length ^ expectedHash.length;
    const compareLength = Math.max(submittedHash.length, expectedHash.length);
    for (let i = 0; i < compareLength; i++) mismatch |= (submittedHash.charCodeAt(i) || 0) ^ (expectedHash.charCodeAt(i) || 0);
    if (mismatch !== 0) return json({ error: "Invalid creator bootstrap code." }, 403);
    const { data: claim, error: claimError } = await admin.from("jvault_bootstrap_state").update({ claimed: true }).eq("id", 1).eq("claimed", false).select("id").maybeSingle();
    if (claimError) return json({ error: "Could not initialize the vault. Try again." }, 500);
    if (!claim) return json({ error: "The one-time owner account already exists. Sign in instead." }, 409);
    let userId: string | null = null;
    try {
      const { data: created, error: createError } = await admin.auth.admin.createUser({ email: username + "@jvault.invalid", password, email_confirm: true, user_metadata: { username } });
      if (createError || !created.user) throw new Error(createError?.message || "Account creation failed.");
      userId = created.user.id;
      const { error: profileError } = await admin.from("jvault_profiles").insert({ user_id: userId, username });
      if (profileError) throw new Error("Could not create the vault profile.");
      return json({ success: true });
    } catch (error) {
      if (userId) await admin.auth.admin.deleteUser(userId);
      await admin.from("jvault_bootstrap_state").update({ claimed: false }).eq("id", 1);
      return json({ error: error instanceof Error ? error.message : "Account creation failed." }, 400);
    }
  }
  if (request.method === "GET" && (route === "jvault" || route === "")) return await serveSite();
  return json({ error: "Not found." }, 404);
});