export interface VoiceOption {
  id: string;
  name: string;
  gender: 'Male' | 'Female';
  description: string;
  isCustom?: boolean;
}

export interface GeneratedAudio {
  id: string;
  url: string; // Blob URL
  text: string;
  timestamp: number;
  duration: number;
  emotion: string;
  bgLevel?: number;
}

export interface SpeakerMap {
  [key: string]: string; // speakerName -> voiceId
}

export enum AppMode {
  STUDIO = 'STUDIO',
  CLONING = 'CLONING'
}

export interface ChatMessage {
  role: 'user' | 'model' | 'system';
  text: string;
  timestamp: number;
  isVoice?: boolean;
}

export const PREBUILT_VOICES: VoiceOption[] = [
  { id: 'Puck', name: 'Puck', gender: 'Male', description: 'Deep, resonant, authoritative.' },
  { id: 'Charon', name: 'Charon', gender: 'Male', description: 'Gritty, narrative, noir.' },
  { id: 'Kore', name: 'Kore', gender: 'Female', description: 'Clear, soothing, professional.' },
  { id: 'Fenrir', name: 'Fenrir', gender: 'Male', description: 'Intense, energetic, loud.' },
  { id: 'Aoede', name: 'Aoede', gender: 'Female', description: 'Classic, dignified, elevated.' },
];