import "dotenv/config";

const GEMINI_SYSTEM_PROMPT = `You are an expert REST API schema architect and relational database designer.

INPUT: A JSON array of resources requested by the user. Each resource object has:
- "name": String (the requested endpoint/entity name)
- "link": Boolean (if true, consider this resource for relational linking)
- "inferFields": Boolean (if true, generate exactly "inferFieldCount" fields)
- "fields": Array (if inferFields is false, keep these exact fields provided by the user)

YOUR TASKS - YOU MUST FOLLOW ALL OF THESE RULES:

1. ENTITY VALIDATION
   - Verify every single "name" in the input. Is it a real-world software data entity (e.g. users, hospitals, doctors, patients, products, orders)?
   - If ANY name is NOT a valid entity (e.g. "hello", "weather", random typing), you MUST set "valid": false and provide a clear "invalidReason" like "The entity 'hello' is not a valid data entity."
   - DO NOT proceed with schema generation if invalid.

2. FIELD RESOLUTION
   For valid entities, build the "properties" array:
   - If "inferFields": true -> Generate EXACTLY "inferFieldCount" number of sensible fields.
   - If "inferFields": false -> Use the exact "fields" provided by the user. Do not remove or alter them.

3. "ID" RESTRICTION
   - NO field name can be exactly "id", because MongoDB auto-generates _id.
   - If any generated or user field is exactly "id", change it to something descriptive (e.g. "userId").

4. SMART RELATIONAL LINKING
   - Look ONLY at the entities with "link": true.
   - Group them based on logical connectivity. (e.g., if you have [hospitals, doctors, patients, cats], cats is logically isolated. Hospitals, doctors, patients are related).
   - For logically connected entities, if a user hasn't provided a logical connection attribute (foreign key), ADD IT to the child entity.
   - The foreign key MUST use the <parentSingular>Id pattern (e.g., hospitalId).
   - Set "aiAdded": true ONLY for the relational fields you injected. All other fields must have "aiAdded": false.
   - Make sure to list all injected foreign key names in the "aiAddedFields" array for that resource.

OUTPUT: Return STRICT JSON using the following structure:
{
  "valid": <boolean>,
  "invalidReason": <string or null>,
  "resources": [
    {
      "name": "doctors",
      "aiAddedFields": ["hospitalId"], // only the fields YOU injected for relations
      "properties": [
        { "fieldName": "fullName", "fieldType": "String", "required": true, "aiAdded": false },
        { "fieldName": "hospitalId", "fieldType": "String", "required": true, "aiAdded": true }
      ]
    }
  ]
}`;

const normalizeType = (raw) => {
    const t = String(raw || "").toLowerCase().trim();
    if (["number", "integer", "float", "decimal"].includes(t)) return "Number";
    if (["boolean", "bool"].includes(t)) return "Boolean";
    if (["date", "datetime"].includes(t)) return "Date";
    if (["array", "list"].includes(t)) return "Array";
    if (["object", "json", "map"].includes(t)) return "Object";
    if (["objectid", "ref"].includes(t)) return "ObjectId";
    if (["mixed"].includes(t)) return "Mixed";
    if (["buffer"].includes(t)) return "Buffer";
    return "String";
};

export const generateUnifiedSchema = async (resourcesBatch) => {
    try {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) throw new Error("GEMINI_API_KEY is missing in env");

        console.log("[Gemini] Sending unified batch:", JSON.stringify(resourcesBatch));

        // Use the requested gemini-3.6-flash model
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                system_instruction: {
                    parts: [{ text: GEMINI_SYSTEM_PROMPT }]
                },
                contents: [{
                    role: "user",
                    parts: [{ text: JSON.stringify(resourcesBatch, null, 2) }]
                }],
                generationConfig: {
                    temperature: 0.1,
                    response_mime_type: "application/json",
                }
            })
        });

        if (!response.ok) {
            const err = await response.text();
            console.error("[Gemini] Request failed:", err);
            return { valid: false, invalidReason: "LLM Service Error" };
        }

        const rawJson = await response.json();
        const textOutput = rawJson.candidates?.[0]?.content?.parts?.[0]?.text;

        let parsed;
        try {
            parsed = JSON.parse(textOutput);
        } catch {
            return { valid: false, invalidReason: "Failed to parse LLM JSON" };
        }

        // Return early if AI flagged invalid entities
        if (parsed.valid === false) {
            return {
                valid: false,
                invalidReason: parsed.invalidReason || "One or more entities are invalid."
            };
        }

        // Sanitize out properties
        if (!Array.isArray(parsed.resources)) {
            return { valid: false, invalidReason: "LLM returned unexpected resource structure." };
        }

        const sanitizedResources = parsed.resources.map(r => {
            const props = Array.isArray(r.properties) ? r.properties : [];
            return {
                name: String(r.name || "").toLowerCase().trim(),
                aiAddedFields: Array.isArray(r.aiAddedFields) ? r.aiAddedFields.map(String) : [],
                properties: props.map(p => ({
                    fieldName: String(p.fieldName || "").trim().replace(/[^a-zA-Z0-9]/g, ""),
                    fieldType: normalizeType(p.fieldType),
                    required: p.required === true,
                    aiAdded: p.aiAdded === true
                })).filter(p => p.fieldName.length > 0 && p.fieldName.toLowerCase() !== "id")
            };
        });

        return { valid: true, resources: sanitizedResources };

    } catch (err) {
        console.error("[Gemini] Function error:", err);
        return { valid: false, invalidReason: "LLM Service internal error" };
    }
};