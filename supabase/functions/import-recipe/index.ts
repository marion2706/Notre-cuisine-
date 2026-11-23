const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function textOf(value: any): string[] {
  if (!value) return [];
  if (typeof value === "string") return [value.trim()].filter(Boolean);
  if (Array.isArray(value)) return value.flatMap(textOf);
  if (typeof value === "object") {
    if (value.text) return textOf(value.text);
    if (value.name) return textOf(value.name);
    if (value.itemListElement) return textOf(value.itemListElement);
  }
  return [];
}

function findRecipe(value: any): any | null {
  if (!value) return null;
  if (Array.isArray(value)) {
    for (const item of value) { const found = findRecipe(item); if (found) return found; }
  } else if (typeof value === "object") {
    const types = Array.isArray(value["@type"]) ? value["@type"] : [value["@type"]];
    if (types.some((t: string) => t === "Recipe")) return value;
    if (value["@graph"]) return findRecipe(value["@graph"]);
    for (const child of Object.values(value)) {
      if (child && typeof child === "object") { const found = findRecipe(child); if (found) return found; }
    }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Méthode non autorisée." }, 405);

  try {
    const body = await req.json();
    const url = new URL(String(body.url || ""));
    if (url.protocol !== "https:") return json({ error: "Seuls les liens HTTPS sont acceptés." }, 400);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const allowed = ["marmiton.org", "cuisineaz.com"];
    if (!allowed.includes(host)) return json({ error: "Pour le moment, seuls Marmiton et Cuisine AZ sont pris en charge." }, 400);

    const response = await fetch(url.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; NotreCuisineRecipeImporter/1.0)",
        "Accept": "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });
    if (!response.ok) return json({ error: "Le site a refusé la lecture de cette page." }, 422);
    const html = await response.text();
    const scripts = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
    let recipe: any = null;
    for (const match of scripts) {
      try { recipe = findRecipe(JSON.parse(match[1].replace(/&quot;/g, '"'))); if (recipe) break; } catch { /* JSON-LD parfois invalide */ }
    }
    if (!recipe) return json({ error: "Aucune fiche recette structurée trouvée. Le site peut bloquer l'importation." }, 422);

    const instructions = textOf(recipe.recipeInstructions);
    const ingredients = textOf(recipe.recipeIngredient);
    if (!recipe.name || (!ingredients.length && !instructions.length)) {
      return json({ error: "La page ne contient pas assez d'informations pour importer la recette." }, 422);
    }
    const image = typeof recipe.image === "string" ? recipe.image :
      Array.isArray(recipe.image) ? (typeof recipe.image[0] === "string" ? recipe.image[0] : recipe.image[0]?.url) :
      recipe.image?.url || recipe.image?.["@id"] || "";
    return json({
      recipe: {
        name: String(recipe.name),
        ingredients,
        preparation: instructions,
        servings: String(recipe.recipeYield || "3").replace(/[^0-9]/g, "") || "3",
        image,
      },
    });
  } catch (error) {
    console.error("import-recipe error", error);
    return json({ error: "Impossible de lire ce lien. Vérifie qu'il s'agit bien d'une page recette." }, 500);
  }
});
