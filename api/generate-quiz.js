import Busboy from "busboy";

export const config = {
  api: {
    bodyParser: false
  }
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST allowed" });
  }

  try {
    const files = [];

    const busboy = Busboy({
      headers: req.headers
    });

    busboy.on("file", (fieldname, file, info) => {
      if (fieldname !== "images") {
        file.resume();
        return;
      }

      const chunks = [];

      file.on("data", chunk => {
        chunks.push(chunk);
      });

      file.on("end", () => {
        files.push({
          mimeType: info.mimeType || "image/jpeg",
          data: Buffer.concat(chunks).toString("base64")
        });
      });
    });

    busboy.on("finish", async () => {
      if (!files.length) {
        return res.status(400).json({
          error: "No images uploaded"
        });
      }

      const parts = files.slice(0, 5).map(file => ({
        inlineData: {
          mimeType: file.mimeType,
          data: file.data
        }
      }));

      parts.push({
        text: `
You are the question generator for U2Quiz.

IMPORTANT RULES:
1. Use ONLY information visible in the uploaded study pages.
2. Do NOT add outside knowledge.
3. Questions may come from all topics visible in the uploaded pages.
4. Generate every genuinely valid unique question you can find.
5. Do not repeat questions within this quiz.
6. If more than 50 valid questions exist, generate exactly 50.
7. If fewer than 20 valid questions exist, generate only the valid questions available.
8. Every question must have Hindi and English versions.
9. Every question must have exactly 4 options: A, B, C, D.
10. Include the correct answer and a short explanation.
11. Do not invent facts just to increase the number of questions.

Return ONLY valid JSON:

{
  "questions": [
    {
      "questionHindi": "हिंदी प्रश्न",
      "questionEnglish": "English question",
      "options": {
        "A": "Option A",
        "B": "Option B",
        "C": "Option C",
        "D": "Option D"
      },
      "correctAnswer": "A",
      "explanationHindi": "हिंदी में संक्षिप्त explanation",
      "explanationEnglish": "Short explanation in English"
    }
  ]
}
`
      });

      const response = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": process.env.GEMINI_API_KEY
          },
          body: JSON.stringify({
            contents: [
              {
                parts
              }
            ],
            generationConfig: {
              responseMimeType: "application/json"
            }
          })
        }
      );

      if (!response.ok) {
        const errorText = await response.text();

        return res.status(response.status).json({
          error: "Gemini API error",
          details: errorText
        });
      }

      const data = await response.json();

      const text =
        data?.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!text) {
        return res.status(500).json({
          error: "Gemini returned no questions"
        });
      }

      const quiz = JSON.parse(text);

      return res.status(200).json(quiz);
    });

    busboy.on("error", error => {
      return res.status(400).json({
        error: error.message
      });
    });

    req.pipe(busboy);

  } catch (error) {
    return res.status(500).json({
      error: error.message || "Something went wrong"
    });
  }
}
