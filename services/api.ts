// API Logic adapted from PDF
const API_URL_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';
const MODEL_FLASH = 'gemini-2.5-flash-preview-09-2025';
const MODEL_IMAGE = 'imagen-4.0-generate-001';
const MODEL_TTS = 'gemini-2.5-flash-preview-tts';

// Initialize API_KEY from env (if available) or localStorage
let API_KEY = process.env.API_KEY || localStorage.getItem('gemini_api_key') || "";

export const setApiKey = (key: string) => {
  API_KEY = key;
  localStorage.setItem('gemini_api_key', key);
};

export const hasApiKey = () => {
  return !!API_KEY;
};

async function fetchWithRetry(url: string, options: RequestInit, maxRetries = 5) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url, options);
      if (!response.ok) {
        const errorBody = await response.text();
        console.error(`API Error (Status ${response.status}):`, errorBody);
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return response;
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      const delay = Math.pow(2, i) * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw new Error('Max retries reached');
}

export async function generateLLMContent(prompt: string, tools: any[] = [], systemPrompt: string) {
  if (!API_KEY) return "กรุณาตั้งค่า API Key ก่อนใช้งาน";

  const url = `${API_URL_BASE}${MODEL_FLASH}:generateContent?key=${API_KEY}`;
  
  const payload: any = {
    contents: [{ parts: [{ text: prompt }] }],
    systemInstruction: { parts: [{ text: systemPrompt }] },
  };

  if (tools.length > 0) {
    payload.tools = tools;
  }

  try {
    const response = await fetchWithRetry(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    const result = await response.json();
    const text = result.candidates?.[0]?.content?.parts?.[0]?.text || 'ไม่สามารถสร้างเนื้อหาได้ (API response error).';
    return text;
  } catch (error: any) {
    console.error("LLM Generation Error:", error);
    return 'เกิดข้อผิดพลาดในการเชื่อมต่อกับ AI: ' + error.message;
  }
}

export async function generateImageContent(prompt: string) {
    if (!API_KEY) return { success: false, error: 'กรุณาตั้งค่า API Key ก่อนใช้งาน' };

    const url = `${API_URL_BASE}${MODEL_IMAGE}:predict?key=${API_KEY}`;
    const payload = {
        instances: [{ prompt: prompt }],
        parameters: { "sampleCount": 1 }
    };

    try {
        const response = await fetchWithRetry(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        
        if (result.predictions && result.predictions.length > 0 && result.predictions[0].bytesBase64Encoded) {
            return { success: true, base64: result.predictions[0].bytesBase64Encoded };
        } else {
            return { success: false, error: 'ไม่สามารถสร้างภาพได้ (โปรดลอง prompt อื่น)' };
        }
    } catch (error: any) {
        console.error("Image Generation Error:", error);
        return { success: false, error: error.message };
    }
}

// Audio Utils
function base64ToArrayBuffer(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

function pcmToWav(int16Array: Int16Array, sampleRate: number) {
  const numChannels = 1;
  const bytesPerSample = 2;
  const byteRate = sampleRate * numChannels * bytesPerSample;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = int16Array.byteLength;
  
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  
  // RIFF chunk
  view.setUint32(0, 0x52494646, false); // "RIFF"
  view.setUint32(4, 36 + dataSize, true); // Chunk size
  view.setUint32(8, 0x57415645, false); // "WAVE"
  
  // fmt chunk
  view.setUint32(12, 0x666d7420, false); // "fmt "
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true); // AudioFormat (1 for PCM)
  view.setUint16(22, numChannels, true); // NumChannels
  view.setUint32(24, sampleRate, true); // SampleRate
  view.setUint32(28, byteRate, true); // ByteRate
  view.setUint16(32, blockAlign, true); // BlockAlign
  view.setUint16(34, 16, true); // BitsPerSample (16-bit)
  
  // data chunk
  view.setUint32(36, 0x64617461, false); // "data"
  view.setUint32(40, dataSize, true); // Subchunk2Size
  
  const dataView = new Int16Array(buffer, 44);
  dataView.set(int16Array);
  
  return new Blob([buffer], { type: 'audio/wav' });
}

export async function geminiTTS(text: string, voice: string = 'Kore') {
  if (!API_KEY) return null;

  const url = `${API_URL_BASE}${MODEL_TTS}:generateContent?key=${API_KEY}`;
  
  const payload = {
    contents: [{ parts: [{ text: text }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: voice }
        }
      }
    }
  };

  try {
    const response = await fetchWithRetry(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    const result = await response.json();
    const part = result?.candidates?.[0]?.content?.parts?.[0];
    const audioData = part?.inlineData?.data;
    const mimeType = part?.inlineData?.mimeType;

    if (audioData && mimeType && mimeType.startsWith("audio/")) {
      const rateMatch = mimeType.match(/rate=(\d+)/);
      const sampleRate = rateMatch ? parseInt(rateMatch[1], 10) : 24000;
      const pcmData = base64ToArrayBuffer(audioData);
      const pcm16 = new Int16Array(pcmData);
      const wavBlob = pcmToWav(pcm16, sampleRate);
      return URL.createObjectURL(wavBlob);
    } else {
      throw new Error("TTS API response error or invalid data.");
    }
  } catch (error) {
    console.error("Error generating TTS:", error);
    return null;
  }
}