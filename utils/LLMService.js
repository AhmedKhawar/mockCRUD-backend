import "dotenv/config";

// Robust JSON extraction helper
const extractJSON = (text) => {
  if (!text) throw new Error("Empty response received from model");

  // 1. Strip markdown code fences if present
  let cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();

  // 2. Find the outermost JSON object bounds
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error(`Model output did not contain a valid JSON object. Raw: "${text}"`);
  }

  // 3. Slice strictly the JSON substring, ignoring any safety prefixes or suffixes
  const jsonSubstring = cleaned.substring(firstBrace, lastBrace + 1);
  return JSON.parse(jsonSubstring);
};

export const getSpec = async (desc) => {
  const systemPrompt = `You are a strict REST API architect.
Extract the resource schema from the description and return valid JSON matching this exact structure:
{
  "resource": "lowercase_plural_name",
  "requiredFields": ["field1", "field2"],
  "properties": [
    { "fieldName": "field1", "fieldType": "string|number|boolean|array|object" }
  ]
}
Rules:
- Output valid raw JSON only.
- Do NOT output preamble, explanations, or safety notes (e.g., do not say "User Safety: safe").
- Resource name must strictly be a single lowercase plural word.
- Field names in properties and requiredFields must strictly be single alphanumeric identifier words (no spaces, no tokens).
- Every entry in requiredFields must strictly match an existing fieldName in the properties list.`;

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://localhost:8000",
      "X-Title": "MockAPI Generator",
    },
    body: JSON.stringify({
      model: "openrouter/free",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Extract the resource schema based on this description: "${desc}"` },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
    }),
  });

  if (!response.ok) {
    const errorData = await response.text();
    throw new Error(`OpenRouter API error (${response.status}): ${errorData}`);
  }

  const data = await response.json();
  const rawText = data.choices?.[0]?.message?.content?.trim();

  // Safely parse using the slice extractor
  const parsed = extractJSON(rawText);

  // 1. Sanitize resource name
  const resource = (parsed.resource || "items").toLowerCase().trim().split(/\s+/)[0];

  // 2. Sanitize property field names
  const properties = (parsed.properties || [])
    .map((prop) => ({
      fieldName: typeof prop.fieldName === "string" ? prop.fieldName.trim().split(/\s+/)[0] : "",
      fieldType: prop.fieldType || "string",
    }))
    .filter((prop) => prop.fieldName.length > 0);

  // 3. Build set of valid fields and sanitize requiredFields
  const validFields = new Set(properties.map((p) => p.fieldName));
  const requiredFields = (parsed.requiredFields || [])
    .map((f) => (typeof f === "string" ? f.trim().split(/\s+/)[0] : ""))
    .filter((f) => f.length > 0 && validFields.has(f));

  // 4. Construct the 5 endpoints
  const endpoints = [
    {
      method: "GET",
      path: `/${resource}`,
      description: `Retrieve all ${resource}`,
      properties,
    },
    {
      method: "GET",
      path: `/${resource}/:id`,
      description: `Retrieve a single ${resource.slice(0, -1) || resource} by ID`,
      properties,
    },
    {
      method: "POST",
      path: `/${resource}`,
      description: `Create a new ${resource.slice(0, -1) || resource}`,
      requiredFields,
      properties,
    },
    {
      method: "PUT",
      path: `/${resource}/:id`,
      description: `Update an existing ${resource.slice(0, -1) || resource} by ID`,
      requiredFields,
      properties,
    },
    {
      method: "DELETE",
      path: `/${resource}/:id`,
      description: `Delete a ${resource.slice(0, -1) || resource} by ID`,
      properties: [{ fieldName: "id", fieldType: "string" }],
    },
  ];

  return {
    resource,
    endpoints,
  };
};