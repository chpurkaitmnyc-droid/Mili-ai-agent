require("dotenv").config();
const OpenAI = require("openai");

const client = new OpenAI({
  baseURL: "https://integrate.api.nvidia.com/v1",
  apiKey: process.env.NVIDIA_API_KEY,
});

async function main() {
  console.log("Calling DeepSeek stream...");
  console.time("TTFB");
  const stream = await client.chat.completions.create({
    model: "deepseek-ai/deepseek-v4.1-flash",
    messages: [
      { role: "user", content: "নমস্কার, কেমন আছেন? এক লাইনে উত্তর দিন।" }
    ],
    temperature: 0.5,
    max_tokens: 50,
    stream: true,
  });

  let firstToken = true;
  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content || "";
    if (text) {
      if (firstToken) {
        console.timeEnd("TTFB");
        firstToken = false;
      }
      process.stdout.write(text);
    }
  }
  console.log("\nDone!");
}

main().catch(console.error);
