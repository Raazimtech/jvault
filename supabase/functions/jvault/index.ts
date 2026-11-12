import { createClient } from "npm:@supabase/supabase-js@2";
import { generateVapidKey, vapidPublicKey, send as sendWebPush } from "jsr:@daaku/webpush@0.2.0";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const SOURCE = "https://cdn.jsdelivr.net/gh/Raazimtech/jvault@0a9f8a83d899469bd61fd0ea99e3af0035c68661/";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-jvault-dispatch", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
async function serveSite(): Promise<Response> {
  const response = await fetch(SOURCE + "index.html", { headers: { "Cache-Control": "no-cache" } });
  if (!response.ok) return new Response("JVault frontend could not be loaded from its repository.", { status: 503 });
  let html = await response.text();
  html = html.replace(/href=["\']\.\/style\.css(?:\?[^"\']*)?["\']/i, 'href="' + SUPABASE_URL + '/functions/v1/jvault/style.css"').replace(/src=["\']\.\/app\.js(?:\?[^"\']*)?["\']/i, 'src="' + SUPABASE_URL + '/functions/v1/jvault/app.js"').replace(/href=["\']\.\/manifest\.webmanifest["\']/i, 'href="' + SUPABASE_URL + '/functions/v1/jvault/manifest.webmanifest"').replace(/href=["\']\.\/icon\.svg["\']/i, 'href="' + SUPABASE_URL + '/functions/v1/jvault/icon.svg"');
  return new Response(html, { headers: {
    "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "strict-origin-when-cross-origin", "X-Frame-Options": "DENY",
    "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https://dpiwdhtbhwjgatvcfkcb.supabase.co; frame-src 'self' https://dpiwdhtbhwjgatvcfkcb.supabase.co blob:; worker-src 'self' blob: https://cdn.jsdelivr.net; connect-src 'self' https://dpiwdhtbhwjgatvcfkcb.supabase.co https://cdn.jsdelivr.net; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  }});
}
Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  const normalizedPath = new URL(request.url).pathname.replace(/\/$/, "");
  const route = normalizedPath.split("/").pop() || "";

  const authUser = async () => {
    const header = request.headers.get("Authorization") || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) return null;
    const { data, error } = await admin.auth.getUser(token);
    return error ? null : data.user;
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

  if (route === "push-config" && request.method === "POST") {
    const owner = await authUser();
    if (!owner) return json({ error: "Sign in to enable notifications." }, 401);
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
    let body: { subscription?: any };
    try { body = await request.json(); } catch { return json({ error: "Invalid subscription." }, 400); }
    const sub = body.subscription;
    if (!sub || !validPushEndpoint(sub.endpoint) || typeof sub.keys?.p256dh !== "string" || typeof sub.keys?.auth !== "string") {
      return json({ error: "The browser returned an invalid push subscription." }, 400);
    }
    const { error } = await admin.from("jvault_push_subscriptions").upsert({
      owner_id: owner.id, endpoint: sub.endpoint, subscription: sub,
      user_agent: request.headers.get("user-agent") || null, updated_at: new Date().toISOString()
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
    let body: { endpoint?: unknown };
    try { body = await request.json(); } catch { return json({ error: "Invalid request." }, 400); }
    if (typeof body.endpoint !== "string" || !validPushEndpoint(body.endpoint)) return json({ error: "Invalid endpoint." }, 400);
    const { error } = await admin.from("jvault_push_subscriptions").delete().eq("owner_id", owner.id).eq("endpoint", body.endpoint);
    if (error) return json({ error: "Could not remove this device." }, 500);
    return json({ success: true });
  }
  if (route === "push-test" && request.method === "POST") {
    const owner = await authUser();
    if (!owner) return json({ error: "Sign in to test notifications." }, 401);
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
      const config = await getPushConfig();
      const supplied = request.headers.get("x-jvault-dispatch") || "";
      const a = new TextEncoder().encode(supplied), b = new TextEncoder().encode(config.dispatch_secret);
      let mismatch = a.length ^ b.length;
      for (let i = 0; i < Math.max(a.length, b.length); i++) mismatch |= (a[i] || 0) ^ (b[i] || 0);
      if (mismatch !== 0) return json({ error: "Unauthorized." }, 401);
      const now = new Date();
      const stale = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
      await admin.from("jvault_reminders").update({ notification_claimed_at: null })
        .lt("notification_claimed_at", stale).is("notification_sent_at", null);
      const { data: due, error } = await admin.from("jvault_reminders")
        .select("id,owner_id,title,due_at")
        .eq("is_done", false).is("notification_sent_at", null)
        .lte("due_at", now.toISOString()).order("due_at").limit(100);
      if (error) throw error;
      let delivered = 0, skipped = 0;
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
      return json({ delivered, skipped, checked: due?.length || 0 });
    } catch (error) {
      console.error("push dispatch:", error);
      return json({ error: "Reminder dispatch failed." }, 500);
    }
  }

  if (route === "share-create" && request.method === "POST") {
    const owner = await authUser();
    if (!owner) return json({ error: "Sign in to create a share link." }, 401);
    let body: { fileId?: unknown; expiresIn?: unknown };
    try { body = await request.json(); } catch { return json({ error: "Invalid request body." }, 400); }
    const fileId = typeof body.fileId === "string" ? body.fileId : "";
    if (!fileId) return json({ error: "A file is required." }, 400);
    const { data: file, error: fileError } = await admin.from("jvault_files").select("id,name,deleted_at").eq("id", fileId).eq("owner_id", owner.id).maybeSingle();
    if (fileError || !file || file.deleted_at) return json({ error: "File not found." }, 404);
    const random = crypto.getRandomValues(new Uint8Array(32));
    const token = Array.from(random, b => b.toString(16).padStart(2, "0")).join("");
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
    const tokenHash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
    const seconds = Math.min(2592000, Math.max(300, Number(body.expiresIn) || 86400));
    const expiresAt = new Date(Date.now() + seconds * 1000).toISOString();
    const { error: insertError } = await admin.from("jvault_shares").insert({ owner_id: owner.id, file_id: fileId, token_hash: tokenHash, expires_at: expiresAt });
    if (insertError) return json({ error: "Could not create share link." }, 500);
    return json({ url: SUPABASE_URL + "/functions/v1/jvault/share/" + token, expiresAt });
  }
  if (route === "share-revoke" && request.method === "POST") {
    const owner = await authUser();
    if (!owner) return json({ error: "Sign in to revoke share links." }, 401);
    let body: { fileId?: unknown };
    try { body = await request.json(); } catch { return json({ error: "Invalid request body." }, 400); }
    const fileId = typeof body.fileId === "string" ? body.fileId : "";
    if (!fileId) return json({ error: "A file is required." }, 400);
    const { error } = await admin.from("jvault_shares").update({ revoked_at: new Date().toISOString() }).eq("owner_id", owner.id).eq("file_id", fileId).is("revoked_at", null);
    if (error) return json({ error: "Could not revoke share links." }, 500);
    return json({ success: true });
  }
  if (normalizedPath.includes("/share/") && request.method === "GET") {
    const token = route;
    if (!/^[a-f0-9]{64}$/.test(token)) return new Response("This share link is invalid.", { status: 404 });
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
    const tokenHash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
    const { data: share } = await admin.from("jvault_shares").select("id,file_id,expires_at,revoked_at").eq("token_hash", tokenHash).maybeSingle();
    if (!share || share.revoked_at || new Date(share.expires_at).getTime() <= Date.now()) return new Response("This share link has expired or was revoked.", { status: 410 });
    const { data: file } = await admin.from("jvault_files").select("name,storage_path,deleted_at").eq("id", share.file_id).maybeSingle();
    if (!file || file.deleted_at) return new Response("This file is no longer available.", { status: 404 });
    const { data: signed, error } = await admin.storage.from("jvault-private").createSignedUrl(file.storage_path, 60, { download: file.name });
    if (error || !signed?.signedUrl) return new Response("Could not open the shared file.", { status: 500 });
    return Response.redirect(signed.signedUrl, 302);
  }

  if (request.method === "GET" && ["style.css", "app.js", "manifest.webmanifest", "icon.svg", "sw.js"].includes(route)) {
    const response = await fetch(SOURCE + route, { headers: { "Cache-Control": "no-cache" } });
    if (!response.ok) return new Response("JVault asset unavailable.", { status: 503 });
    let body = await response.text();
    const contentTypes: Record<string, string> = { "style.css": "text/css; charset=utf-8", "app.js": "text/javascript; charset=utf-8", "manifest.webmanifest": "application/manifest+json; charset=utf-8", "icon.svg": "image/svg+xml", "sw.js": "text/javascript; charset=utf-8" };
    if (route === "manifest.webmanifest") body = body.replace('"start_url": "./"', '"start_url": "' + SUPABASE_URL + '/functions/v1/jvault"').replace('"scope": "./"', '"scope": "' + SUPABASE_URL + '/functions/v1/"').replace('"src": "./icon.svg"', '"src": "' + SUPABASE_URL + '/functions/v1/jvault/icon.svg"');
    const headers: Record<string, string> = { "Content-Type": contentTypes[route], "Cache-Control": route === "sw.js" ? "no-cache" : "public, max-age=300", "X-Content-Type-Options": "nosniff" };
    if (route === "sw.js") headers["Service-Worker-Allowed"] = "/functions/v1/";
    return new Response(body, { headers });
  }
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