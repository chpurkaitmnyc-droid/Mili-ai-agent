# 🎙️ Mili — Autonomous Bengali AI Voice Agent

Mili is an autonomous, outbound, debt-collection and customer service voice assistant built for retail Kirana and building materials businesses, natively spoken in Bengali (n-IN).

## ⚡ Architecture & Pipeline
- **Speech-to-Text (STT):** Sarvam AI \saaras:v3\
- **Cognitive Brain & Reasoning:** DeepSeek V4.1 (\deepseek-ai/deepseek-v4.1-flash\ on NVIDIA NIM)
- **Text-to-Speech (TTS):** Sarvam AI \ulbul:v3\ (speaker: \oopa\)
- **Low-Latency Streaming:** Token streaming (\stream: true\) with real-time sentence boundary chunking (\।\, \?\, \!\, \.\)
- **State Management:** \SessionManager\ maintaining multi-turn context and customer history
- **Interruption / VAD:** Live AbortController signal handling & TTS queue cancellation
- **Post-Call Intent Extraction:** Silent LLM analyzer for structured database updates (\mock_customers.json\)

## 🛡️ Guardrails & Cognitive Rules
- **Multi-turn Memory:** Holds conversation context across turns without repeating initial greetings.
- **Benglish Comprehension:** Seamlessly understands mixed Bengali-English input while replying strictly in polite, spoken Bengali.
- **Dispute Escalation:** Automatically escalates discount requests and billing disputes to store owner (*"আমি বিষয়টি চয়ন স্যারকে জানিয়ে রাখছি..."*).
- **Busy Customer Flow:** Gracefully asks for callback reschedule times.

## 🚀 Key Files
- \i-brain-loop.js\: Core outbound autonomous loop, cron scanner, and STT-LLM-TTS pipeline
- \llm-streamer.js\: Streaming token buffer with sentence-level chunking & TTFB tracking
- \session-manager.js\: Session state, multi-turn memory & VAD interruption hook
- \mili-prompt.js\: Master System Prompt, Bengali number words converter, and PromptGenerator
- \	est-run.js\: Dry-run multi-turn simulation test runner without consuming audio credits
- \mock_customers.json\: Local database schema and call notes history