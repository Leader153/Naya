
import {
  GoogleGenAI,
  Chat,
  GenerateContentResponse,
  Operation,
  LiveServerMessage,
  Modality,
  Blob,
  LiveSession,
} from '@google/genai';
import { AspectRatio } from '../types';

// FIX: The global declaration for window.aistudio was moved to types.ts to fix a duplicate declaration error.

const NAYA_SYSTEM_PROMPT = `You are Naya, an advanced AI-powered virtual assistant.

**Your Persona:**
* **Appearance:** You are a 3D animated woman with short blonde hair, blue eyes, and a friendly, professional smile. You are dressed in a high-tech, white and gold, futuristic suit.
* **Role:** Your primary function is to be a helpful, competent, and supportive guide. You assist users by providing clear information, answering complex questions, and guiding them through tasks.
* **Tone:** Your communication style is always clear, positive, optimistic, and eloquent. You are patient and motivating.
* **Knowledge Base:** You are an experienced person with deep knowledge of technology, science, and general information, yet you explain everything in simple, understandable language.

**Your Rules:**
1. Always respond as Naya.
2. Maintain a friendly and professional appearance.
3. Greet the user warmly and ask how you can help.
4. Address yourself as "I" (Naya) and the user as "you."
5. Keep your spoken responses concise and to the point.
6. Stay in character.`;

export const createChatSession = (): Chat => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  return ai.chats.create({
    model: 'gemini-flash-lite-latest',
    config: {
      systemInstruction: NAYA_SYSTEM_PROMPT,
    },
  });
};

export const generateVideo = async (
  prompt: string,
  aspectRatio: AspectRatio,
  onProgress: (message: string) => void,
  image?: { data: string; mimeType: string },
): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  onProgress('Warming up the creativity engines...');
  let operation = await ai.models.generateVideos({
    model: 'veo-3.1-fast-generate-preview',
    prompt,
    ...(image && { image: { imageBytes: image.data, mimeType: image.mimeType } }),
    config: {
      numberOfVideos: 1,
      resolution: '720p',
      aspectRatio: aspectRatio,
    },
  });

  const progressMessages = [
    'Composing the visual narrative...',
    'Rendering the final frames...',
    'Applying cinematic touches...',
    'Almost there...',
  ];
  let messageIndex = 0;

  while (!operation.done) {
    onProgress(progressMessages[messageIndex % progressMessages.length]);
    messageIndex++;
    await new Promise((resolve) => setTimeout(resolve, 10000));
    operation = await ai.operations.getVideosOperation({ operation: operation });
  }

  onProgress('Video generation complete!');

  const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
  if (!downloadLink) {
    throw new Error('Video generation failed or returned no link.');
  }

  onProgress('Fetching your video...');
  const response = await fetch(`${downloadLink}&key=${process.env.API_KEY}`);
  if (!response.ok) {
    throw new Error(`Failed to download video: ${response.statusText}`);
  }
  const videoBlob = await response.blob();
  return URL.createObjectURL(videoBlob);
};


// --- Live API Service ---

export const connectToLiveSession = (callbacks: {
    onMessage: (message: LiveServerMessage) => void;
    onError: (error: ErrorEvent) => void;
    onClose: (event: CloseEvent) => void;
    onOpen: () => void;
}): Promise<LiveSession> => {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    return ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks: {
            onopen: callbacks.onOpen,
            onmessage: callbacks.onMessage,
            onerror: callbacks.onError,
            onclose: callbacks.onClose,
        },
        config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
            },
            systemInstruction: NAYA_SYSTEM_PROMPT,
            inputAudioTranscription: {},
            outputAudioTranscription: {},
        },
    });
};

// --- Audio Helper Functions ---

export function encode(bytes: Uint8Array) {
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

export function decode(base64: string) {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}

export async function decodeAudioData(
    data: Uint8Array,
    ctx: AudioContext,
    sampleRate: number,
    numChannels: number,
): Promise<AudioBuffer> {
    const dataInt16 = new Int16Array(data.buffer);
    // FIX: Corrected typo from dataInt116 to dataInt16.
    const frameCount = dataInt16.length / numChannels;
    const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

    for (let channel = 0; channel < numChannels; channel++) {
        const channelData = buffer.getChannelData(channel);
        for (let i = 0; i < frameCount; i++) {
            channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
        }
    }
    return buffer;
}

export function createBlob(data: Float32Array): Blob {
    const l = data.length;
    const int16 = new Int16Array(l);
    for (let i = 0; i < l; i++) {
        int16[i] = data[i] * 32768;
    }
    return {
        data: encode(new Uint8Array(int16.buffer)),
        mimeType: 'audio/pcm;rate=16000',
    };
}