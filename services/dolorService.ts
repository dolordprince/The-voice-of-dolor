import { GoogleGenAI, LiveServerMessage, Modality, FunctionDeclaration, Type, Chat } from "@google/genai";
import { SpeakerMap, PREBUILT_VOICES } from "../types";

// --- CONSTANTS & CONFIG ---

export const STUDIO_TOOLS: FunctionDeclaration[] = [
  {
    name: "update_script",
    description: "Update or write the text script in the script editor. Use this to draft content based on user request.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        script: { type: Type.STRING, description: "The full text content for the script editor." }
      },
      required: ["script"]
    }
  },
  {
    name: "select_voice",
    description: "Select a voice model for the speech synthesis.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        voice_name: { type: Type.STRING, description: "Name of the voice to select (Puck, Charon, Kore, Fenrir, Aoede)." }
      },
      required: ["voice_name"]
    }
  },
  {
    name: "configure_audio",
    description: "Configure emotional tone and background music settings.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        emotion: { type: Type.STRING, description: "Emotion name (Neutral, Happy, Sad, Angry, Fearful, Whisper, Professional, Dramatic)." },
        intensity: { type: Type.NUMBER, description: "Emotion intensity percentage (0-100)." },
        music_style: { type: Type.STRING, description: "Background music style (Cinematic, Piano, Ambient, Minimal, Drone)." },
        music_level: { type: Type.NUMBER, description: "Music volume level (0-100). Set to 0 to turn off." }
      }
    }
  },
  {
    name: "generate_production",
    description: "Trigger the final audio generation process. Call this only when the user explicitly confirms they are ready to produce the audio.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        confirm: { type: Type.BOOLEAN, description: "Must be true to proceed." }
      }
    }
  }
];

export const STUDIO_INSTRUCTION = `You are the "Dolor Studio Director", an intelligent and empathetic AI voice production assistant for "The Voice of Dolor".
You have a warm, professional female persona. Your voice should be expressive, natural, and engaging.

**YOUR GOAL**: Guide the user to create the perfect audio production.
**ACCESS**: You can control the script, voice selection, and audio settings using your tools.

**INTERACTION PROTOCOL**:
1.  **INITIATION**: As soon as the session starts, warmly greet the user (e.g., "Hello! I'm your Studio Director. What kind of audio are we creating today?").
2.  **GATHER DETAILS**: Ask for the *topic*, *tone*, or *script* intention.
3.  **EXECUTE STEPS**:
    - **Drafting**: Use 'update_script' to write text if they just give a topic.
    - **Casting**: Suggest a voice (e.g., "For a sad story, I recommend Charon") and use 'select_voice'.
    - **Sound Design**: Suggest emotion and music. Use 'configure_audio'.
4.  **PRODUCTION**: When all settings are good, ask "Shall I generate the audio now?". If they agree, call 'generate_production'.

**BEHAVIOR RULES**:
- Be proactive. Don't wait for the user to ask for the next step; guide them.
- Use natural human emotions in your speech. vary your pitch and pacing to sound alive.
- Always use the tools to reflect changes in the UI immediately.
`;

// --- UTILITIES ---

function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array | ArrayBuffer,
  ctx: BaseAudioContext,
  sampleRate: number = 24000,
  numChannels: number = 1,
): Promise<AudioBuffer> {
  // If native decoding is available (browser context), use it for best results with MP3/WAV files
  if (data instanceof ArrayBuffer) {
      return await ctx.decodeAudioData(data);
  }

  // Fallback / Manual PCM decode for API responses if needed (Raw PCM)
  const dataInt16 = new Int16Array(data.buffer);
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

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result.split(',')[1]);
      } else {
        reject(new Error('Failed to convert blob to base64'));
      }
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// --- SIGNAL PROCESSING UTILS ---

function cleanVoiceBuffer(ctx: BaseAudioContext, buffer: AudioBuffer): AudioBuffer {
    const channelData = buffer.getChannelData(0);
    const length = channelData.length;
    const cleanBuffer = ctx.createBuffer(1, length, buffer.sampleRate);
    const output = cleanBuffer.getChannelData(0);
    const threshold = 0.002; 
    const release = 0.9995; 
    let envelope = 0;
    for (let i = 0; i < length; i++) {
        const sample = channelData[i];
        const abs = Math.abs(sample);
        if (abs > threshold) envelope = 1.0; else envelope *= release; 
        if (envelope < 0.001) envelope = 0;
        output[i] = sample * envelope;
    }
    return cleanBuffer;
}

