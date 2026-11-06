import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const RESOURCE = SUPABASE_URL + "/functions/v1/jvault-mcp";
const AUTH_SERVER = SUPABASE_URL + "/auth/v1";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, mcp-session-id, mcp-protocol-version",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Expose-Headers": "WWW-Authenticate, MCP-Session-Id",
  "Cache-Control": "no-store",
};
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8", ...headers } });

type Tool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
};
const tools: Tool[] = [
  { name: "list_files", description: "List the signed-in owner's JVault files. Returns metadata only, never file contents or storage paths.", inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 100, default: 50 } }, additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: "search_files", description: "Search the signed-in owner's JVault file names. Returns matching file metadata only.", inputSchema: { type: "object", properties: { query: { type: "string", minLength: 1, maxLength: 160 }, limit: { type: "integer", minimum: 1, maximum: 50, default: 20 } }, required: ["query"], additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: "get_text_note", description: "Read the owner's single JVault text page. JVault currently stores one shared text document, not separate note records.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: "append_to_text_note", description: "Append new text to the owner's JVault text page without replacing existing content. Use this to save a new entry or note.", inputSchema: { type: "object", properties: { text: { type: "string", minLength: 1, maxLength: 20000 }, heading: { type: "string", maxLength: 160 } }, required: ["text"], additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: false } },
  { name: "replace_text_note", description: "Replace the entire JVault text page. This overwrites its current contents; only use when the user explicitly asks to replace or clear the whole page.", inputSchema: { type: "object", properties: { content: { type: "string", maxLength: 50000 } }, required: ["content"], additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: true } },
  { name: "rename_file", description: "Rename one file in the owner's JVault. Does not change its stored contents.", inputSchema: { type: "object", properties: { file_id: { type: "string", format: "uuid" }, new_name: { type: "string", minLength: 1, maxLength: 255 } }, required: ["file_id", "new_name"], additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: false } },
  { name: "create_download_link", description: "Create a private, short-lived download link for one of the owner's JVault files. Link expires after 60 seconds.", inputSchema: { type: "object", properties: { file_id: { type: "string", format: "uuid" } }, required: ["file_id"], additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: "delete_file", description: "Permanently delete one of the owner's JVault files and its stored object. This cannot be undone. Only call after the user clearly confirms deletion.", inputSchema: { type: "object", properties: { file_id: { type: "string", format: "uuid" } }, required: ["file_id"], additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: true } },
];

function textResult(value: unknown, isError = false) {
  return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }], ...(isError ? { isError: true } : {}) };
}
function rpc(id: unknown, result: unknown) { return json({ jsonrpc: "2.0", id, result }); }
function rpcError(id: unknown, code: number, message: string) { return json({ jsonrpc: "2.0", id, error: { code, message } }); }

