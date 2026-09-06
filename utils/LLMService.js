import "dotenv/config";

// Safe JSON extraction: returns null instead of throwing unhandled exceptions
const extractJSON = (text) => {
    if (!text) return null;

    const cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");

    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
        return null;
    }

    try {
        return JSON.parse(cleaned.substring(firstBrace, lastBrace + 1));
    } catch {
        return null;
    }
};

const SYSTEM_PROMPT = `You are a strict REST API architect and schema validator.

Your ONLY job is to determine if the user's description is a genuine request to model a software data entity or resource for a REST API (e.g., users, products, orders, blog posts, comments, todos, invoices, employees, etc.).

VALIDITY RULES — A prompt is VALID only when ALL of the following are true:
1. It clearly refers to a software data model, database entity, or CRUD resource.
2. It is phrased as a request to create, generate, or define an API resource, schema, or fields.
3. The entity makes sense as a table/collection in a database (e.g., "users", "orders", "products").

INVALIDITY RULES — A prompt is INVALID when ANY of the following are true:
1. It describes a real-world person, place, political figure, organization, or historical event (e.g., "president of pakistan", "eiffel tower", "world war 2").
2. It is gibberish, random words, or has no clear meaning.
3. It is a general question, opinion, or statement not related to building an API.
4. It refers to a physical object or concept that would never be a REST API resource (e.g., "a chair", "pizza", "weather today").
5. It is a creative writing prompt, joke, or off-topic request.

If the prompt is valid:
- Return the total number of entities/resources identified.
- Return the name of every entity/resource.
- Return the fields for every entity/resource.
- If the user explicitly provides specific field names, use those exactly.
- If the user provides some fields and asks for more, keep the user's fields and infer sensible additional ones.
- If the user provides only an entity name without fields, infer sensible and commonly useful fields for that entity.
- If the description clearly contains multiple entities, identify and return each separately.
- Do NOT create a generic "id" field. MongoDB auto-generates _id. Fields like userId, productId, orderId are fine.
- Field names must be single alphanumeric identifier words with no spaces or special characters.
- Every field must have a type: string, number, boolean, array, or object.
- Every entry in requiredFields must correspond to an existing field in that entity's properties.
- Resource names must be lowercase plural names.
- Do not output explanations, preambles, or any text outside the JSON.

For an invalid prompt, return:
{
  "valid": false,
  "resourceCount": 0,
  "resources": []
}
For a valid prompt, return:
{
  "valid": true,
  "resourceCount": 1,
  "resources": [
    {
      "resource": "students",
      "requiredFields": ["name", "email"],
      "properties": [
        {
          "fieldName": "name",
          "fieldType": "string"
        },
        {
          "fieldName": "email",
          "fieldType": "string"
        }
      ]
    }
  ]
}`;

export const validatePrompt = async (promptText) => {
    if (!promptText || typeof promptText !== "string" || !promptText.trim()) {
        return {
            valid: false,
            resourceCount: 0,
            resources: [],
        };
    }

    // Free tier fallback chain avoiding safety-only checkpoints
    const candidateModels = [
        "google/gemma-4-31b:free",
        "minimax/minimax-m3:free",
        "openrouter/free",
    ];

    let parsed = null;

    for (const model of candidateModels) {
        try {
            const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${process.env.API_KEY}`,
                    "Content-Type": "application/json",
                    "HTTP-Referer": process.env.CLIENT_URL || "http://localhost:8000",
                    "X-Title": "MockAPI Generator",
                },
                body: JSON.stringify({
                    model,
                    messages: [
                        { role: "system", content: SYSTEM_PROMPT },
                        { role: "user", content: promptText },
                    ],
                    response_format: { type: "json_object" },
                    temperature: 0.1,
                }),
            });

            if (!response.ok) continue;

            const data = await response.json();
            const rawText = data.choices?.[0]?.message?.content?.trim();
            parsed = extractJSON(rawText);

            if (parsed) break;
        } catch {
            continue;
        }
    }

    if (!parsed || !parsed.valid || !Array.isArray(parsed.resources) || parsed.resources.length === 0) {
        return {
            valid: false,
            resourceCount: 0,
            resources: [],
        };
    }

    const sanitizedResources = parsed.resources.map((item) => {
        const resourceName = (item.resource || "items")
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9]/g, "");

        const properties = (item.properties || [])
            .map((p) => ({
                fieldName: typeof p.fieldName === "string" ? p.fieldName.trim().replace(/[^a-zA-Z0-9]/g, "") : "",
                fieldType: ["string", "number", "boolean", "array", "object"].includes(p.fieldType)
                    ? p.fieldType
                    : "string",
            }))
            .filter((p) => p.fieldName.length > 0 && p.fieldName.toLowerCase() !== "id");

        const validFieldNames = new Set(properties.map((p) => p.fieldName));
        const requiredFields = (item.requiredFields || [])
            .map((f) => (typeof f === "string" ? f.trim().replace(/[^a-zA-Z0-9]/g, "") : ""))
            .filter((f) => f.length > 0 && f.toLowerCase() !== "id" && validFieldNames.has(f));

        return {
            resource: resourceName,
            requiredFields,
            properties,
        };
    });

    return {
        valid: true,
        resourceCount: sanitizedResources.length,
        resources: sanitizedResources,
    };
};