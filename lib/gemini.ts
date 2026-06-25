export async function isReceipt(imageUrl: string): Promise<boolean> {
  const res = await fetch(imageUrl);
  const buf = Buffer.from(await res.arrayBuffer());
  const base64 = buf.toString("base64");

  const body = {
    contents: [
      {
        parts: [
          {
            text: "この画像はレシートまたは領収書ですか？ yes か no のみで答えてください。",
          },
          { inline_data: { mime_type: "image/jpeg", data: base64 } },
        ],
      },
    ],
  };

  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );

  const j = await r.json();

  if (!r.ok) {
    const msg = j?.error?.message ?? `Gemini API error (${r.status})`;
    throw new Error(`Gemini: ${msg}`);
  }

  const text: string =
    j?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  return text.trim().toLowerCase().startsWith("yes");
}
