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

Your ONLY job is to analyse the user's description and decide whether it is a genuine request to model one or more software data entities / resources for a REST API.

════════════════════════════════════════
STEP 1 — CLASSIFY THE PROMPT
════════════════════════════════════════

Return "valid": false  when ANY of the following are true:
  • It is a greeting, question, or general conversation (e.g. "how are you", "what's the weather", "who is the president of Pakistan").
  • It refers to a real-world person, political figure, geographic place, or historical event.
  • It is random words, gibberish, or has no coherent meaning.
  • It refers to a physical, non-digital concept that would NEVER be a database entity (e.g. "chair", "pizza").
  • It is a creative writing, joke, or off-topic request.

Return "valid": "ambiguous"  when:
  • The word COULD be a REST API resource but is also commonly used in non-API contexts, AND the user has provided NO additional context to confirm intent.
  • Examples: "president", "animal", "weather", "planet", "color".
  • Rule: a single generic noun with zero API / system context → ambiguous.

Return "valid": true  when the prompt clearly describes one or more data entities for an API, schema, or database, even if the user wrote it as a system name (e.g. "student management system", "hospital management system", "e-commerce platform").

════════════════════════════════════════
STEP 2 — IDENTIFY RESOURCES  (only when valid: true)
════════════════════════════════════════

A. EXPLICIT RESOURCES — user names the entities (e.g. "course and student entity and an enrollment entity").
   Count them exactly. Do not add or remove entities.

B. SYSTEM-LEVEL PROMPTS — user gives a system name without listing entities (e.g. "student management system").
   You must autonomously decide a sensible set of 2–5 resources that logically belong to that system.
   Resources must be logically connected: junction/relational resources MUST contain the appropriate foreign-key fields
   (e.g. an "enrollments" resource must have studentId and courseId fields of type string).

════════════════════════════════════════
STEP 3 — DETERMINE FIELDS  (only when valid: true)
════════════════════════════════════════

Follow the FIRST matching rule:

1. USER PROVIDES EXPLICIT FIELDS → use those field names exactly; do not add or remove any unless rule 2 applies.
2. USER PROVIDES SOME FIELDS + ASKS FOR MORE → keep every user-supplied field, then infer sensible additional ones.
3. USER SPECIFIES A TOTAL COUNT (e.g. "5 fields") → generate exactly that many fields; pick the most appropriate ones.
4. USER PROVIDES ONLY THE ENTITY NAME (e.g. "create user") → infer all fields and their count entirely on your own; choose what makes the most sense for that entity.

════════════════════════════════════════
HARD RULES (always enforced)
════════════════════════════════════════
• The field named exactly "id" (case-insensitive) is STRICTLY FORBIDDEN. Never generate it. MongoDB creates _id automatically. Fields like userId, productId, courseId, studentId are fine.
• Field names must be single camelCase alphanumeric identifiers with no spaces or special characters.
• Every field must have a type: string | number | boolean | array | object.
• requiredFields must only contain names that also appear in that entity's properties list.
• Resource names must be lowercase plural words (e.g. "students", "courses", "enrollments").
• Do NOT output any explanation, preamble, or text outside the JSON object.

════════════════════════════════════════
OUTPUT FORMAT
════════════════════════════════════════

Invalid prompt:
{
  "valid": false,
  "resourceCount": 0,
  "resources": []
}

Ambiguous prompt:
{
  "valid": "ambiguous",
  "resourceCount": 0,
  "resources": []
}

Valid prompt:
{
  "valid": true,
  "resourceCount": 2,
  "resources": [
    {
      "resource": "students",
      "requiredFields": ["name", "email"],
      "properties": [
        { "fieldName": "name",  "fieldType": "string" },
        { "fieldName": "email", "fieldType": "string" },
        { "fieldName": "age",   "fieldType": "number" }
      ]
    },
    {
      "resource": "enrollments",
      "requiredFields": ["studentId", "courseId"],
      "properties": [
        { "fieldName": "studentId", "fieldType": "string" },
        { "fieldName": "courseId",  "fieldType": "string" },
        { "fieldName": "enrolledAt","fieldType": "string" }
      ]
    }
  ]
}`;

export const validatePrompt = async (promptText) => {
    if (!promptText || typeof promptText !== "string" || !promptText.trim()) {
        return {
            valid: false,
            ambiguous: false,
            resourceCount: 0,
            resources: [],
        };
    }

    // Free tier fallback chain
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
                    temperature: 0.15,
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

    // Could not get any response
    if (!parsed) {
        return { valid: false, ambiguous: false, resourceCount: 0, resources: [] };
    }

    // Ambiguous prompt — LLM is saying "needs more detail"
    if (parsed.valid === "ambiguous") {
        return { valid: false, ambiguous: true, resourceCount: 0, resources: [] };
    }

    // Explicitly invalid or no resources returned
    if (!parsed.valid || !Array.isArray(parsed.resources) || parsed.resources.length === 0) {
        return { valid: false, ambiguous: false, resourceCount: 0, resources: [] };
    }

    // Sanitise resources
    const sanitizedResources = parsed.resources
        .map((item) => {
            const resourceName = (item.resource || "items")
                .toLowerCase()
                .trim()
                .replace(/[^a-z0-9]/g, "");

            const properties = (item.properties || [])
                .map((p) => ({
                    fieldName:
                        typeof p.fieldName === "string"
                            ? p.fieldName.trim().replace(/[^a-zA-Z0-9]/g, "")
                            : "",
                    fieldType: ["string", "number", "boolean", "array", "object"].includes(p.fieldType)
                        ? p.fieldType
                        : "string",
                }))
                // Hard-ban the literal field name "id" (case-insensitive)
                .filter(
                    (p) => p.fieldName.length > 0 && p.fieldName.toLowerCase() !== "id"
                );

            const validFieldNames = new Set(properties.map((p) => p.fieldName));
            const requiredFields = (item.requiredFields || [])
                .map((f) =>
                    typeof f === "string" ? f.trim().replace(/[^a-zA-Z0-9]/g, "") : ""
                )
                .filter(
                    (f) =>
                        f.length > 0 &&
                        f.toLowerCase() !== "id" &&
                        validFieldNames.has(f)
                );

            return { resource: resourceName, requiredFields, properties };
        })
        // Drop any resource whose name sanitised to nothing
        .filter((r) => r.resource.length > 0);

    if (sanitizedResources.length === 0) {
        return { valid: false, ambiguous: false, resourceCount: 0, resources: [] };
    }

    return {
        valid: true,
        ambiguous: false,
        resourceCount: sanitizedResources.length,
        resources: sanitizedResources,
    };
};