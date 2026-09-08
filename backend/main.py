"""Optional FastAPI catalog service.

The production browser currently calls the Supabase `mal-api` Edge Function.
This service shows the equivalent server-side contract if the catalog is later
materialized in a PostgreSQL/Supabase `anime` table.
"""

import os
from typing import Literal

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from supabase import Client, create_client

app = FastAPI(title="Kaidra Anime Catalog")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.getenv("WEB_ORIGIN", "http://localhost:5500")],
    allow_credentials=True,
    allow_methods=["GET"],
    allow_headers=["*"],
)

supabase: Client = create_client(
    os.environ["SUPABASE_URL"],
    os.environ["SUPABASE_SERVICE_ROLE_KEY"],
)


@app.get("/api/anime")
def list_anime(
    genre: str | None = Query(default=None, min_length=2),
    sort_year: str = Query(default="all"),
    year: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
):
    """Return only anime matching the requested genre.

    `genres` is a PostgreSQL text[] column. `contains` becomes a strict
    PostgREST `cs` filter, so Action cannot accidentally return Romance rows.
    """
    query = (
        supabase.table("anime")
        .select("id,mal_id,title,cover_url,synopsis,genres,format,release_date,popularity")
        .eq("media_type", "anime")
    )

    if genre:
        normalized_genre = genre.strip().lower().replace(" ", "-")
        query = query.contains("genres", [normalized_genre])

    selected_year = year or sort_year
    if selected_year.isdigit() and len(selected_year) == 4:
        query = query.gte("release_date", f"{selected_year}-01-01").lte("release_date", f"{selected_year}-12-31")
    elif selected_year.count("-") == 1:
        newer, older = sorted((int(part) for part in selected_year.split("-")), reverse=True)
        query = query.gte("release_date", f"{older}-01-01").lte("release_date", f"{newer}-12-31")

    query = query.order("release_date", desc=True)
    result = query.range(offset, offset + limit - 1).execute()
    return {"data": result.data or [], "genre": genre, "sort_year": selected_year, "limit": limit, "offset": offset}
