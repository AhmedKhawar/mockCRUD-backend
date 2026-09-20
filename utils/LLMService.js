import "dotenv/config";

// --- HELPERS ---

// Safe JSON extraction: returns null instead of throwing unhandled exceptions
const extractJSON = (text) => {
    if (!text) return null;

    // Remove markdown code blocks and whitespace
    const cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");

    // Validate basic structure
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
        return null;
    }

    try {
        // Parse only the substring containing the JSON object
        return JSON.parse(cleaned.substring(firstBrace, lastBrace + 1));
    } catch {
        return null;
    }
};

// --- PROMPTS ---

// Option 1 — Custom mode: user supplied resource names + fields.
// AI validates names, keeps fields EXACTLY, and adds any missing FK fields for logical joins.
const CUSTOM_SYSTEM_PROMPT = `You are a strict REST API schema architect.

CONTEXT — MongoDB ID convention:
  MongoDB auto-generates an "_id" field for every document. This is returned to API clients as "id".
  Therefore:
  - NEVER generate or allow a field named exactly "id".
  - Foreign-key fields in child resources (e.g. "studentId" in "enrollments") are references to the MongoDB "_id" of the parent document.
  - You do NOT need to add an "id" field to parent resources — it is auto-generated.

INPUT: A JSON array of resource definitions. Each item has:
  - "name": the resource name (must be a real-world data entity)
  - "fields": array of { name, type, required } the user defined

TASKS:
1. VALIDATE NAMES: Every "name" must be a real-world software data entity (e.g. students, orders, products, invoices).
   - Reject anything that is NOT a domain entity: greetings, weather questions, random words, nonsense.
   - If ANY name is invalid set "valid": false and stop.

2. KEEP USER FIELDS EXACTLY: For each resource, preserve every field the user defined.
   - Do NOT rename, remove, or alter user-supplied fields in any way.
   - Treat user-supplied "required: true" fields as required; honour "required: false" as non-required.

3. DETECT MISSING RELATIONAL JOINS: Analyse ALL resources together.
   - If two or more resources form a logical parent→child or many-to-many relationship (e.g. students + courses → enrollments), check whether the child resource already contains the necessary foreign-key fields.
   - If a needed FK field is MISSING, add it. Use the naming pattern: <parentSingular>Id (e.g. studentId, courseId).
   - The FK field type is always "String" and it is always required.
   - Mark every field YOU add with "aiAdded": true. User-supplied fields get "aiAdded": false.
   - List the names of every field you added in "aiAddedFields" for that resource.

4. HARD RULES:
   - Field named exactly "id" is FORBIDDEN. Use compound names (userId, studentId, etc.).
   - Field names: camelCase, alphanumeric only.
   - Allowed types: String, Number, Boolean, Array, Object.
   - "requiredFields" must only list names that exist in the "properties" array.
   - "aiAddedFields" lists only the names of fields you injected; empty array [] if none.

OUTPUT: Return STRICT JSON ONLY. No explanations, no markdown, no text before or after.
{
  "valid": true,
  "resources": [
    {
      "resource": "enrollments",
      "requiredFields": ["enrollmentDate", "studentId", "courseId"],
      "aiAddedFields": ["studentId", "courseId"],
      "properties": [
        { "fieldName": "enrollmentDate", "fieldType": "String", "aiAdded": false },
        { "fieldName": "grade",          "fieldType": "String", "aiAdded": false },
        { "fieldName": "studentId",      "fieldType": "String", "aiAdded": true  },
        { "fieldName": "courseId",       "fieldType": "String", "aiAdded": true  }
      ]
    }
  ]
}`;


