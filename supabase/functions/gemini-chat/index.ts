import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const auth = req.headers.get("Authorization");
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth ?? "" } } });
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "Sign in required" }), { status: 401, headers: { ...cors, "Content-Type": "application/json" } });

    const { prompt, history = [] } = await req.json();
    if (!prompt || typeof prompt !== "string") return new Response(JSON.stringify({ error: "Prompt is required" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) return new Response(JSON.stringify({ error: "Gemini is not configured yet" }), { status: 503, headers: { ...cors, "Content-Type": "application/json" } });

    // Gemini 2.0 Flash was shut down, so keep the fallback on a current model.
    const model = Deno.env.get("GEMINI_MODEL") || "gemini-3.7-flash";
    const contents = [...history.slice(-8), { role: "user", parts: [{ text: prompt.slice(0, 2000) }] }];
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: "You are Kaidra AI, a friendly anime community assistant. Help with anime and manga recommendations, watchlist organization, explanations, and casual chat. Be concise and never claim to have changed a user's list unless the app confirms it." }] }, contents, generationConfig: { temperature: 0.75, maxOutputTokens: 600 } }),
    });
    const data = await response.json();
    if (!response.ok) return new Response(JSON.stringify({ error: data?.error?.message || "Gemini request failed" }), { status: 502, headers: { ...cors, "Content-Type": "application/json" } });
    const text = data?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || "").join("").trim();
    return new Response(JSON.stringify({ text: text || "I couldn't think of a reply just now." }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unexpected error" }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