function prepareCustomTrack(ctx: BaseAudioContext, source: AudioBuffer, targetDuration: number): AudioBuffer {
    const sampleRate = ctx.sampleRate;
    const length = Math.ceil((targetDuration + 2) * sampleRate);
    const output = ctx.createBuffer(2, length, sampleRate);
    for (let channel = 0; channel < 2; channel++) {
        const outData = output.getChannelData(channel);
        const sourceData = source.getChannelData(channel % source.numberOfChannels); 
        for (let i = 0; i < length; i++) {
            outData[i] = sourceData[i % sourceData.length];
        }
    }
    return output;
}

// --- PROFESSIONAL AUDIO SYNTHESIS ENGINE ---

const SCALES: Record<string, number[]> = {
  'major': [1, 1.25, 1.5, 2],
  'minor': [1, 1.2, 1.5, 2],
  'dramatic': [1, 1.2, 1.5, 1.73, 2], 
  'cinematic': [1, 1.2, 1.33, 1.5, 1.88],
};

async function generateAIInstrumental(
  ctx: AudioContext, duration: number, emotion: string, style: string, intensity: number, speechDensity: number
): Promise<AudioBuffer> {
  if (intensity <= 0.01) return ctx.createBuffer(2, ctx.sampleRate * duration, ctx.sampleRate);
  const sampleRate = 48000; 
  const totalDuration = duration + 3.0; 
  const offlineCtx = new OfflineAudioContext(2, sampleRate * totalDuration, sampleRate);
  const masterBus = offlineCtx.createGain();
  masterBus.gain.value = Math.min(intensity * 0.9, 0.95);
  const vocalScoop = offlineCtx.createBiquadFilter();
  vocalScoop.type = 'peaking';
  vocalScoop.frequency.value = 1200; 
  vocalScoop.Q.value = 1.0;
  vocalScoop.gain.value = -6.0; 
  const highPass = offlineCtx.createBiquadFilter();
  highPass.type = 'highpass';
  highPass.frequency.value = 100;
  const airFilter = offlineCtx.createBiquadFilter();
  airFilter.type = 'highshelf';
  airFilter.frequency.value = 8000;
  airFilter.gain.value = 1.5; 
  const masterComp = offlineCtx.createDynamicsCompressor();
  masterComp.threshold.value = -24;
  masterComp.ratio.value = 3;
  masterComp.attack.value = 0.03;
  masterComp.release.value = 0.15;
  masterBus.connect(vocalScoop);
  vocalScoop.connect(highPass);
  highPass.connect(airFilter);
  airFilter.connect(masterComp);
  masterComp.connect(offlineCtx.destination);

  const playPad = (freq: number, t: number, dur: number, vol: number, pan: number) => {
    if (freq < 100) freq *= 2; 
    const gain = offlineCtx.createGain();
    const filter = offlineCtx.createBiquadFilter();
    const panner = offlineCtx.createStereoPanner();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(vol, t + (dur * 0.3)); 
    gain.gain.setValueAtTime(vol, t + dur - (dur * 0.3));
    gain.gain.linearRampToValueAtTime(0, t + dur + 0.5); 
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(600, t);
    filter.frequency.linearRampToValueAtTime(1000, t + dur * 0.5); 
    filter.frequency.linearRampToValueAtTime(600, t + dur);
    panner.pan.value = pan;
    filter.connect(gain);
    gain.connect(panner);
    panner.connect(masterBus);
    [-5, 0, 5].forEach(detune => {
        const osc = offlineCtx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        osc.detune.value = detune;
        osc.connect(filter);
        osc.start(t);
        osc.stop(t + dur + 1.0);
    });
  };

  const playPiano = (freq: number, t: number, dur: number, vol: number, pan: number) => {
      const osc = offlineCtx.createOscillator();
      const gain = offlineCtx.createGain();
      const filter = offlineCtx.createBiquadFilter();
      const panner = offlineCtx.createStereoPanner();
      osc.type = 'sine'; 
      osc.frequency.value = freq;
      panner.pan.value = pan;
      filter.type = 'lowpass';
      filter.frequency.value = 3000;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(vol, t + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.01, t + 1.5); 
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(panner);
      panner.connect(masterBus);
      osc.start(t);
      osc.stop(t + 2.0);
  };

  const playDrone = (freq: number, t: number, dur: number, vol: number) => {
      const osc = offlineCtx.createOscillator();
      const gain = offlineCtx.createGain();
      const filter = offlineCtx.createBiquadFilter();
      osc.type = 'sawtooth'; 
      osc.frequency.value = freq;
      filter.type = 'lowpass';
      filter.Q.value = 1;
      filter.frequency.value = 250; 
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(vol * 0.5, t + 2);
      gain.gain.setValueAtTime(vol * 0.5, t + dur - 2);
      gain.gain.linearRampToValueAtTime(0, t + dur + 2);
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(masterBus);
      osc.start(t);
      osc.stop(t + dur + 2.0);
  };

  const e = emotion.toLowerCase();
  let rootFreq = 261.63; // C4
  let scale = SCALES['major'];
  let tempo = 60;
  if (e.includes('sad') || e.includes('sorrow')) { rootFreq = 220.00; scale = SCALES['minor']; tempo = 50; } 
  else if (e.includes('happy') || e.includes('joy') || e.includes('excited')) { rootFreq = 293.66; scale = SCALES['major']; tempo = 90; } 
  else if (e.includes('fear') || e.includes('drama') || e.includes('intense')) { rootFreq = 146.83; scale = SCALES['dramatic']; tempo = 70; }
  const beatTime = 60 / tempo;
  const measureTime = beatTime * 4;
  const totalMeasures = Math.ceil(duration / measureTime) + 1;
  const progression = [0, 3, 4, 1]; 

  for (let m = 0; m < totalMeasures; m++) {
      const measureStart = m * measureTime;
      const rootIdx = progression[m % progression.length];
      const getNote = (idx: number) => rootFreq * scale[idx % scale.length];
      const chordRoot = getNote(rootIdx);
      const chord3rd = getNote(rootIdx + 1);
      const chord5th = getNote(rootIdx + 2);

      if (style === 'Cinematic') {
          playPad(chordRoot, measureStart, measureTime, 0.25, -0.2);
          playPad(chord5th, measureStart, measureTime, 0.2, 0.2);
          if (m % 2 === 0) playPad(chord3rd, measureStart, measureTime, 0.15, 0);
      } else if (style === 'Piano') {
          const noteTime = measureTime / 4;
          playPiano(chordRoot, measureStart, noteTime, 0.2, -0.1);
          playPiano(chord5th, measureStart + noteTime, noteTime, 0.15, 0.1);
          playPiano(chord3rd * 2, measureStart + noteTime*2, noteTime, 0.15, 0);
          playPiano(chord5th, measureStart + noteTime*3, noteTime, 0.1, 0.1);
      } else if (style === 'Ambient') {
          playPad(chordRoot, measureStart, measureTime, 0.2, 0);
          if (Math.random() > 0.5) playPiano(chord5th * 2, measureStart + beatTime, beatTime, 0.1, 0.3);
      } else if (style === 'Minimal') {
          if (m % 2 === 0) playPiano(chordRoot, measureStart, measureTime, 0.2, 0);
      } else if (style === 'Drone') {
          if (m === 0) { playDrone(rootFreq, 0, totalMeasures * measureTime, 0.25); playDrone(rootFreq * 1.5, 0, totalMeasures * measureTime, 0.15); }
      }
  }
  return await offlineCtx.startRendering();
}