async function handleTool(name: string, args: Record<string, unknown>, userClient: ReturnType<typeof createClient>, userId: string) {
  const db = userClient;
  if (name === "list_files" || name === "search_files") {
    const limit = Math.min(100, Math.max(1, Number(args.limit) || (name === "list_files" ? 50 : 20)));
    let query = db.from("jvault_files").select("id,name,size_bytes,mime_type,category,created_at,updated_at,note").order("created_at", { ascending: false }).limit(limit);
    if (name === "search_files") {
      const term = String(args.query || "").trim().replace(/[,%_]/g, " ");
      if (!term) throw new Error("Enter a search term.");
      query = query.ilike("name", "%" + term + "%");
    }
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }
  if (name === "get_text_note") {
    const { data, error } = await db.from("jvault_notes").select("id,content,updated_at").eq("owner_id", userId).maybeSingle();
    if (error) throw error;
    return data || { content: "", updated_at: null };
  }
  if (name === "append_to_text_note") {
    const addition = String(args.text || "").trim();
    if (!addition) throw new Error("Text cannot be empty.");
    const { data: existing, error: readError } = await db.from("jvault_notes").select("content").eq("owner_id", userId).maybeSingle();
    if (readError) throw readError;
    const heading = typeof args.heading === "string" && args.heading.trim() ? args.heading.trim().slice(0, 160) : "ChatGPT note";
    const stamp = new Date().toISOString();
    const block = "\n\n---\n" + heading + " · " + stamp + "\n\n" + addition;
    const content = String(existing?.content || "") + block;
    if (content.length > 50000) throw new Error("The JVault text page would exceed its 50,000-character limit.");
    const { data, error } = await db.from("jvault_notes").upsert({ owner_id: userId, content, updated_at: stamp }, { onConflict: "owner_id" }).select("id,updated_at").single();
    if (error) throw error;
    return { saved: true, appended_characters: addition.length, note: data };
  }
  if (name === "replace_text_note") {
    const content = String(args.content ?? "");
    const { data, error } = await db.from("jvault_notes").upsert({ owner_id: userId, content, updated_at: new Date().toISOString() }, { onConflict: "owner_id" }).select("id,updated_at").single();
    if (error) throw error;
    return { saved: true, characters: content.length, note: data };
  }
  if (name === "rename_file") {
    const fileId = String(args.file_id || "");
    const newName = String(args.new_name || "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(fileId)) throw new Error("Invalid file ID.");
    if (!newName || newName.length > 255) throw new Error("File name must be 1–255 characters.");
    const { data, error } = await db.from("jvault_files").update({ name: newName, updated_at: new Date().toISOString() }).eq("id", fileId).eq("owner_id", userId).select("id,name").maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("File not found.");
    return data;
  }
  if (name === "create_download_link") {
    const fileId = String(args.file_id || "");
    if (!/^[0-9a-f-]{36}$/i.test(fileId)) throw new Error("Invalid file ID.");
    const { data: file, error: fileError } = await db.from("jvault_files").select("name,storage_path").eq("id", fileId).eq("owner_id", userId).maybeSingle();
    if (fileError) throw fileError;
    if (!file) throw new Error("File not found.");
    const { data, error } = await db.storage.from("jvault-private").createSignedUrl(file.storage_path, 60, { download: file.name });
    if (error) throw error;
    return { name: file.name, download_url: data.signedUrl, expires_in_seconds: 60 };
  }
  if (name === "delete_file") {
    const fileId = String(args.file_id || "");
    if (!/^[0-9a-f-]{36}$/i.test(fileId)) throw new Error("Invalid file ID.");
    const { data: file, error: fileError } = await db.from("jvault_files").select("storage_path,name").eq("id", fileId).eq("owner_id", userId).maybeSingle();
    if (fileError) throw fileError;
    if (!file) throw new Error("File not found.");
    const { error: storageError } = await db.storage.from("jvault-private").remove([file.storage_path]);
    if (storageError) throw storageError;
    const { error } = await db.from("jvault_files").delete().eq("id", fileId).eq("owner_id", userId);
    if (error) throw error;
    return { deleted: true, name: file.name };
  }
  throw new Error("Unknown tool: " + name);
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, "");
  if (request.method === "GET" && (path.endsWith("/.well-known/oauth-protected-resource") || path.endsWith("/oauth-protected-resource"))) {
    return json({
      resource: RESOURCE,
      authorization_servers: [AUTH_SERVER],
      bearer_methods_supported: ["header"],
      scopes_supported: ["openid", "profile", "offline_access"],
    });
  }
  if (request.method === "GET") return json({ name: "JVault MCP", version: "1.0.0", endpoint: RESOURCE, protected: true });
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return json({ error: "Authentication required." }, 401, {
      "WWW-Authenticate": 'Bearer resource_metadata="' + RESOURCE + '/.well-known/oauth-protected-resource"',
    });
  }

  const token = match[1];
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: "Bearer " + token } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  if (userError || !userData.user) {
    return json({ error: "Invalid or expired access token." }, 401, {
      "WWW-Authenticate": 'Bearer resource_metadata="' + RESOURCE + '/.well-known/oauth-protected-resource"',
    });
  }
  const { data: profile, error: profileError } = await userClient.from("jvault_profiles").select("user_id").eq("user_id", userData.user.id).maybeSingle();
  if (profileError || !profile) return json({ error: "This account is not a JVault owner." }, 403);

  let body: any;
  try {
    const raw = await request.text();
    if (raw.length > 1024 * 1024) return json({ error: "Request too large." }, 413);
    body = JSON.parse(raw);
  } catch {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
  }
  if (!body || body.jsonrpc !== "2.0" || typeof body.method !== "string") return rpcError(body?.id ?? null, -32600, "Invalid Request");
  if (body.method === "notifications/initialized" || body.method === "notifications/cancelled") return new Response(null, { status: 202, headers: cors });
  if (body.method === "initialize") {
    return rpc(body.id, {
      protocolVersion: "2025-03-26",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "jvault", version: "1.0.0" },
      instructions: "JVault is the owner's private file vault. Use list_files/search_files before file actions. The text page is one shared document; append_to_text_note preserves existing text. Confirm with the user before delete_file or replacing the whole text page.",
    });
  }
  if (body.method === "ping") return rpc(body.id, {});
  if (body.method === "tools/list") return rpc(body.id, { tools });
  if (body.method === "tools/call") {
    const name = String(body.params?.name || "");
    const args = body.params?.arguments && typeof body.params.arguments === "object" ? body.params.arguments : {};
    try {
      const result = await handleTool(name, args, userClient, userData.user.id);
      return rpc(body.id, textResult(result));
    } catch (error) {
      return rpc(body.id, textResult(error instanceof Error ? error.message : "Tool failed.", true));
    }
  }
  return rpcError(body.id ?? null, -32601, "Method not found");
});
