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

Your ONLY job is to determine if the user's description is a genuine request to model one or more software data entities / resources for a REST API.

════════════════════════════════════════
STEP 1 — EVALUATE OVERALL INTENT FIRST
════════════════════════════════════════

Read the ENTIRE prompt before making any judgment. Ask yourself:
"Is this person clearly trying to define one or more database resources / API entities?"

STRONG SIGNALS OF VALID API INTENT (any one is enough to treat as valid):
  • Uses action words: create, generate, build, define, add, make, model
  • Lists multiple entities (numbered or comma-separated)
  • Mentions field names or field counts ("with name/email", "5 fields each")
  • Uses comment syntax // or # to label items
  • Mentions a system, app, platform, or API (e.g. "management system", "e-commerce")
  • Words are used as plural collection names in context (e.g. "presidents entity", "animals resource")

IMPORTANT: When the prompt has ANY of the above signals, treat the ENTIRE prompt as valid — even if individual words in it (like "presidents", "animals", "planets") could be ambiguous on their own.

STEP 2 — CLASSIFY (only after reading the full prompt)
════════════════════════════════════════

Return "valid": false  ONLY when ALL of the following are true:
  • There are zero API intent signals from Step 1
  • The prompt is a question, greeting, or general statement ("how are you", "what's the weather today")
  • OR it describes a real-world event/person/place with no resource-creation intent ("who is the president of Pakistan")
  • OR it is pure gibberish with no coherent meaning

Return "valid": "ambiguous"  ONLY when:
  • There are zero API intent signals
  • The prompt is a single generic noun with no context that could mean either a REST resource OR a real-world concept
  • Example: just the word "president" or just "animal" alone with nothing else
  • Do NOT return ambiguous if there are multiple entities, field counts, or action words present

Return "valid": true  in ALL other cases, including:
  • Numbered or bulleted lists of resource names, even ones that sound real-world
  • Single entity names with field info ("presidents with 4 fields")
  • System-level descriptions ("student management system")
  • Mixed lists ("student and animal with 4 fields each")

════════════════════════════════════════
STEP 3 — IDENTIFY RESOURCES (valid: true only)
════════════════════════════════════════

A. EXPLICIT RESOURCES — user names the entities (e.g. "course and student entity").
   Count them exactly. Do not add or remove entities.

B. SYSTEM-LEVEL PROMPTS — user gives a system name without listing entities (e.g. "student management system").
   Autonomously decide 2–5 resources that logically belong.
   Junction resources MUST contain appropriate foreign-key fields (e.g. enrollments needs studentId and courseId).

════════════════════════════════════════
STEP 4 — DETERMINE FIELDS (valid: true only)
════════════════════════════════════════

Follow the FIRST matching rule:
1. USER PROVIDES EXPLICIT FIELDS → use those field names exactly.
2. USER PROVIDES SOME FIELDS + ASKS FOR MORE → keep user's fields, infer more.
3. USER SPECIFIES A COUNT (e.g. "5 fields" or "4 fields each") → generate exactly that many appropriate fields per resource.
4. USER PROVIDES ONLY THE ENTITY NAME → infer all fields and their count on your own.

If the same field count applies "each" or "per resource", apply it to ALL resources in the list.

════════════════════════════════════════
HARD RULES (always enforced)
════════════════════════════════════════
• The field named exactly "id" (case-insensitive) is STRICTLY FORBIDDEN. MongoDB creates _id. Fields like userId, productId are fine.
• Field names must be camelCase alphanumeric identifiers with no spaces or special characters.
• Every field must have a type: string | number | boolean | array | object.
• requiredFields must only contain names that also appear in that entity's properties list.
• Resource names must be lowercase plural words (e.g. "students", "presidents", "animals").
• Do NOT output any explanation or text outside the JSON object.

════════════════════════════════════════
OUTPUT FORMAT
════════════════════════════════════════

Invalid:   { "valid": false, "resourceCount": 0, "resources": [] }
Ambiguous: { "valid": "ambiguous", "resourceCount": 0, "resources": [] }
Valid:
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