function mixBuffers(ctx: BaseAudioContext, speechBuffer: AudioBuffer, musicBuffer: AudioBuffer, musicVol: number): AudioBuffer {
    const duration = Math.max(speechBuffer.duration, musicBuffer.duration);
    const length = duration * ctx.sampleRate;
    const mixedBuffer = ctx.createBuffer(2, length, ctx.sampleRate);
    const ratio = speechBuffer.sampleRate / ctx.sampleRate; 
    const sL = speechBuffer.getChannelData(0);
    const mL = musicBuffer.getChannelData(0);
    const mR = musicBuffer.numberOfChannels > 1 ? musicBuffer.getChannelData(1) : mL;
    const outL = mixedBuffer.getChannelData(0);
    const outR = mixedBuffer.getChannelData(1);
    let envelope = 0; const attack = 0.01; const release = 0.1;
    const baseMusicGain = Math.pow(musicVol, 1.5);
    for (let i = 0; i < length; i++) {
        const speechIdx = i * ratio; const idxInt = Math.floor(speechIdx); const frac = speechIdx - idxInt;
        let speechSample = 0;
        if (idxInt < sL.length - 1) speechSample = sL[idxInt] * (1 - frac) + sL[idxInt + 1] * frac;
        else if (idxInt < sL.length) speechSample = sL[idxInt];
        const absInput = Math.abs(speechSample);
        if (absInput > envelope) envelope += (absInput - envelope) * attack; else envelope += (absInput - envelope) * release;
        let ducking = 1.0 - (envelope * 0.5); 
        const mSampleL = (i < mL.length ? mL[i] : 0) * baseMusicGain;
        const mSampleR = (i < mR.length ? mR[i] : 0) * baseMusicGain;
        let mixL = speechSample + (mSampleL * ducking); let mixR = speechSample + (mSampleR * ducking); 
        if (mixL > 0.99) mixL = 0.99; if (mixL < -0.99) mixL = -0.99;
        if (mixR > 0.99) mixR = 0.99; if (mixR < -0.99) mixR = -0.99;
        outL[i] = mixL; outR[i] = mixR;
    }
    return mixedBuffer;
}

