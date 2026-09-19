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

// Validates entity names and infers missing resources/fields with foreign keys
const CUSTOM_SYSTEM_PROMPT = `You are a REST API schema analyzer.
You will receive a JSON payload with user-defined resources. Some resources have manual fields, while others have "inferFields": true.

TASKS:
1. Validate entity names: Ensure every resource name is a sensible software data collection (lowercase plural, e.g., "users", "profiles"). If any name is gibberish, invalid, or inappropriate, return "valid": false.
2. For resources with manual fields: Keep their properties and required fields EXACTLY as provided. Do not modify or remove them.
3. For resources with "inferFields": true:
   - Generate realistic fields matching the requested "count" (or 3-5 fields if count is not provided).
   - INFER LOGICAL CONNECTIONS: If this entity relates to another resource in the list (e.g., "profiles" relates to "users"), automatically add a foreign key reference field (e.g., "userId": "string", required: true).
   - Mark logical fields as required.
4. Hard rules:
   - The exact field name "id" is strictly forbidden (MongoDB creates _id). Use "userId", "profileId", etc.
   - Field names must be camelCase alphanumeric.
   - Types must be one of: "string", "number", "boolean", "array", "object".

Return STRICT JSON:
{
  "valid": true,
  "resources": [
    {
      "resource": "users",
      "requiredFields": ["username"],
      "properties": [
        { "fieldName": "username", "fieldType": "string" },
        { "fieldName": "email", "fieldType": "string" }
      ]
    }
  ]
}`;

// For Option 2: Full System Natural Language Prompt
const INFER_SYSTEM_PROMPT = `You are an expert database and REST API architect.
The user will describe an application or system (e.g., "student management system").

TASKS:
1. Determine 2 to 5 essential database resources/collections (lowercase plural names).
2. Infer all necessary attributes, appropriate data types ("string", "number", "boolean", "array", "object"), and sensible required fields for each entity.
3. INFER RELATIONAL JOINS / FOREIGN KEYS: Ensure relational and junction entities contain foreign key attributes pointing to parent resources (e.g., "enrollments" must contain "studentId" and "courseId").
4. Never generate an exact "id" field.

Return STRICT JSON:
{
  "valid": true,
  "resources": [
    {
      "resource": "students",
      "requiredFields": ["name", "email"],
      "properties": [
        { "fieldName": "name", "fieldType": "string" },
        { "fieldName": "email", "fieldType": "string" }
      ]
    }
  ]
}`;

export const validatePrompt = async (payload) => {
    const isCustomMode = payload?.mode === "custom" && Array.isArray(payload?.resources);
    const systemPrompt = isCustomMode ? CUSTOM_SYSTEM_PROMPT : INFER_SYSTEM_PROMPT;
    const userContent = isCustomMode ? JSON.stringify(payload.resources) : String(payload.prompt || payload);

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
                    Authorization: `Bearer ${process.env.API_KEY}`,
                    "Content-Type": "application/json",
                    "HTTP-Referer": process.env.CLIENT_URL || "http://localhost:8000",
                    "X-Title": "MockAPI Generator",
                },
                body: JSON.stringify({
                    model,
                    messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: userContent },
                    ],
                    response_format: { type: "json_object" },
                    temperature: 0.1,
                }),
            });

            if (!response.ok) continue;

            const data = await response.json();
            const rawText = data.choices?.[0]?.message?.content?.trim();
            parsed = extractJSON(rawText);

            if (parsed?.valid) break;
        } catch {
            continue;
        }
    }

    if (!parsed || !parsed.valid || !Array.isArray(parsed.resources)) {
        return { valid: false, resources: [] };
    }

    // Sanitize and format the verified resources
    const sanitizedResources = parsed.resources.map((item) => {
        const resourceName = (item.resource || "items")
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9]/g, "");

        const properties = (item.properties || [])
            .map((p) => ({
                fieldName: String(p.fieldName || "").trim().replace(/[^a-zA-Z0-9]/g, ""),
                fieldType: ["string", "number", "boolean", "array", "object"].includes(String(p.fieldType).toLowerCase())
                    ? String(p.fieldType).toLowerCase()
                    : "string",
            }))
            .filter((p) => p.fieldName.length > 0 && p.fieldName.toLowerCase() !== "id");

        const validNames = new Set(properties.map((p) => p.fieldName));
        const requiredFields = (item.requiredFields || [])
            .map((f) => String(f).trim().replace(/[^a-zA-Z0-9]/g, ""))
            .filter((f) => f.length > 0 && f.toLowerCase() !== "id" && validNames.has(f));

        return { resource: resourceName, requiredFields, properties };
    }).filter((r) => r.resource.length > 0);

    return {
        valid: sanitizedResources.length > 0,
        resources: sanitizedResources,
    };
};