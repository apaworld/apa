import { createClient } from "npm:@supabase/supabase-js@2";

const AUTH_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN")!;
const PUBLIC_URL =
  "https://pfaurqvqjgcmnybdeghs.supabase.co/functions/v1/twilio-inbound";

// Check that the request really comes from Twilio
async function isFromTwilio(params: URLSearchParams, signature: string | null) {
  if (!signature) return false;
  let data = PUBLIC_URL;
  for (const key of [...new Set(params.keys())].sort()) {
    data += key + params.get(key);
  }
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(AUTH_TOKEN),
    { name: "HMAC", hash: "SHA-1" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig))) === signature;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Not allowed", { status: 405 });

  const params = new URLSearchParams(await req.text());
  if (!(await isFromTwilio(params, req.headers.get("X-Twilio-Signature")))) {
    return new Response("Forbidden", { status: 403 });
  }

  const from = params.get("From") ?? "unknown";
  const text = (params.get("Body") ?? "").trim().slice(0, 5000) || "(empty message)";

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