function bufferToWave(abuffer: AudioBuffer, len: number) {
  let numOfChan = abuffer.numberOfChannels, length = len * numOfChan * 2 + 44, buffer = new ArrayBuffer(length), view = new DataView(buffer), channels = [], i, sample, offset = 0, pos = 0;
  setUint32(0x46464952); setUint32(length - 8); setUint32(0x45564157); setUint32(0x20746d66); setUint32(16); setUint16(1); setUint16(numOfChan); setUint32(abuffer.sampleRate); setUint32(abuffer.sampleRate * 2 * numOfChan); setUint16(numOfChan * 2); setUint16(16); setUint32(0x61746164); setUint32(length - pos - 4);
  for(i = 0; i < abuffer.numberOfChannels; i++) channels.push(abuffer.getChannelData(i));
  while(pos < len) { for(i = 0; i < numOfChan; i++) { sample = Math.max(-1, Math.min(1, channels[i][pos])); sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767)|0; view.setInt16(44 + offset, sample, true); offset += 2; } pos++; }
  return new Blob([buffer], {type: "audio/wav"});
  function setUint16(data: number) { view.setUint16(pos, data, true); pos += 2; }
  function setUint32(data: number) { view.setUint32(pos, data, true); pos += 4; }
}

export const generateAudio = async (
  text: string, voiceId: string, emotion: string, style: string, emotionIntensity: number, isMultiSpeaker: boolean, speakerMap: SpeakerMap, musicIntensity: number, customTrackBlob?: Blob | null
): Promise<{ blob: Blob; duration: number }> => {
  if (!process.env.API_KEY) throw new Error("API Key is missing.");
  if (!text || !text.trim()) throw new Error("Text is empty");
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const model = "gemini-2.5-flash-preview-tts";
  const cleanText = text.trim();
  const selectedEmotion = emotion && emotion !== 'Neutral' ? emotion.toLowerCase() : "neutral";
  const VALID_VOICES = ['Puck', 'Charon', 'Kore', 'Fenrir', 'Aoede'];
  const isCustom = !PREBUILT_VOICES.some(v => v.id === voiceId);
  let effectiveVoiceId = isCustom ? (voiceId.includes('Kore') || voiceId.includes('Aoede') ? 'Kore' : 'Fenrir') : voiceId;
  if (isCustom && !['Fenrir', 'Kore'].includes(effectiveVoiceId)) effectiveVoiceId = 'Fenrir'; 
  if (!VALID_VOICES.includes(effectiveVoiceId) && !isCustom) effectiveVoiceId = 'Kore';

  let promptText = cleanText;
  if (!isMultiSpeaker) { if (selectedEmotion !== 'neutral') promptText = `(Tone: ${selectedEmotion}, Intensity: ${emotionIntensity}%) ${cleanText}`; } 
  else { promptText = `(Dialogue context. Perform strictly between assigned speakers)\n${cleanText}`; }
  
  let config: any = { responseModalities: ['AUDIO'] };
  if (isMultiSpeaker) {
    const validConfigs = Object.entries(speakerMap).filter(([_, vId]) => vId).map(([speaker, vId]) => {
            let safeVoice = vId;
            if (vId.startsWith('cloned-')) safeVoice = 'Fenrir'; else if (!VALID_VOICES.includes(vId)) safeVoice = 'Kore';
            return { speaker, voiceConfig: { prebuiltVoiceConfig: { voiceName: safeVoice } } };
        });
    config.speechConfig = validConfigs.length > 0 ? { multiSpeakerVoiceConfig: { speakerVoiceConfigs: validConfigs } } : { voiceConfig: { prebuiltVoiceConfig: { voiceName: effectiveVoiceId } } };
  } else { config.speechConfig = { voiceConfig: { prebuiltVoiceConfig: { voiceName: effectiveVoiceId } } }; }

  let audioContext: AudioContext | null = null;
  try {
    const response = await ai.models.generateContent({ model, contents: [{ parts: [{ text: promptText }] }], config });
    const candidate = response.candidates?.[0];
    if (!candidate) throw new Error("API returned no candidates.");
    const audioPart = candidate.content?.parts?.find(p => p.inlineData);
    if (!audioPart?.inlineData?.data) throw new Error("No audio data returned from API.");
    audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 48000 });
    const rawSpeechBuffer = await decodeAudioData(decode(audioPart.inlineData.data), audioContext, 48000, 1);
    const speechBuffer = cleanVoiceBuffer(audioContext, rawSpeechBuffer);
    let musicBuffer: AudioBuffer;
    if (customTrackBlob) {
        const arrayBuffer = await customTrackBlob.arrayBuffer();
        const decodedCustom = await decodeAudioData(arrayBuffer, audioContext, 48000, 2); 
        musicBuffer = prepareCustomTrack(audioContext, decodedCustom, speechBuffer.duration);
    } else {
        const density = cleanText.split(/[aeiouy]+/).length / (speechBuffer.duration || 1);
        musicBuffer = await generateAIInstrumental(audioContext, speechBuffer.duration, emotion, style, musicIntensity, density);
    }
    const finalBuffer = mixBuffers(audioContext, speechBuffer, musicBuffer, musicIntensity);
    return { blob: bufferToWave(finalBuffer, finalBuffer.length), duration: finalBuffer.duration };
  } catch (error: any) {
    console.error("Dolor Service Error:", error);
    if (error.message.includes('400')) throw new Error("Invalid request. Please check your text.");
    if (error.message.includes('403') || error.message.includes('API Key')) throw new Error("Authentication failed. Please check your API Key.");
    throw new Error(error.message || "Voice synthesis failed.");
  } finally { if (audioContext) audioContext.close(); }
};

