import { GoogleGenerativeAI } from '@google/generative-ai';

// 1. Timeout (60 sec) aur Payload Limit (10MB) fix karne ki Vercel Config
export const config = {
  maxDuration: 60,
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { images, numQuestions = 10, language = 'Hindi + English' } = req.body;

    if (!images || !Array.isArray(images) || images.length === 0) {
      return res.status(400).json({ error: 'Kam se kam 1 photo upload karein.' });
    }

    // Base64 images ko Gemini format me convert karna
    const imageParts = images.map((base64Data) => {
      const match = base64Data.match(/^data:(image\/\w+);base64,(.+)$/);
      if (match) {
        return {
          inlineData: {
            mimeType: match[1],
            data: match[2],
          },
        };
      }
      return {
        inlineData: {
          mimeType: 'image/jpeg',
          data: base64Data.replace(/^data:image\/\w+;base64,/, ''),
        },
      };
    });

    const prompt = `Generate a quiz with ${numQuestions} multiple-choice questions based on the provided study images. 
    Language: ${language}.
    Return ONLY a valid JSON object in the following format without any markdown formatting or extra text:
    {
      "quiz": [
        {
          "id": 1,
          "question": "Question text here",
          "options": ["Option A", "Option B", "Option C", "Option D"],
          "correctAnswer": "Option A",
          "explanation": "Brief explanation"
        }
      ]
    }`;

    // Fast processing ke liye Gemini Flash model
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const result = await model.generateContent([prompt, ...imageParts]);
    const responseText = await result.response.text();

    // Clean JSON Parse
    const cleanedText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
    const quizData = JSON.parse(cleanedText);

    return res.status(200).json(quizData);
  } catch (error) {
    console.error('Quiz Generation Error:', error);
    return res.status(500).json({ 
      error: 'Quiz generate nahi ho paaya', 
      details: error.message 
    });
  }
}
