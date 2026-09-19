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

// Option 1 — Pure custom mode: user supplied all resources, some with manual fields, some with inferFields:true
const CUSTOM_SYSTEM_PROMPT = `You are a strict REST API schema architect.

INPUT: A JSON array of resource definitions.
Each item is either:
  a) Manual  → has a 'fields' array  (keep those fields EXACTLY as given)
  b) Inferred → has 'inferFields': true  (you must generate realistic fields)

TASKS:
1. VALIDATE NAMES: Every 'name' must be a real-world software data entity (e.g. students, orders, products, invoices).
   - Reject anything that is not a domain entity: greetings, weather questions, random words, nonsense.
   - If ANY name is invalid set "valid": false and stop.
2. MANUAL FIELDS: Keep 'name', 'type', and 'required' EXACTLY as given. Never alter them.
3. INFER FIELDS: For inferFields:true items:
   - The 'count' value is the MINIMUM number of domain fields to generate (not counting FK fields). Generate AT LEAST that many. Default to 4 if count is missing.
   - First generate the domain fields (at least 'count' of them), THEN add any foreign-key fields on top.
4. CROSS-RESOURCE CONNECTIVITY: Analyse all resources together.
   - Add foreign-key fields to link related resources (e.g. if 'students' exists and you are inferring 'enrollments', add studentId).
   - ALL foreign-key fields you add MUST appear in that resource's 'requiredFields' array.
5. HARD RULES:
   - Field named exactly "id" is FORBIDDEN. Use compound names like userId, studentId.
   - Field names: camelCase, alphanumeric only.
   - Allowed types: String, Number, Boolean, Array, Object.
   - requiredFields must only list names that exist in the properties array.

OUTPUT: Return STRICT JSON ONLY. No explanations.
{
  "valid": true,
  "resources": [
    {
      "resource": "enrollments",
      "requiredFields": ["studentId", "courseId", "enrollmentDate"],
      "properties": [
        { "fieldName": "studentId",      "fieldType": "String" },
        { "fieldName": "courseId",       "fieldType": "String" },
        { "fieldName": "enrollmentDate", "fieldType": "String" },
        { "fieldName": "grade",          "fieldType": "String" }
      ]
    }
  ]
}`;



// Option 2 — Full system inference: user typed a system name, AI figures everything out
const INFER_SYSTEM_PROMPT = `You are an expert database architect and REST API spec generator.

INPUT: The user describes a software system by name (e.g. 'student management system').

STEP 1 — VALIDATE:
  The input MUST describe a recognisable software system that can be modelled as a group of database entities.
  Valid examples: hospital management system, e-commerce platform, library system, hotel booking app.
  INVALID examples: 'how are you', 'what is the weather', random words, greetings, nonsense phrases.
  If the input is NOT a valid system description, return: { "valid": false, "resources": [] }

STEP 2 — DESIGN (only if valid):
  1. Determine 2 to 5 essential database resources (lowercase plural names) for this system.
  2. Infer sensible camelCase attributes with appropriate types (String, Number, Boolean, Array, Object) and required flags.
  3. CROSS-RESOURCE CONNECTIVITY: Ensure child resources contain foreign key fields pointing to parent resources (e.g. orders must include a userId field if users exists).
  4. HARD RULE: Never generate a field named exactly 'id'. Use descriptive compound names (userId, productId, etc.).

OUTPUT: Return STRICT JSON ONLY. No explanations.
{
  "valid": true,
  "resources": [
    {
      "resource": "students",
      "requiredFields": ["fullName"],
      "properties": [
        { "fieldName": "fullName", "fieldType": "String" }
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
        // Build a normalised description of every resource for the LLM.
        // Manual resources carry their 'fields' array; inferred ones carry inferFields+count.
        const inputForLLM = resources.map(r => {
            if (r.inferFields) {
                return { name: r.name, inferFields: true, count: r.count ?? 4 };
            }
            return {
                name: r.name,
                fields: (r.fields || []).map(f => ({
                    name: f.name,
                    type: f.type,
                    required: f.required ?? false,
                })),
            };
        });
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

    // 3. Define Models (Updated to use reliable models for JSON analysis)
    const candidateModels = [
        "rwkv/rwkv-7-2.9b",            // Currently reliable free model for JSON adherence
        "google/gemma-2-9b-it:free",  // Fallback
        "openrouter/free",              // General free fallback
    ];

    let parsed = null;

    // 4. LLM Call Loop
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
                    // response_format: { type: "json_object" }, // Many free models don't support this yet, extractJSON handles it.
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

    // 5. Check if any model succeeded
    if (!parsed || parsed.valid !== true || !Array.isArray(parsed.resources)) {
        return { valid: false, resources: [] };
    }

    // 6. Sanitization and Format Standardization
    try {
        const sanitizedResources = parsed.resources.map((item) => {
            // Standardize Resource Name: lowercase, plural, alphanumeric
            const resourceName = (item.resource || "items")
                .toLowerCase()
                .trim()
                .replace(/[^a-z0-9]/g, "");

            // Ensure properties is an array
            const rawProperties = Array.isArray(item.properties) ? item.properties : [];

            // Sanitize Properties
            const properties = rawProperties
                .map((p) => {
                    const fieldName = String(p?.fieldName || p?.name || "").trim().replace(/[^a-zA-Z0-9]/g, "");
                    const rawType = String(p?.fieldType || p?.type || "").toLowerCase();

                    // Standardize Types
                    let fieldType = "String"; // Default
                    if (["number", "integer", "float"].includes(rawType)) fieldType = "Number";
                    else if (["boolean", "bool"].includes(rawType)) fieldType = "Boolean";
                    else if (["array", "list"].includes(rawType)) fieldType = "Array";
                    else if (["object", "json", "map"].includes(rawType)) fieldType = "Object";

                    return { fieldName, fieldType };
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

            return { resource: resourceName, requiredFields, properties };
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