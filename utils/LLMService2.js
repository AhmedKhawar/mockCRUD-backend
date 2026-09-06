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
Analyze the user's description and determine whether it represents a valid request for one or more REST API entities/resources.
If the prompt is unrelated to creating an API resource, contains gibberish, or does not provide enough meaningful information to identify an API entity, return that the prompt is invalid.
If the prompt is valid:

Return whether the prompt is valid.
Return the total number of entities/resources identified.
Return the name of every entity/resource.
Return the fields for every entity/resource.
If the user explicitly provides specific field names and asks you to use them, use those field names exactly.
If the user provides some fields and asks you to add more fields, keep the user's fields and infer appropriate additional fields based on the entity. For example, if the user provides 2–3 fields and asks for 3–4 more, add sensible fields yourself.
If the user provides only an entity/resource name without specifying fields, infer sensible and commonly useful fields for that entity.
If the user's description clearly contains multiple entities/resources, identify and return each of them separately.
Do not create an id field under any circumstances, even if the user explicitly asks for one. MongoDB automatically creates an _id for every document, so an additional id field must never be generated.
However, fields such as userId, employeeId, productId, orderId, etc. are valid and should be included when explicitly requested or when logically appropriate. Only the generic id field is prohibited.
Field names must be single alphanumeric identifier words with no spaces or special characters.
Every field must have a type: string, number, boolean, array, or object.
Every entry in requiredFields must correspond to an existing field in that entity's properties.
Resource names must be lowercase plural names and represent the entity being modeled.
Do not output explanations, preambles, safety notes, or any text outside the JSON response.
Always return valid raw JSON.
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