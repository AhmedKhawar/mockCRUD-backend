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

// Option 1: Validates user-defined JSON resources and infers missing fields/connections
const CUSTOM_SYSTEM_PROMPT = `You are a strict REST API schema architect and JSON analyzer.

INPUT: You will receive a JSON ARRAY containing resource definitions in the USER PROMPT.
Analyze the input data. Some resources have manual fields ("fields" array), while others have "inferFields": true.

TASKS:
1. VALIDATE NAMES: Ensure every "name" in the input is a sensible software data collection (lowercase plural, e.g., "users", "profiles"). If any name is gibberish, invalid, or inappropriate, set output "valid": false and stop.
2. MANUAL FIELDS: For resources with a "fields" array, keep their "name", "type", and "required" status EXACTLY as provided. Do not modify.
3. INFER FIELDS: For resources with "inferFields": true:
   - Generate realistic fields matching the requested "count" (default to 3-5 if count is missing).
   - INFER CONNECTIONS: Look at other resources in the input array. Automatically add logical foreign key fields. (E.g., if analyzing "profiles" and "Users" exists in input, automatically add { "name": "userId", "type": "String", "required": true }).
4. HARD RULES:
   - Field named exactly "id" is FORBIDDEN. MongoDB creates _id automatically. Use "userId", "productId".
   - Field names must be camelCase alphanumeric.
   - Types must be: "String", "Number", "Boolean", "Array", "Object".

OUTPUT: Return STRICT JSON ONLY following this example format. Do not include explanations.
{
  "valid": true,
  "resources": [
    {
      "resource": "users",
      "requiredFields": ["username"],
      "properties": [
        { "fieldName": "username", "fieldType": "String" }
      ]
    }
  ]
}`;

// Option 2: Full System Natural Language Prompt
const INFER_SYSTEM_PROMPT = `You are an expert database architect and REST API spec generator.

INPUT: The user will describe a system (e.g., "student management system") in the USER PROMPT.

TASKS:
1. Determine 2 to 5 essential database resources (lowercase plural names) for this system.
2. Infer necessary attributes, appropriate data types ("String", "Number", "Boolean", "Array", "Object"), and sensible required fields for each entity.
3. INFER CONNECTIONS: Ensure entities contain foreign key attributes pointing to parent resources (e.g., an "orders" resource must contain a "userId" field).
4. HARD RULE: Never generate a field named exactly "id". Use MongoDB compatible naming (e.g. userId).

OUTPUT: Return STRICT JSON ONLY following this example format. Do not include explanations.
{
  "valid": true,
  "resources": [
    {
      "resource": "students",
      "requiredFields": ["name"],
      "properties": [
        { "fieldName": "name", "fieldType": "String" }
      ]
    }
  ]
}`;

// --- MAIN SERVICE ---

export const validatePrompt = async (payload) => {
    // 1. Determine Mode and content
    const isCustomMode = payload?.mode === "custom" && Array.isArray(payload?.resources);

    // If custom mode, userContent must be the JSON string of resources.
    // Otherwise, use payload.prompt or the payload itself as a string.
    const userContent = isCustomMode
        ? JSON.stringify(payload.resources)
        : String(payload?.prompt || payload || "");

    if (!userContent || userContent.trim() === "" || userContent === "[]") {
        return { valid: false, resources: [] };
    }

    // 2. Setup Prompt and User Instruction based on mode
    let systemPrompt;
    let finalUserPrompt;

    if (isCustomMode) {
        systemPrompt = CUSTOM_SYSTEM_PROMPT;
        // We must explicitly tell the model the user prompt is JSON data to analyze
        finalUserPrompt = `ANALYZE THIS JSON DATA ARRAY AND GENERATE SCHEMAS ACCORDING TO SYSTEM RULES:\n${userContent}`;
    } else {
        systemPrompt = INFER_SYSTEM_PROMPT;
        finalUserPrompt = userContent; // Standard natural language prompt
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