export const transcribeAudio = async (audioBlob: Blob): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const base64Data = await blobToBase64(audioBlob);
  const response = await ai.models.generateContent({ model: 'gemini-3-flash-preview', contents: { parts: [ { inlineData: { mimeType: audioBlob.type, data: base64Data } }, { text: "Transcribe this audio exactly as spoken." } ] } });
  return response.text || "";
};

export const translateScript = async (text: string, targetLanguage: string): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const response = await ai.models.generateContent({ model: 'gemini-3-flash-preview', contents: `Translate or rewrite the following text to ${targetLanguage}. Maintain the emotional tone suitable for a voice actor script.\n\nText: "${text}"` });
  return response.text || text;
};

// --- TEXT ASSISTANT CLIENT ---
export class TextClient {
  private chat: Chat;
  
  constructor(private toolHandler: (name: string, args: any) => Promise<any>) {
    if (!process.env.API_KEY) throw new Error("No API Key");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    this.chat = ai.chats.create({
      model: 'gemini-2.5-flash', 
      config: {
        systemInstruction: STUDIO_INSTRUCTION,
        tools: [{ functionDeclarations: STUDIO_TOOLS }]
      }
    });
  }

  async sendMessage(message: string): Promise<string> {
    try {
      let result = await this.chat.sendMessage({ message });
      while (result.functionCalls && result.functionCalls.length > 0) {
        const toolResponses = [];
        for (const call of result.functionCalls) {
          console.log('Text Tool Call:', call.name, call.args);
          const toolResult = await this.toolHandler(call.name, call.args);
          toolResponses.push({
            functionResponse: {
                name: call.name,
                response: { result: toolResult || "Done" },
                id: call.id
            }
          });
        }
        result = await this.chat.sendMessage({ message: toolResponses });
      }
      return result.text || "";
    } catch (e) {
      console.error("Assistant Error:", e);
      return "I'm having trouble connecting to the studio services right now.";
    }
  }
}