// Option 2 — Full system inference: user typed a system name, AI figures everything out
const INFER_SYSTEM_PROMPT = `You are an expert database architect and REST API spec generator.

CONTEXT — MongoDB ID convention (CRITICAL):
  MongoDB auto-generates an "_id" field for every document. This is exposed to API clients as "id".
  Therefore:
  - NEVER generate a field named exactly "id" in any resource.
  - Foreign-key fields in child resources (e.g. "studentId" in "enrollments") reference the MongoDB "_id" of the parent document. You do not need an explicit "id" field on parent resources.
  - Example: if "students" and "courses" exist, the "enrollments" resource should have "studentId" and "courseId" fields. These are references to the auto-generated "_id" of the student and course documents respectively.

INPUT: The user describes a software system by name (e.g. "student management system").

STEP 1 — VALIDATE:
  The input MUST describe a recognisable software system that can be modelled as a group of database entities.
  Valid examples: hospital management system, e-commerce platform, library system, hotel booking app, inventory tracker.
  INVALID examples: "how are you", "what is the weather", random words, greetings, nonsense phrases.
  If the input is NOT a valid system description, return: { "valid": false, "resources": [] }

STEP 2 — DESIGN (only if valid):
  1. Determine 2 to 5 essential database resources (lowercase plural names) for this system.
  2. Infer sensible camelCase attributes with appropriate types (String, Number, Boolean, Array, Object) and required flags.
  3. CROSS-RESOURCE CONNECTIVITY: Ensure child resources contain foreign-key fields pointing to parent resources (e.g. "enrollments" must include "studentId" AND "courseId" if both "students" and "courses" exist).
  4. Mark every foreign-key field you generate with "aiAdded": true. All other fields get "aiAdded": false.
  5. List names of AI-added FK fields per resource in "aiAddedFields".

HARD RULES:
  - NEVER generate a field named exactly "id". Use descriptive compound names (userId, productId, etc.).
  - All field names must be camelCase, alphanumeric only.
  - Allowed types: String, Number, Boolean, Array, Object.
  - "requiredFields" must only reference field names that exist in the "properties" array.
  - "aiAddedFields" lists only the names of FK/relational fields you generated; empty [] if none.

OUTPUT: Return STRICT JSON ONLY. No explanations, no markdown.
{
  "valid": true,
  "resources": [
    {
      "resource": "students",
      "requiredFields": ["fullName", "email"],
      "aiAddedFields": [],
      "properties": [
        { "fieldName": "fullName",  "fieldType": "String",  "aiAdded": false },
        { "fieldName": "email",     "fieldType": "String",  "aiAdded": false },
        { "fieldName": "phone",     "fieldType": "String",  "aiAdded": false }
      ]
    },
    {
      "resource": "enrollments",
      "requiredFields": ["studentId", "courseId", "enrollmentDate"],
      "aiAddedFields": ["studentId", "courseId"],
      "properties": [
        { "fieldName": "enrollmentDate", "fieldType": "String", "aiAdded": false },
        { "fieldName": "grade",          "fieldType": "String", "aiAdded": false },
        { "fieldName": "studentId",      "fieldType": "String", "aiAdded": true  },
        { "fieldName": "courseId",       "fieldType": "String", "aiAdded": true  }
      ]
    }
  ]
}`;


// --- MAIN SERVICE ---

