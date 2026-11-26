import { createClient } from "npm:@supabase/supabase-js@2";
import { generateVapidKey, vapidPublicKey, send as sendWebPush } from "jsr:@daaku/webpush@0.2.0";
if (!(Uint8Array as any).fromBase64) {
  (Uint8Array as any).fromBase64 = (value: string) => {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
    const binary = atob(padded);
    return Uint8Array.from(binary, character => character.charCodeAt(0));
  };
}
if (!(Uint8Array.prototype as any).toBase64) {
  (Uint8Array.prototype as any).toBase64 = function() {
    let binary = "";
    for (let i = 0; i < this.length; i++) binary += String.fromCharCode(this[i]);
    return btoa(binary);
  };
}
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const AUTH_API_KEY = Deno.env.get("SUPABASE_ANON_KEY") || SERVICE_ROLE_KEY;
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const SOURCE = "https://cdn.jsdelivr.net/gh/Raazimtech/jvault@c4523102590b13e8e73cc00e0b47ef55f2fb7434/";
const APP_ORIGIN = new URL(SUPABASE_URL).origin;
const ALLOWED_ORIGINS = new Set([
  APP_ORIGIN,
  "https://raazimtech.github.io",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5500",
  "http://127.0.0.1:5500"
]);
const securityHeaders: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(self), microphone=(), geolocation=(), payment=()",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains"
};
const cors = {
  "Access-Control-Allow-Origin": APP_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-jvault-dispatch",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Vary": "Origin"
};
const json = (body: unknown, status = 200, extraHeaders: Record<string, string> = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { ...securityHeaders, ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extraHeaders }
});
const textResponse = (body: string, status = 404, extraHeaders: Record<string, string> = {}) =>
  new Response(body, {
    status,
    headers: { ...securityHeaders, "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...extraHeaders }
  });
async function serveSite(): Promise<Response> {
  const response = await fetch(SOURCE + "index.html", { headers: { "Cache-Control": "no-cache" } });
  if (!response.ok) return new Response("JVault frontend could not be loaded from its repository.", { status: 503 });
  let html = await response.text();
  html = html
    .replace(/href=["\']\.\/design-system\.css(?:\?[^"\']*)?["\']/i, 'href="' + SUPABASE_URL + '/functions/v1/jvault/design-system.css?v=59473fa9877e4e2418889c9a75c80f172ea638ab"')
    .replace(/href=["\']\.\/style\.css(?:\?[^"\']*)?["\']/i, 'href="' + SUPABASE_URL + '/functions/v1/jvault/style.css?v=59473fa9877e4e2418889c9a75c80f172ea638ab"')
    .replace(/src=["\']\.\/app\.js(?:\?[^"\']*)?["\']/i, 'src="' + SUPABASE_URL + '/functions/v1/jvault/app.js?v=59473fa9877e4e2418889c9a75c80f172ea638ab"')
    .replace(/href=["\']\.\/manifest\.webmanifest["\']/i, 'href="' + SUPABASE_URL + '/functions/v1/jvault/manifest.webmanifest"')
    .replace(/href=["\']\.\/icon\.svg["\']/gi, 'href="' + SUPABASE_URL + '/functions/v1/jvault/icon.svg"');
  return new Response(html, { headers: {
    ...securityHeaders,
    ...cors,
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://cdn.jsdelivr.net; style-src 'self' https://fonts.googleapis.com; style-src-attr 'unsafe-inline'; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https://dpiwdhtbhwjgatvcfkcb.supabase.co; frame-src 'self' https://dpiwdhtbhwjgatvcfkcb.supabase.co blob:; worker-src 'self' blob: https://cdn.jsdelivr.net; connect-src 'self' https://dpiwdhtbhwjgatvcfkcb.supabase.co https://cdn.jsdelivr.net; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  }});
}
Deno.serve(async (request: Request) => {
  const origin = request.headers.get("Origin");
  const allowedOrigin = !origin || ALLOWED_ORIGINS.has(origin);
  const requestCors = {
    ...cors,
    "Access-Control-Allow-Origin": origin && allowedOrigin ? origin : APP_ORIGIN
  };
  const json = (body: unknown, status = 200, extraHeaders: Record<string, string> = {}) => new Response(JSON.stringify(body), {
    status,
    headers: { ...securityHeaders, ...requestCors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extraHeaders }
  });
  if (!allowedOrigin) return json({ error: "Forbidden origin." }, 403);
  if (request.method === "OPTIONS") return new Response("ok", { headers: { ...securityHeaders, ...requestCors } });
  const normalizedPath = new URL(request.url).pathname.replace(/\/$/, "");
  const rawRoute = normalizedPath.split("/").pop() || "";
  let route = rawRoute;
  try { route = decodeURIComponent(rawRoute); } catch { return json({ error: "Invalid asset path." }, 400); }

  const authUser = async () => {
    const header = request.headers.get("Authorization") || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) return null;
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data.user) return null;
    const { data: profile, error: profileError } = await admin
      .from("jvault_profiles").select("user_id").eq("user_id", data.user.id).maybeSingle();
    if (profileError || !profile) return null;
    return data.user;
  };

  const readJsonBody = async (maxBytes: number): Promise<{ body: any | null; error: "large" | "invalid" | null }> => {
    const declaredLength = Number(request.headers.get("content-length") || 0);
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) return { body: null, error: "large" };
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > maxBytes) return { body: null, error: "large" };
    try {
      const body = JSON.parse(raw);
      if (!body || typeof body !== "object" || Array.isArray(body)) return { body: null, error: "invalid" };
      return { body, error: null };
    } catch {
      return { body: null, error: "invalid" };
    }
  };

  let rateKeyPromise: Promise<CryptoKey> | null = null;
  const getRateKey = () => {
    if (!rateKeyPromise) {
      rateKeyPromise = crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(SERVICE_ROLE_KEY),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );
    }
    return rateKeyPromise;
  };
  const keyedHash = async (value: string) => {
    const signature = await crypto.subtle.sign("HMAC", await getRateKey(), new TextEncoder().encode(value));
    return Array.from(new Uint8Array(signature), b => b.toString(16).padStart(2, "0")).join("");
  };

  const ownerRateLimit = async (ownerId: string, action: string): Promise<Response | null> => {
    const forwardedIp = request.headers.get("cf-connecting-ip") ||
      request.headers.get("x-real-ip") || "unknown";
    const safeIp = forwardedIp.trim().slice(0, 128) || "unknown";
    const accountKey = await keyedHash("jvault-api-account\n" + action + "\n" + ownerId);
    const pairKey = await keyedHash("jvault-api-ip-account\n" + action + "\n" + safeIp + "\n" + ownerId);
    const { data: rateRows, error: rateError } = await admin.rpc("jvault_login_rate_check", {
      p_pair_key: pairKey,
      p_account_key: accountKey
    });
    if (rateError) {
      console.error("API rate check:", rateError);
      return json({ error: "This action is temporarily unavailable." }, 503);
    }
    const rate = Array.isArray(rateRows) ? rateRows[0] : rateRows;
    if (!rate || rate.allowed !== true) {
      const retry = Math.max(1, Math.min(3600, Number(rate?.retry_after_seconds) || 900));
      return json(
        { error: "Too many requests. Try again later.", retryAfter: retry },
        429,
        { "Retry-After": String(retry) }
      );
    }
    const { error: recordError } = await admin.rpc("jvault_login_rate_record", {
      p_pair_key: pairKey,
      p_account_key: accountKey,
      p_succeeded: false
    });
    if (recordError) {
      console.error("API rate record:", recordError);
      return json({ error: "This action is temporarily unavailable." }, 503);
    }
    return null;
  };

  const getPushConfig = async () => {
    const { data: existing, error: readError } = await admin.from("jvault_push_config").select("id,vapid_private_jwk,vapid_public_key,dispatch_secret").eq("id", 1).maybeSingle();
    if (readError) throw readError;
    if (existing) return existing;
    const privateJwk = await generateVapidKey();
    const publicKey = await vapidPublicKey(privateJwk);
    const random = crypto.getRandomValues(new Uint8Array(32));
    const dispatchSecret = Array.from(random, b => b.toString(16).padStart(2, "0")).join("");
    const { data: created, error: createError } = await admin.from("jvault_push_config").insert({
      id: 1, vapid_private_jwk: privateJwk, vapid_public_key: publicKey, dispatch_secret: dispatchSecret
    }).select("id,vapid_private_jwk,vapid_public_key,dispatch_secret").maybeSingle();
    if (created) return created;
    const { data: raced } = await admin.from("jvault_push_config").select("id,vapid_private_jwk,vapid_public_key,dispatch_secret").eq("id", 1).maybeSingle();
    if (raced) return raced;
    throw createError || new Error("Could not initialize push notifications.");
  };
  const validPushEndpoint = (value: unknown) => {
    if (typeof value !== "string" || value.length > 4096) return false;
    try {
      const url = new URL(value);
      const host = url.hostname.toLowerCase();
      return url.protocol === "https:" && !url.username && !url.password &&
        (host === "fcm.googleapis.com" || host.endsWith(".notify.windows.com") ||
         host.endsWith(".push.services.mozilla.com") || host.endsWith(".push.apple.com"));
    } catch { return false; }
  };
  const sendPush = async (subscription: any, payload: Record<string, unknown>, config: any) => {
    await sendWebPush(subscription, JSON.stringify(payload), {
      vapid: config.vapid_private_jwk,
      subscriber: "https://raazimtech.github.io/Raazim-tech/",
      ttl: 86400,
      urgency: "high"
    });
  };

  if (route === "login" && request.method === "POST") {
    const parsed = await readJsonBody(4096);
    if (parsed.error === "large") return json({ error: "Request is too large." }, 413);
    if (parsed.error) return json({ error: "Invalid sign-in request." }, 400);

    const body = parsed.body as { username?: unknown; password?: unknown };
    const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!/^[a-z0-9_]{3,24}$/.test(username) || password.length < 1 || password.length > 128) {
      return json({ error: "Incorrect username or password." }, 401);
    }

    const forwardedIp = request.headers.get("cf-connecting-ip") ||
      request.headers.get("x-real-ip") || "unknown";
    const safeIp = forwardedIp.trim().slice(0, 128) || "unknown";
    const accountKey = await keyedHash("jvault-account\n" + username);
    const pairKey = await keyedHash("jvault-ip-account\n" + safeIp + "\n" + username);

    const { data: rateRows, error: rateError } = await admin.rpc("jvault_login_rate_check", {
      p_pair_key: pairKey,
      p_account_key: accountKey
    });
    if (rateError) {
      console.error("login rate check:", rateError);
      return json({ error: "Sign-in is temporarily unavailable. Try again shortly." }, 503);
    }
    const rate = Array.isArray(rateRows) ? rateRows[0] : rateRows;
    if (!rate || rate.allowed !== true) {
      const retry = Math.max(1, Math.min(3600, Number(rate?.retry_after_seconds) || 900));
      return json(
        { error: "Too many unsuccessful attempts. Try again later.", retryAfter: retry },
        429,
        { "Retry-After": String(retry) }
      );
    }

    let authResponse: Response;
    let authPayload: any = null;
    try {
      authResponse = await fetch(SUPABASE_URL + "/auth/v1/token?grant_type=password", {
        method: "POST",
        headers: {
          "apikey": AUTH_API_KEY,
          "Content-Type": "application/json",
          "X-Client-Info": "jvault-login-proxy"
        },
        body: JSON.stringify({
          email: username + "@jvault.invalid",
          password
        })
      });
      authPayload = await authResponse.json().catch(() => null);
    } catch (error) {
      console.error("login upstream:", error);
      return json({ error: "Sign-in is temporarily unavailable. Try again shortly." }, 503);
    }

    if (authResponse.status === 429) {
      return json({ error: "Authentication is rate limited. Try again later." }, 429, { "Retry-After": "60" });
    }

    const authenticated = authResponse.ok &&
      typeof authPayload?.access_token === "string" &&
      typeof authPayload?.refresh_token === "string" &&
      typeof authPayload?.user?.id === "string";
    let succeeded = false;
    if (authenticated) {
      const { data: ownerProfile, error: profileError } = await admin
        .from("jvault_profiles").select("user_id").eq("user_id", authPayload.user.id).maybeSingle();
      if (profileError) {
        console.error("login owner verification:", profileError);
        return json({ error: "Sign-in is temporarily unavailable. Try again shortly." }, 503);
      }
      succeeded = !!ownerProfile;
    }
    const { error: recordError } = await admin.rpc("jvault_login_rate_record", {
      p_pair_key: pairKey,
      p_account_key: accountKey,
      p_succeeded: succeeded
    });
    if (recordError) {
      console.error("login rate record:", recordError);
      return json({ error: "Sign-in is temporarily unavailable. Try again shortly." }, 503);
    }
    if (!succeeded) {
      const { data: postRateRows, error: postRateError } = await admin.rpc("jvault_login_rate_check", {
        p_pair_key: pairKey,
        p_account_key: accountKey
      });
      if (postRateError) {
        console.error("post-login rate check:", postRateError);
        return json({ error: "Sign-in is temporarily unavailable. Try again shortly." }, 503);
      }
      const postRate = Array.isArray(postRateRows) ? postRateRows[0] : postRateRows;
      if (!postRate || postRate.allowed !== true) {
        const retry = Math.max(1, Math.min(900, Number(postRate?.retry_after_seconds) || 900));
        return json(
          { error: "Too many unsuccessful attempts. Sign-in is locked for 15 minutes.", retryAfter: retry },
          429,
          { "Retry-After": String(retry) }
        );
      }
      return json({ error: "Incorrect username or password." }, 401);
    }

    return json({
      access_token: authPayload.access_token,
      refresh_token: authPayload.refresh_token,
      expires_in: authPayload.expires_in,
      expires_at: authPayload.expires_at,
      token_type: authPayload.token_type,
      user: authPayload.user
    });
  }


  const requireAdmin = async (owner: any) => {
    if (!owner) return false;
    const { data, error } = await admin.from("jvault_profiles").select("role").eq("user_id", owner.id).maybeSingle();
    return !error && data?.role === "admin";
  };
  if (route === "admin-users" && (request.method === "GET" || request.method === "POST")) {
    const owner = await authUser();
    if (!owner) return json({ error: "Sign in required." }, 401);
    if (!await requireAdmin(owner)) return json({ error: "Administrator access required." }, 403);
    if (request.method === "GET") {
      const { data, error } = await admin.from("jvault_profiles").select("user_id,username,role,created_at").order("created_at", { ascending: false });
      if (error) return json({ error: "Could not load users." }, 500);
      return json({ users: data || [] });
    }
    const limited = await ownerRateLimit(owner.id, "admin-create-user");
    if (limited) return limited;
    const parsed = await readJsonBody(4096);
    if (parsed.error === "large") return json({ error: "Request is too large." }, 413);
    if (parsed.error) return json({ error: "Invalid request." }, 400);
    const body = parsed.body as { action?: unknown; username?: unknown; password?: unknown; userId?: unknown };
    const action = typeof body.action === "string" ? body.action : "create";
    if (action === "reset-password") {
      const userId = typeof body.userId === "string" ? body.userId : "";
      const password = typeof body.password === "string" ? body.password : "";
      if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(userId)) return json({ error: "A valid user is required." }, 400);
      if (password.length < 12 || password.length > 128) return json({ error: "Password must be 12–128 characters." }, 400);
      const { data: target, error: targetError } = await admin.from("jvault_profiles").select("user_id,role").eq("user_id", userId).maybeSingle();
      if (targetError || !target) return json({ error: "User not found." }, 404);
      if (target.role === "admin" && userId !== owner.id) return json({ error: "Only the administrator can change their own admin password." }, 403);
      const { error } = await admin.auth.admin.updateUserById(userId, { password });
      if (error) return json({ error: "Could not reset password." }, 500);
      return json({ success: true });
    }
    if (action !== "create") return json({ error: "Unknown user-management action." }, 400);
    const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!/^[a-z0-9_]{3,24}$/.test(username)) return json({ error: "Student ID must be 3–24 letters, numbers, or underscores." }, 400);
    if (password.length < 12 || password.length > 128) return json({ error: "Password must be 12–128 characters." }, 400);
    const { data: duplicate, error: duplicateError } = await admin.from("jvault_profiles").select("user_id").ilike("username", username).maybeSingle();
    if (duplicateError) return json({ error: "Could not verify whether this Student ID is available. Try again." }, 500);
    if (duplicate) return json({ error: "This Student ID is already registered. Use a unique Student ID." }, 409);
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email: username + "@jvault.invalid", password, email_confirm: true,
      app_metadata: { role: "user" }, user_metadata: { username }
    });
    if (createError || !created.user) return json({ error: createError?.message || "Could not create user." }, 400);
    const { error: profileError } = await admin.from("jvault_profiles").insert({ user_id: created.user.id, username, role: "user" });
    if (profileError) { await admin.auth.admin.deleteUser(created.user.id); return json({ error: profileError.code === "23505" ? "This Student ID is already registered. Use a unique Student ID." : "Could not create the user profile." }, profileError.code === "23505" ? 409 : 500); }
    return json({ success: true, user: { user_id: created.user.id, username, role: "user" } }, 201);
  }
  if (route === "groups" && (request.method === "GET" || request.method === "POST")) {
    const owner = await authUser();
    if (!owner) return json({ error: "Sign in required." }, 401);
    if (request.method === "GET") {
      const { data: memberships, error: memberError } = await admin.from("jvault_group_members").select("group_id").eq("user_id", owner.id);
      if (memberError) return json({ error: "Could not load groups." }, 500);
      const ids = (memberships || []).map((m: any) => m.group_id);
      let groups: any[] = [];
      if (ids.length) {
        const { data, error } = await admin.from("jvault_groups").select("id,name,created_by,created_at").in("id", ids).order("created_at", { ascending: false });
        if (error) return json({ error: "Could not load groups." }, 500);
        groups = data || [];
      }
      const { data: owned, error: ownedError } = await admin.from("jvault_groups").select("id,name,created_by,created_at").eq("created_by", owner.id).order("created_at", { ascending: false });
      if (ownedError) return json({ error: "Could not load groups." }, 500);
      const map = new Map<string, any>();
      for (const g of [...groups, ...(owned || [])]) map.set(g.id, g);
      const result = [];
      for (const g of map.values()) {
        const { data: members, error: listError } = await admin.from("jvault_group_members").select("user_id,member_role").eq("group_id", g.id);
        if (listError) continue;
        const memberIds = (members || []).map((m: any) => m.user_id);
        const { data: profiles } = await admin.from("jvault_profiles").select("user_id,username").in("user_id", memberIds.length ? memberIds : [owner.id]);
        const names = new Map((profiles || []).map((p: any) => [p.user_id, p.username]));
        result.push({ ...g, members: (members || []).map((m: any) => ({ user_id: m.user_id, username: names.get(m.user_id) || "user", member_role: m.member_role })) });
      }
      return json({ groups: result });
    }
    const limited = await ownerRateLimit(owner.id, "groups-manage");
    if (limited) return limited;
    const parsed = await readJsonBody(4096);
    if (parsed.error === "large") return json({ error: "Request is too large." }, 413);
    if (parsed.error) return json({ error: "Invalid request." }, 400);
    const body = parsed.body as { action?: unknown; name?: unknown; groupId?: unknown; username?: unknown; userId?: unknown };
    const action = typeof body.action === "string" ? body.action : "";
    if (action === "create") {
      const { data: creatorProfile, error: creatorProfileError } = await admin.from("jvault_profiles").select("role").eq("user_id", owner.id).single();
      if (creatorProfileError || creatorProfile?.role !== "admin") return json({ error: "Only an administrator can create groups." }, 403);
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (name.length < 2 || name.length > 60) return json({ error: "Group name must be 2–60 characters." }, 400);
      const { data: group, error } = await admin.from("jvault_groups").insert({ name, created_by: owner.id }).select("id,name,created_by,created_at").single();
      if (error || !group) return json({ error: "Could not create group." }, 500);
      return json({ success: true, group }, 201);
    }
    const groupId = typeof body.groupId === "string" ? body.groupId : "";
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(groupId)) return json({ error: "A valid group is required." }, 400);
    const { data: group } = await admin.from("jvault_groups").select("id,created_by").eq("id", groupId).maybeSingle();
    if (!group || group.created_by !== owner.id) return json({ error: "Only the group owner can manage members." }, 403);
    if (action === "add") {
      const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
      if (!/^[a-z0-9_]{3,24}$/.test(username)) return json({ error: "Enter a valid username." }, 400);
      const { data: target } = await admin.from("jvault_profiles").select("user_id,username").eq("username", username).maybeSingle();
      if (!target) return json({ error: "No JVault user has that username." }, 404);
      if (target.user_id === group.created_by) return json({ error: "The group creator manages the group but is not a member." }, 400);
      const { error } = await admin.from("jvault_group_members").upsert({ group_id: groupId, user_id: target.user_id, member_role: "member" });
      if (error) return json({ error: "Could not add this member." }, 500);
      return json({ success: true });
    }
    if (action === "remove") {
      const userId = typeof body.userId === "string" ? body.userId : "";
      if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(userId) || userId === owner.id) return json({ error: "Invalid member." }, 400);
      const { error } = await admin.from("jvault_group_members").delete().eq("group_id", groupId).eq("user_id", userId);
      if (error) return json({ error: "Could not remove member." }, 500);
      return json({ success: true });
    }
    return json({ error: "Unknown group action." }, 400);
  }

  if (route === "push-config" && request.method === "POST") {
    const owner = await authUser();
    if (!owner) return json({ error: "Sign in to enable notifications." }, 401);
    const limited = await ownerRateLimit(owner.id, "push-config");
    if (limited) return limited;
    try {
      const config = await getPushConfig();
      return json({ publicKey: config.vapid_public_key });
    } catch (error) {
      console.error("push config:", error);
      return json({ error: "Could not initialize notifications." }, 500);
    }
  }
  if (route === "push-subscribe" && request.method === "POST") {
    const owner = await authUser();
    if (!owner) return json({ error: "Sign in to register this device." }, 401);
    const limited = await ownerRateLimit(owner.id, "push-subscribe");
    if (limited) return limited;
    const parsed = await readJsonBody(8192);
    if (parsed.error === "large") return json({ error: "Request is too large." }, 413);
    if (parsed.error) return json({ error: "Invalid subscription." }, 400);
    const body = parsed.body as { subscription?: any };
    const sub = body.subscription;
    if (!sub || !validPushEndpoint(sub.endpoint) ||
        typeof sub.keys?.p256dh !== "string" || sub.keys.p256dh.length > 512 ||
        typeof sub.keys?.auth !== "string" || sub.keys.auth.length > 256) {
      return json({ error: "The browser returned an invalid push subscription." }, 400);
    }
    const { error } = await admin.from("jvault_push_subscriptions").upsert({
      owner_id: owner.id, endpoint: sub.endpoint, subscription: sub,
      user_agent: (request.headers.get("user-agent") || "").slice(0, 512) || null, updated_at: new Date().toISOString()
    }, { onConflict: "endpoint" });
    if (error) {
      console.error("push subscribe:", error);
      return json({ error: "Could not save this device subscription." }, 500);
    }
    return json({ success: true });
  }
  if (route === "push-unsubscribe" && request.method === "POST") {
    const owner = await authUser();
    if (!owner) return json({ error: "Sign in to manage notifications." }, 401);
    const limited = await ownerRateLimit(owner.id, "push-unsubscribe");
    if (limited) return limited;
    const parsed = await readJsonBody(4096);
    if (parsed.error === "large") return json({ error: "Request is too large." }, 413);
    if (parsed.error) return json({ error: "Invalid request." }, 400);
    const body = parsed.body as { endpoint?: unknown };
    if (typeof body.endpoint !== "string" || !validPushEndpoint(body.endpoint)) return json({ error: "Invalid endpoint." }, 400);
    const { error } = await admin.from("jvault_push_subscriptions").delete().eq("owner_id", owner.id).eq("endpoint", body.endpoint);
    if (error) return json({ error: "Could not remove this device." }, 500);
    return json({ success: true });
  }
  if (route === "push-test" && request.method === "POST") {
    const owner = await authUser();
    if (!owner) return json({ error: "Sign in to test notifications." }, 401);
    const limited = await ownerRateLimit(owner.id, "push-test");
    if (limited) return limited;
    try {
      const config = await getPushConfig();
      const { data: subs, error } = await admin.from("jvault_push_subscriptions").select("id,endpoint,subscription").eq("owner_id", owner.id);
      if (error) throw error;
      let sent = 0;
      for (const sub of subs || []) {
        try {
          await sendPush(sub.subscription, { title: "JVault is ready", body: "Notifications are working on this device.", tag: "jvault-test", url: SUPABASE_URL + "/functions/v1/jvault" }, config);
          sent++;
        } catch (error) {
          if ((error as any)?.permanent) await admin.from("jvault_push_subscriptions").delete().eq("id", sub.id);
          console.error("push test delivery:", error);
        }
      }
      return json({ sent });
    } catch (error) {
      console.error("push test:", error);
      return json({ error: "Could not send a test notification." }, 500);
    }
  }
  if (route === "push-dispatch" && request.method === "POST") {
    try {
      const { data: systemConfig, error: systemConfigError } = await admin.from("jvault_system_config").select("dispatch_secret").eq("id", 1).single();
      if (systemConfigError || !systemConfig) return json({ error: "Maintenance service is not configured." }, 503);
      const supplied = request.headers.get("x-jvault-dispatch") || "";
      const a = new TextEncoder().encode(supplied), b = new TextEncoder().encode(systemConfig.dispatch_secret);
      let mismatch = a.length ^ b.length;
      for (let i = 0; i < Math.max(a.length, b.length); i++) mismatch |= (a[i] || 0) ^ (b[i] || 0);
      if (mismatch !== 0) return json({ error: "Unauthorized." }, 401);
      let config: any = null;
      try { config = await getPushConfig(); }
      catch (pushConfigError) { console.error("push configuration unavailable; continuing cleanup:", pushConfigError); }
      const now = new Date();

      const warningLimit = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
      const { data: expiring, error: expiringError } = await admin.from("jvault_files").select("id,owner_id,name")
        .is("expiry_notice_sent_at", null).is("deleted_at", null).gt("expires_at", now.toISOString()).lte("expires_at", warningLimit).limit(100);
      if (expiringError) throw expiringError;
      for (const file of expiring || []) {
        if (config) {
          const { data: subs } = await admin.from("jvault_push_subscriptions").select("id,subscription").eq("owner_id", file.owner_id);
          for (const sub of subs || []) {
            try {
              await sendPush(sub.subscription, { title: "JVault file expiring soon", body: file.name + " will be deleted within 24 hours. Download it if you need to keep it.", tag: "jvault-expiry-" + file.id, url: SUPABASE_URL + "/functions/v1/jvault" }, config);
            } catch (pushError) {
              if ((pushError as any)?.permanent) await admin.from("jvault_push_subscriptions").delete().eq("id", sub.id);
              console.error("expiry notification:", pushError);
            }
          }
        }
        await admin.from("jvault_files").update({ expiry_notice_sent_at: now.toISOString() }).eq("id", file.id).is("expiry_notice_sent_at", null);
      }
      const { data: expired, error: expiredError } = await admin.from("jvault_files").select("id,storage_path").lte("expires_at", now.toISOString()).limit(100);
      if (expiredError) throw expiredError;
      let expiredDeleted = 0;
      for (const file of expired || []) {
        const { data: versions, error: versionError } = await admin.from("jvault_file_versions").select("storage_path").eq("file_id", file.id);
        if (versionError) throw versionError;
        const paths = [file.storage_path, ...(versions || []).map((v: any) => v.storage_path)].filter(Boolean);
        const { error: storageError } = await admin.storage.from("jvault-private").remove(paths);
        if (storageError) { console.error("expired storage deletion:", storageError); continue; }
        await admin.from("jvault_shares").delete().eq("file_id", file.id);
        await admin.from("jvault_file_versions").delete().eq("file_id", file.id);
        await admin.from("jvault_pages").update({ related_file_id: null }).eq("related_file_id", file.id);
        await admin.from("jvault_reminders").update({ related_file_id: null }).eq("related_file_id", file.id);
        const { error: deleteError } = await admin.from("jvault_files").delete().eq("id", file.id);
        if (deleteError) { console.error("expired file row deletion:", deleteError); continue; }
        expiredDeleted++;
      }
      let delivered = 0, skipped = 0, checked = 0;
      if (config) {
      const stale = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
      await admin.from("jvault_reminders").update({ notification_claimed_at: null })
        .lt("notification_claimed_at", stale).is("notification_sent_at", null);
      const { data: due, error } = await admin.from("jvault_reminders")
        .select("id,owner_id,title,due_at")
        .eq("is_done", false).is("notification_sent_at", null)
        .lte("due_at", now.toISOString()).order("due_at").limit(100);
      if (error) throw error;
      checked = due?.length || 0;
      for (const reminder of due || []) {
        const { data: claim } = await admin.from("jvault_reminders")
          .update({ notification_claimed_at: now.toISOString() })
          .eq("id", reminder.id).is("notification_claimed_at", null)
          .is("notification_sent_at", null).select("id").maybeSingle();
        if (!claim) continue;
        const { data: subs, error: subError } = await admin.from("jvault_push_subscriptions")
          .select("id,endpoint,subscription").eq("owner_id", reminder.owner_id);
        if (subError || !subs?.length) {
          await admin.from("jvault_reminders").update({ notification_claimed_at: null }).eq("id", reminder.id);
          skipped++;
          continue;
        }
        let sent = 0;
        for (const sub of subs) {
          try {
            await sendPush(sub.subscription, {
              title: "JVault reminder",
              body: "It's time: " + reminder.title,
              tag: "jvault-reminder-" + reminder.id,
              url: SUPABASE_URL + "/functions/v1/jvault"
            }, config);
            sent++;
          } catch (error) {
            if ((error as any)?.permanent) await admin.from("jvault_push_subscriptions").delete().eq("id", sub.id);
            console.error("reminder push delivery:", error);
          }
        }
        if (sent > 0) {
          await admin.from("jvault_reminders").update({
            notification_sent_at: now.toISOString(), notification_claimed_at: null
          }).eq("id", reminder.id);
          delivered++;
        } else {
          await admin.from("jvault_reminders").update({ notification_claimed_at: null }).eq("id", reminder.id);
          skipped++;
        }
      }
      }
      return json({ delivered, skipped, checked, expiredDeleted });
    } catch (error) {
      console.error("push dispatch:", error);
      return json({ error: "Reminder dispatch failed." }, 500);
    }
  }

  if (route === "share-create" && request.method === "POST") {
    const owner = await authUser();
    if (!owner) return json({ error: "Sign in to create a share link." }, 401);
    const limited = await ownerRateLimit(owner.id, "share-create");
    if (limited) return limited;
    const parsed = await readJsonBody(4096);
    if (parsed.error === "large") return json({ error: "Request is too large." }, 413);
    if (parsed.error) return json({ error: "Invalid request body." }, 400);
    const body = parsed.body as { fileId?: unknown; expiresIn?: unknown };
    const fileId = typeof body.fileId === "string" ? body.fileId : "";
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(fileId)) return json({ error: "A valid file identifier is required." }, 400);
    const { data: file, error: fileError } = await admin.from("jvault_files").select("id,name,deleted_at").eq("id", fileId).eq("owner_id", owner.id).maybeSingle();
    if (fileError || !file || file.deleted_at) return json({ error: "File not found." }, 404);
    const random = crypto.getRandomValues(new Uint8Array(32));
    const token = Array.from(random, b => b.toString(16).padStart(2, "0")).join("");
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
    const tokenHash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
    const requestedExpiry = typeof body.expiresIn === "number" && Number.isFinite(body.expiresIn) ? body.expiresIn : 86400;
    const seconds = Math.min(2592000, Math.max(300, Math.floor(requestedExpiry)));
    const expiresAt = new Date(Date.now() + seconds * 1000).toISOString();
    const { error: insertError } = await admin.from("jvault_shares").insert({ owner_id: owner.id, file_id: fileId, token_hash: tokenHash, expires_at: expiresAt });
    if (insertError) return json({ error: "Could not create share link." }, 500);
    return json({ url: SUPABASE_URL + "/functions/v1/jvault/share/" + token, expiresAt });
  }
  if (route === "share-revoke" && request.method === "POST") {
    const owner = await authUser();
    if (!owner) return json({ error: "Sign in to revoke share links." }, 401);
    const limited = await ownerRateLimit(owner.id, "share-revoke");
    if (limited) return limited;
    const parsed = await readJsonBody(4096);
    if (parsed.error === "large") return json({ error: "Request is too large." }, 413);
    if (parsed.error) return json({ error: "Invalid request body." }, 400);
    const body = parsed.body as { fileId?: unknown };
    const fileId = typeof body.fileId === "string" ? body.fileId : "";
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(fileId)) return json({ error: "A valid file identifier is required." }, 400);
    const { error } = await admin.from("jvault_shares").update({ revoked_at: new Date().toISOString() }).eq("owner_id", owner.id).eq("file_id", fileId).is("revoked_at", null);
    if (error) return json({ error: "Could not revoke share links." }, 500);
    return json({ success: true });
  }
  if (normalizedPath.includes("/share/") && request.method === "GET") {
    const token = route;
    if (!/^[a-f0-9]{64}$/.test(token)) return textResponse("This share link is invalid.", 404);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
    const tokenHash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
    const { data: share } = await admin.from("jvault_shares").select("id,file_id,expires_at,revoked_at").eq("token_hash", tokenHash).maybeSingle();
    if (!share || share.revoked_at || new Date(share.expires_at).getTime() <= Date.now()) return textResponse("This share link has expired or was revoked.", 410);
    const { data: file } = await admin.from("jvault_files").select("name,storage_path,deleted_at,expires_at").eq("id", share.file_id).maybeSingle();
    if (!file || file.deleted_at) return textResponse("This file is no longer available.", 404);
    if (new Date(file.expires_at).getTime() <= Date.now()) return textResponse("This file has expired.", 410);
    const { data: signed, error } = await admin.storage.from("jvault-private").createSignedUrl(file.storage_path, 60, { download: file.name });
    if (error || !signed?.signedUrl) return textResponse("Could not open the shared file.", 500);
    return new Response(null, {
      status: 302,
      headers: { ...securityHeaders, "Cache-Control": "no-store", "Location": signed.signedUrl }
    });
  }

  if (request.method === "GET" && ["style.css", "app.js", "manifest.webmanifest", "icon.svg", "sw.js", "penguin tired.png"].includes(route)) {
    const response = await fetch(SOURCE + encodeURIComponent(route), { headers: { "Cache-Control": "no-cache" } });
    if (!response.ok) return new Response("JVault asset unavailable.", { status: 503, headers: securityHeaders });
    const contentTypes: Record<string, string> = { "style.css": "text/css; charset=utf-8", "design-system.css": "text/css; charset=utf-8", "police-penguin.css": "text/css; charset=utf-8", "app.js": "text/javascript; charset=utf-8", "manifest.webmanifest": "application/manifest+json; charset=utf-8", "icon.svg": "image/svg+xml", "sw.js": "text/javascript; charset=utf-8", "penguin tired.png": "image/png" };
    const headers: Record<string, string> = { ...securityHeaders, ...requestCors, "Content-Type": contentTypes[route], "Cache-Control": route === "sw.js" ? "no-cache" : "public, max-age=3600" };
    if (route === "sw.js") headers["Service-Worker-Allowed"] = "/functions/v1/";
    if (route === "penguin tired.png") {
      headers["Cross-Origin-Resource-Policy"] = "cross-origin";
      return new Response(await response.arrayBuffer(), { headers });
    }
    let body = await response.text();
    if (route === "manifest.webmanifest") body = body.replace('"start_url": "./"', '"start_url": "' + SUPABASE_URL + '/functions/v1/jvault"').replace('"scope": "./"', '"scope": "' + SUPABASE_URL + '/functions/v1/"').replace('"src": "./icon.svg"', '"src": "' + SUPABASE_URL + '/functions/v1/jvault/icon.svg"');
    return new Response(body, { headers });
  }
  if (route === "bootstrap-status" && request.method === "GET") {
    const { data, error } = await admin.from("jvault_bootstrap_state").select("claimed").eq("id", 1).single();
    if (error || !data) return json({ error: "Setup status is unavailable." }, 500);
    return json({ claimed: data.claimed });
  }
  if (route === "bootstrap" && request.method === "POST") {
    const { data: setupState, error: setupStateError } = await admin
      .from("jvault_bootstrap_state").select("claimed").eq("id", 1).single();
    if (setupStateError || !setupState) return json({ error: "Setup status is unavailable." }, 500);
    if (setupState.claimed) return json({ error: "One-time owner setup is already closed." }, 410);
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