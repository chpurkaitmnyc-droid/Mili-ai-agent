require("dotenv").config();
const OpenAI = require("openai");

const client = new OpenAI({
  baseURL: "https://integrate.api.nvidia.com/v1",
  apiKey: process.env.NVIDIA_API_KEY,
  timeout: 30000,
});

async function run() {
  console.log("Testing DeepSeek streaming on NVIDIA NIM...");
  console.time("LLM-TTFB");
  try {
    const stream = await client.chat.completions.create({
      model: "deepseek-ai/deepseek-v4.1-flash",
      messages: [
        {
          role: "system",
          content: "You are Mili, a Bengali collection agent. Respond in 2 short Bengali sentences.",
        },
        {
          role: "user",
          content: "হ্যাঁ টাকাটা দিতে আমার কয়েক মাস সময় লাগবে আমাকে সেই সময় দেওয়া যাবে কি?",
        },
      ],
      temperature: 0.6,
      max_tokens: 150,
      stream: true,
    });

    let firstToken = true;
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || "";
      if (content) {
        if (firstToken) {
          console.timeEnd("LLM-TTFB");
          firstToken = false;
        }
        process.stdout.write(content);
      }
    }
    console.log("\nStream finished.");
  } catch (err) {
    console.error("Stream error:", err.message);
  }
}

run();
