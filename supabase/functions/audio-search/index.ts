// Search proxy for the Kaidra audio picker.
// Configure FREESOUND_API_KEY as a Supabase Edge Function secret.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { query = '', limit = 12 } = await request.json();
    const apiKey = Deno.env.get('FREESOUND_API_KEY');
    if (!apiKey) throw new Error('FREESOUND_API_KEY is not configured');

    const params = new URLSearchParams({
      query: String(query).trim() || 'music loop',
      page_size: String(Math.min(Math.max(Number(limit) || 12, 1), 20)),
      fields: 'id,name,username,previews,license,url,duration',
      filter: 'duration:[5 TO 180]',
    });
    const response = await fetch(`https://freesound.org/apiv2/search/?${params}`, {
      headers: { Authorization: `Token ${apiKey}` },
    });
    if (!response.ok) throw new Error(`Freesound returned ${response.status}`);
    const payload = await response.json();
    const tracks = (payload.results ?? []).map((sound: any) => ({
      id: `freesound-${sound.id}`,
      title: sound.name,
      artist: sound.username || 'Freesound creator',
      source: `Freesound · ${sound.license || 'licensed sound'}`,
      previewUrl: sound.previews?.['preview-hq-mp3'] || sound.previews?.['preview-lq-mp3'] || null,
      sourceUrl: sound.url,
      duration: sound.duration,
    }));

    return new Response(JSON.stringify({ tracks }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Audio search failed' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