export const validatePrompt = async (payload) => {
    const mode = payload?.mode;
    const resources = payload?.resources;  // present in custom mode
    const systemName = payload?.systemName; // present in infer mode

    let systemPrompt;
    let finalUserPrompt;

    if (mode === "custom" && Array.isArray(resources) && resources.length > 0) {
        // --- CUSTOM MODE ---
        // Each resource now always has { name, fields: [...] }. No inferFields.
        const inputForLLM = resources.map(r => ({
            name: r.name,
            fields: (r.fields || []).map(f => ({
                name: f.name,
                type: f.type,
                required: f.required ?? false,
            })),
        }));
        systemPrompt = CUSTOM_SYSTEM_PROMPT;
        finalUserPrompt = `ANALYZE THIS JSON ARRAY AND GENERATE SCHEMAS:\n${JSON.stringify(inputForLLM)}`;

    } else if (mode === "infer" && typeof systemName === "string" && systemName.trim().length > 0) {
        // --- INFER MODE ---
        systemPrompt = INFER_SYSTEM_PROMPT;
        finalUserPrompt = systemName.trim();

    } else {
        // Unknown or empty payload
        return { valid: false, resources: [] };
    }

    // Define Models
    const candidateModels = [
        "rwkv/rwkv-7-2.9b",            // Currently reliable free model for JSON adherence
        "google/gemma-2-9b-it:free",  // Fallback
        "openrouter/free",              // General free fallback
    ];

    let parsed = null;

    // LLM Call Loop
    for (const model of candidateModels) {
        try {
            console.log(`Attempting generation with model: ${model}`);
            const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${process.env.API_KEY}`,
                    "Content-Type": "application/json",
                    "HTTP-Referer": process.env.CLIENT_URL || "http://localhost:3000",
                    "X-Title": "MockAPI Generator",
                },
                body: JSON.stringify({
                    model,
                    messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: finalUserPrompt },
                    ],
                    temperature: 0.1, // Keep deterministic
                    max_tokens: 2000,
                }),
            });

            if (!response.ok) {
                const errorLog = await response.text();
                console.error(`Model ${model} failed:`, errorLog);
                continue;
            }

            const data = await response.json();
            const rawText = data.choices?.[0]?.message?.content?.trim();
            console.log(`Raw output from ${model}:`, rawText);

            parsed = extractJSON(rawText);

            // If parsed successfully and valid is true, break loop
            if (parsed?.valid === true && Array.isArray(parsed.resources)) {
                console.log(`Successfully parsed valid JSON from ${model}`);
                break;
            } else {
                console.log(`Parsed JSON invalid or not successful from ${model}. valid flag: ${parsed?.valid}`);
                parsed = null; // reset and try next model
            }
        } catch (err) {
            console.error(`Error communicating with ${model}:`, err.message);
            continue;
        }
    }

    // Check if any model succeeded
    if (!parsed || parsed.valid !== true || !Array.isArray(parsed.resources)) {
        return { valid: false, resources: [] };
    }

    // Sanitization and Format Standardization
    try {
        const sanitizedResources = parsed.resources.map((item) => {
            // Standardize Resource Name: lowercase, plural, alphanumeric
            const resourceName = (item.resource || "items")
                .toLowerCase()
                .trim()
                .replace(/[^a-z0-9]/g, "");

            // Ensure properties is an array
            const rawProperties = Array.isArray(item.properties) ? item.properties : [];

            // Sanitize Properties — preserve aiAdded flag
            const properties = rawProperties
                .map((p) => {
                    const fieldName = String(p?.fieldName || p?.name || "").trim().replace(/[^a-zA-Z0-9]/g, "");
                    const rawType = String(p?.fieldType || p?.type || "").toLowerCase();
                    const aiAdded = p?.aiAdded === true;

                    // Standardize Types
                    let fieldType = "String"; // Default
                    if (["number", "integer", "float"].includes(rawType)) fieldType = "Number";
                    else if (["boolean", "bool"].includes(rawType)) fieldType = "Boolean";
                    else if (["array", "list"].includes(rawType)) fieldType = "Array";
                    else if (["object", "json", "map"].includes(rawType)) fieldType = "Object";

                    return { fieldName, fieldType, aiAdded };
                })
                // Filter out empty names or forbidden "id" literal
                .filter((p) => p.fieldName.length > 0 && p.fieldName.toLowerCase() !== "id");

            // Ensure validNames Set for requiredFields check
            const validNames = new Set(properties.map((p) => p.fieldName));

            // Ensure requiredFields is an array
            const rawRequired = Array.isArray(item.requiredFields) ? item.requiredFields : [];

            // Sanitize Required Fields
            const requiredFields = rawRequired
                .map((f) => String(f).trim().replace(/[^a-zA-Z0-9]/g, ""))
                // Must exist in properties, not empty, not "id"
                .filter((f) => f.length > 0 && f.toLowerCase() !== "id" && validNames.has(f));

            // Collect aiAddedFields — either from LLM output or derived from properties
            const rawAiAdded = Array.isArray(item.aiAddedFields) ? item.aiAddedFields : [];
            const aiAddedFields = rawAiAdded.length > 0
                ? rawAiAdded
                    .map(f => String(f).trim().replace(/[^a-zA-Z0-9]/g, ""))
                    .filter(f => f.length > 0 && f.toLowerCase() !== "id" && validNames.has(f))
                // Fallback: derive from properties that have aiAdded: true
                : properties.filter(p => p.aiAdded).map(p => p.fieldName);

            return { resource: resourceName, requiredFields, aiAddedFields, properties };
        })
            // Remove resources that ended up with no name
            .filter((r) => r.resource.length > 0);

        return {
            valid: sanitizedResources.length > 0,
            resources: sanitizedResources,
        };
    } catch (sanitizationError) {
        console.error("Critical error during sanitization:", sanitizationError);
        return { valid: false, resources: [] };
    }
};