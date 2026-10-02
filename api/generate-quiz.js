import Busboy from "busboy";

export const config = {
  api: {
    bodyParser: false
  }
};

const MODEL = "gemini-2.5-flash";

const PROMPT = `
You are the question generator for U2Quiz.

IMPORTANT RULES:

1. Use ONLY information visible in the uploaded study pages.
2. Do NOT use outside knowledge.
3. Questions may come from all uploaded pages.
4. Generate every genuinely valid unique question you can find.
5. Do not repeat questions.
6. Maximum 50 questions.
7. If fewer valid questions exist, generate only those.
8. Every question must have Hindi and English versions.
9. Every question must have exactly 4 options: A, B, C, D.
10. Include the correct answer.
11. Include a short explanation.
12. Do not invent facts.
13. Return ONLY valid JSON.

Return exactly:

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
`;

export default async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Only POST allowed"
    });
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: "GEMINI_API_KEY missing",
      details: "Vercel Environment Variables me GEMINI_API_KEY nahi mil rahi."
    });
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

        const buffer = Buffer.concat(chunks);

        files.push({
          buffer,
          mimeType: info.mimeType || "image/jpeg",
          filename: info.filename || "image.jpg"
        });

      });

    });

    busboy.on("error", error => {

      if (!res.headersSent) {
        res.status(400).json({
          error: "Upload parsing error",
          details: error.message
        });
      }

    });

    busboy.on("finish", async () => {

      try {

        if (!files.length) {
          return res.status(400).json({
            error: "No images uploaded"
          });
        }

        const selectedFiles = files.slice(0, 5);

        /*
         * Keep the request manageable.
         * The frontend can still select 5 images.
         */

        const totalBytes = selectedFiles.reduce(
          (total, file) => total + file.buffer.length,
          0
        );

        console.log(
          "Images:",
          selectedFiles.length,
          "Total bytes:",
          totalBytes
        );

        /*
         * Build Gemini inline image parts.
         * This keeps your existing setup simple and
         * does NOT require changing the API key.
         */

        const parts = [];

        for (const file of selectedFiles) {

          parts.push({
            inlineData: {
              mimeType: file.mimeType,
              data: file.buffer.toString("base64")
            }
          });

        }

        parts.push({
          text: PROMPT
        });

        const geminiResponse = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
          {
            method: "POST",

            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": apiKey
            },

            body: JSON.stringify({
              contents: [
                {
                  role: "user",
                  parts
                }
              ],

              generationConfig: {
                responseMimeType: "application/json",
                temperature: 0.2
              }
            })
          }
        );

        const raw = await geminiResponse.text();

        console.log(
          "Gemini status:",
          geminiResponse.status
        );

        if (!geminiResponse.ok) {

          console.error(
            "Gemini error:",
            raw
          );

          return res.status(geminiResponse.status).json({
            error: "Gemini API error",
            status: geminiResponse.status,
            details: raw
          });

        }

        let data;

        try {

          data = JSON.parse(raw);

        } catch {

          return res.status(500).json({
            error: "Gemini returned invalid response",
            details: raw
          });

        }

        const generatedText =
          data?.candidates?.[0]?.content?.parts
            ?.map(part => part.text || "")
            .join("")
            .trim();

        if (!generatedText) {

          return res.status(500).json({
            error: "Gemini returned no questions",
            details: JSON.stringify(data)
          });

        }

        let quiz;

        try {

          quiz = JSON.parse(generatedText);

        } catch {

          /*
           * Sometimes model may return JSON inside
           * markdown fences. Try cleaning it.
           */

          const cleaned =
            generatedText
              .replace(/^```json\s*/i, "")
              .replace(/^```\s*/i, "")
              .replace(/\s*```$/i, "")
              .trim();

          try {

            quiz = JSON.parse(cleaned);

          } catch {

            return res.status(500).json({
              error: "Gemini returned invalid JSON",
              details: generatedText.slice(0, 5000)
            });

          }

        }

        if (
          !quiz ||
          !Array.isArray(quiz.questions)
        ) {

          return res.status(500).json({
            error: "Invalid quiz format",
            details: JSON.stringify(quiz).slice(0, 5000)
          });

        }

        /*
         * Server-side cleanup
         */

        const letters = ["A", "B", "C", "D"];

        const seen = new Set();

        const questions = [];

        for (const item of quiz.questions) {

          const questionHindi =
            String(item.questionHindi || "").trim();

          const questionEnglish =
            String(item.questionEnglish || "").trim();

          if (!questionHindi || !questionEnglish) {
            continue;
          }

          const unique =
            (
              questionHindi +
              "|" +
              questionEnglish
            ).toLowerCase();

          if (seen.has(unique)) {
            continue;
          }

          const options = {};

          let validOptions = true;

          for (const letter of letters) {

            options[letter] =
              String(
                item?.options?.[letter] || ""
              ).trim();

            if (!options[letter]) {
              validOptions = false;
            }

          }

          if (!validOptions) {
            continue;
          }

          const answer =
            String(
              item.correctAnswer || ""
            )
            .trim()
            .toUpperCase();

          if (!letters.includes(answer)) {
            continue;
          }

          questions.push({

            questionHindi,

            questionEnglish,

            options,

            correctAnswer: answer,

            explanationHindi:
              String(
                item.explanationHindi || ""
              ).trim(),

            explanationEnglish:
              String(
                item.explanationEnglish || ""
              ).trim()

          });

          seen.add(unique);

          if (questions.length >= 50) {
            break;
          }

        }

        if (!questions.length) {

          return res.status(500).json({
            error: "No valid questions generated",
            details: "Gemini response me valid question format nahi mila."
          });

        }

        return res.status(200).json({
          questions
        });

      } catch (error) {

        console.error(
          "Handler error:",
          error
        );

        if (!res.headersSent) {

          return res.status(500).json({
            error: "API processing error",
            details:
              error?.message ||
              String(error)
          });

        }

      }

    });

    req.pipe(busboy);

  } catch (error) {

    return res.status(500).json({
      error: "Server error",
      details:
        error?.message ||
        String(error)
    });

  }

}
