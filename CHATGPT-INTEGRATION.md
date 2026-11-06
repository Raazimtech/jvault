# JVault ChatGPT MCP integration

This adds a separate, isolated MCP endpoint for connecting JVault to ChatGPT. It does not replace the existing `jvault` website/bootstrap Edge Function.

## Endpoint

`https://dpiwdhtbhwjgatvcfkcb.supabase.co/functions/v1/jvault-mcp`

Protected-resource metadata:

`https://dpiwdhtbhwjgatvcfkcb.supabase.co/functions/v1/jvault-mcp/.well-known/oauth-protected-resource`

The endpoint validates the bearer token with Supabase Auth, verifies that the user has a `jvault_profiles` record, and performs all reads/writes through the user's Supabase session and existing RLS policies. It does not use the service-role key.

## Tools

- `list_files`, `search_files`
- `get_text_note`, `append_to_text_note`, `replace_text_note`
- `rename_file`, `create_download_link`, `delete_file`

JVault currently stores one global text page in `jvault_notes`, not multiple independent note records. The append tool preserves existing text. Replacing the whole page and deleting files are marked destructive.

## OAuth prerequisite

Enable Supabase Auth's OAuth 2.1 Server for this project (Authentication → OAuth Server), configure an authorization path and an authorization UI, and enable dynamic client registration if required by the ChatGPT client. The authorization UI must authenticate using the existing JVault account and show the requested scopes before approval. Supabase's OAuth server discovery URL is:

`https://dpiwdhtbhwjgatvcfkcb.supabase.co/.well-known/oauth-authorization-server/auth/v1`

The protected-resource metadata points to the project's Auth server. Do not expose a service-role key in the browser or in this repository.

## ChatGPT plan note

ChatGPT custom MCP connections can be created in the ChatGPT web app through Settings → Apps / Plugins → Add custom MCP server (exact UI depends on rollout). Full write-capable MCP app support is currently plan/workspace dependent; Free does not provide the required full write access. After the OAuth server and consent UI are configured, connect the endpoint above and scan tools.

## Safety

The endpoint does not accept anonymous requests. It rejects users without a JVault profile, scopes all database/storage operations to the authenticated user, returns only short-lived signed download URLs, and never returns internal storage paths.