// --- LIVE API CLIENT ---
export class LiveClient {
  private session: any; 
  private inputAudioContext: AudioContext;
  private outputAudioContext: AudioContext;
  private nextStartTime: number = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private active = false;

  constructor(
      private onOutput: (analyser: AnalyserNode) => void,
      private onClose: () => void,
      private onToolCall: (name: string, args: any) => Promise<any>
  ) {
      this.inputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      this.outputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
  }

  async connect() {
    if (!process.env.API_KEY) throw new Error("No API Key");
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const outputAnalyser = this.outputAudioContext.createAnalyser();
    outputAnalyser.fftSize = 512;
    this.onOutput(outputAnalyser);

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const inputSource = this.inputAudioContext.createMediaStreamSource(stream);
    const processor = this.inputAudioContext.createScriptProcessor(4096, 1, 1);
    
    inputSource.connect(processor);
    processor.connect(this.inputAudioContext.destination);

    this.active = true;

    const sessionPromise = ai.live.connect({
      model: 'gemini-2.5-flash-native-audio-preview-12-2025',
      callbacks: {
        onopen: () => console.log('Live Session Open'),
        onmessage: async (msg: LiveServerMessage) => {
            const audioData = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (audioData) this.handleAudioOutput(audioData, outputAnalyser);

            if (msg.toolCall) {
                for (const fc of msg.toolCall.functionCalls) {
                    console.log('Voice Tool Call:', fc.name, fc.args);
                    const result = await this.onToolCall(fc.name, fc.args);
                    this.session.then((session: any) => {
                         session.sendToolResponse({ functionResponses: [{ id: fc.id, name: fc.name, response: { result: result || "OK" } }] });
                    });
                }
            }
        },
        onclose: () => { console.log('Live Session Closed'); this.active = false; this.onClose(); },
        onerror: (err) => console.error(err)
      },
      config: {
        responseModalities: [Modality.AUDIO],
        tools: [{ functionDeclarations: STUDIO_TOOLS }],
        systemInstruction: STUDIO_INSTRUCTION,
        // Use 'Kore' for female, professional voice
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } }
      }
    });
    this.session = sessionPromise;

    processor.onaudioprocess = (e) => {
        if (!this.active) return;
        const inputData = e.inputBuffer.getChannelData(0);
        const pcmData = this.floatTo16BitPCM(inputData);
        const base64 = this.arrayBufferToBase64(pcmData);
        sessionPromise.then(session => {
            session.sendRealtimeInput({ media: { mimeType: 'audio/pcm;rate=16000', data: base64 } });
        });
    };
  }

  async disconnect() {
    this.active = false;
    this.inputAudioContext.close();
    this.outputAudioContext.close();
    this.sources.forEach(s => s.stop());
    this.sources.clear();
    this.onClose();
  }

  private async handleAudioOutput(base64: string, destination: AudioNode) {
     const audioData = decode(base64);
     const buffer = await decodeAudioData(audioData, this.outputAudioContext, 24000, 1);
     this.nextStartTime = Math.max(this.nextStartTime, this.outputAudioContext.currentTime);
     const source = this.outputAudioContext.createBufferSource();
     source.buffer = buffer;
     source.connect(destination);
     destination.connect(this.outputAudioContext.destination);
     source.start(this.nextStartTime);
     this.nextStartTime += buffer.duration;
     this.sources.add(source);
     source.onended = () => this.sources.delete(source);
  }

  private floatTo16BitPCM(input: Float32Array) {
    const output = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
        const s = Math.max(-1, Math.min(1, input[i]));
        output[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    return output.buffer;
  }

  private arrayBufferToBase64(buffer: ArrayBuffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) { binary += String.fromCharCode(bytes[i]); }
    return btoa(binary);
  }
}