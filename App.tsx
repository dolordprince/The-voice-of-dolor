import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Mic, Play, Square, Download, FileAudio, 
  Layers, Settings, Volume2, Wand2, Users, 
  AlignLeft, Type, Clock, Command, AudioWaveform,
  UploadCloud, CheckCircle2, Loader2, X, Pause, Music, AlertCircle,
  Sliders, FileMusic, Trash2, Clipboard, Eraser, Radio, Globe, Save, Signal, Zap, Send, MessageSquare, Bot
} from 'lucide-react';
import { generateAudio, transcribeAudio, translateScript, LiveClient, TextClient } from './services/dolorService';
import { PREBUILT_VOICES, VoiceOption, GeneratedAudio, SpeakerMap, AppMode, ChatMessage } from './types';
import AudioVisualizer from './components/AudioVisualizer';
import ConsentModal from './components/ConsentModal';

export default function App() {
  // --- STATE ---
  const [text, setText] = useState('');
  const [availableVoices, setAvailableVoices] = useState<VoiceOption[]>(PREBUILT_VOICES);
  const [selectedVoice, setSelectedVoice] = useState<VoiceOption>(PREBUILT_VOICES[2]); // Default Kore
  const [emotion, setEmotion] = useState('Neutral');
  const [emotionIntensity, setEmotionIntensity] = useState(80); // Default 80%
  const [bgLevel, setBgLevel] = useState(30); // 0-100
  const [bgSource, setBgSource] = useState<'GENERATIVE' | 'UPLOAD'>('GENERATIVE');
  const [customBgFile, setCustomBgFile] = useState<File | null>(null);
  const [musicStyle, setMusicStyle] = useState('Cinematic');
  const [isMultiSpeaker, setIsMultiSpeaker] = useState(false);
  const [speakerMap, setSpeakerMap] = useState<SpeakerMap>({});
  const [detectedSpeakers, setDetectedSpeakers] = useState<string[]>([]);
  const [generatedList, setGeneratedList] = useState<GeneratedAudio[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationPhase, setGenerationPhase] = useState<string>(''); 
  const [currentAudio, setCurrentAudio] = useState<GeneratedAudio | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [showConsent, setShowConsent] = useState(false);
  const [mode, setMode] = useState<AppMode>(AppMode.STUDIO);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  
  // Transcription & Translation
  const [isRecording, setIsRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [showTranslate, setShowTranslate] = useState(false);
  
  // Assistant & Live Mode
  const [rightPanelTab, setRightPanelTab] = useState<'ASSISTANT' | 'HISTORY'>('ASSISTANT');
  const [isLiveConnected, setIsLiveConnected] = useState(false);
  const [liveAnalyser, setLiveAnalyser] = useState<AnalyserNode | null>(null);
  const [autoGenTrigger, setAutoGenTrigger] = useState(false); 
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([{
      role: 'system', text: 'Hello! I am your Studio Director. I can help you write scripts, choose voices, and produce audio. What are we creating today?', timestamp: Date.now()
  }]);
  const [chatInput, setChatInput] = useState('');
  const [isChatProcessing, setIsChatProcessing] = useState(false);
  
  const liveClientRef = useRef<LiveClient | null>(null);
  const textClientRef = useRef<TextClient | null>(null);

  // Cloning State
  const [cloneFile, setCloneFile] = useState<File | null>(null);
  const [cloneName, setCloneName] = useState('');
  const [cloneGender, setCloneGender] = useState<'Male'|'Female'>('Male');
  const [isCloning, setIsCloning] = useState(false);
  const [cloneProgress, setCloneProgress] = useState(0);
  
  // Audio Engine Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Constants
  const EMOTIONS = ['Neutral', 'Happy', 'Sad', 'Angry', 'Fearful', 'Whisper', 'Professional', 'Dramatic'];
  const MUSIC_STYLES = ['Cinematic', 'Piano', 'Ambient', 'Minimal', 'Drone'];
  const LANGUAGES = ['English (Professional)', 'Spanish (Latin Am)', 'French (Parisian)', 'German (Berlin)', 'Japanese (Tokyo)', 'Portuguese (Brazil)'];

  // Initialize Audio
  useEffect(() => {
    const saved = localStorage.getItem('dolor_custom_voices');
    if (saved) {
        try { const parsed = JSON.parse(saved); setAvailableVoices([...PREBUILT_VOICES, ...parsed]); } catch(e) {}
    }

    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioContextClass();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048; 
    audioContextRef.current = ctx;
    analyserRef.current = analyser;

    const audio = new Audio();
    audio.crossOrigin = "anonymous";
    audioRef.current = audio;

    const source = ctx.createMediaElementSource(audio);
    source.connect(analyser);
    analyser.connect(ctx.destination);

    audio.onended = () => setIsPlaying(false);
    audio.onpause = () => setIsPlaying(false);
    audio.onplay = () => { if (ctx.state === 'suspended') ctx.resume(); setIsPlaying(true); };
    audio.onerror = () => { setIsPlaying(false); setErrorMessage("Playback failed."); }

    return () => { source.disconnect(); analyser.disconnect(); ctx.close(); };
  }, []);

  // Speaker Detection
  useEffect(() => {
    if (isMultiSpeaker) {
      const lines = text.split('\n');
      const speakers = new Set<string>();
      lines.forEach(line => {
        const match = line.match(/^([A-Za-z0-9_]+):/);
        if (match) speakers.add(match[1]);
      });
      const newSpeakers = Array.from(speakers);
      setDetectedSpeakers(newSpeakers);

      setSpeakerMap(prev => {
        const newMap = { ...prev };
        let needsUpdate = false;
        newSpeakers.forEach((s, idx) => {
          if (!newMap[s]) {
            newMap[s] = availableVoices[idx % availableVoices.length].id;
            needsUpdate = true;
          }
        });
        return needsUpdate ? newMap : prev;
      });
    }
  }, [text, isMultiSpeaker, availableVoices]);

  // Auto Scroll Chat
  useEffect(() => {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // AI Trigger
  useEffect(() => {
      if (autoGenTrigger) {
          setAutoGenTrigger(false);
          setTimeout(() => { if (text.trim()) executeGeneration(); }, 500);
      }
  }, [autoGenTrigger, text]);

  // --- TOOL HANDLER (Shared by Voice & Text) ---
  const handleToolCall = async (name: string, args: any) => {
      console.log('Executing Tool:', name, args);
      
      if (name === 'update_script') {
          if (args.script) setText(args.script);
          return "Script updated successfully.";
      }
      if (name === 'select_voice') {
          const v = availableVoices.find(v => v.name.toLowerCase().includes(args.voice_name.toLowerCase()));
          if (v) { setSelectedVoice(v); return `Voice changed to ${v.name}.`; }
          return "Voice not found. Available voices are Puck, Charon, Kore, Fenrir, Aoede.";
      }
      if (name === 'configure_audio') {
          if (args.emotion) {
              const e = EMOTIONS.find(em => em.toLowerCase() === args.emotion.toLowerCase()) || 'Neutral';
              setEmotion(e);
          }
          if (typeof args.intensity === 'number') setEmotionIntensity(args.intensity);
          if (args.music_style) {
              const s = MUSIC_STYLES.find(ms => ms.toLowerCase() === args.music_style.toLowerCase()) || 'Cinematic';
              setMusicStyle(s);
          }
          if (typeof args.music_level === 'number') setBgLevel(args.music_level);
          return "Audio configuration updated.";
      }
      if (name === 'generate_production') {
          setAutoGenTrigger(true);
          return "Generation process initiated.";
      }
      return "Tool not found.";
  };

  // --- ASSISTANT LOGIC ---
  const toggleLiveSession = async () => {
      if (isLiveConnected) {
          liveClientRef.current?.disconnect();
          setIsLiveConnected(false);
          setLiveAnalyser(null);
      } else {
          try {
              const client = new LiveClient(
                  (analyser) => setLiveAnalyser(analyser),
                  () => setIsLiveConnected(false),
                  handleToolCall 
              );
              await client.connect();
              liveClientRef.current = client;
              setIsLiveConnected(true);
          } catch(e) {
              setErrorMessage("Failed to connect to Live API.");
          }
      }
  };

  const handleTextChat = async () => {
      if (!chatInput.trim() || isChatProcessing) return;
      const msg = chatInput;
      setChatInput('');
      setChatMessages(prev => [...prev, { role: 'user', text: msg, timestamp: Date.now() }]);
      setIsChatProcessing(true);

      try {
          if (!textClientRef.current) textClientRef.current = new TextClient(handleToolCall);
          const response = await textClientRef.current.sendMessage(msg);
          setChatMessages(prev => [...prev, { role: 'model', text: response, timestamp: Date.now() }]);
      } catch (e) {
          setChatMessages(prev => [...prev, { role: 'system', text: "Error connecting to assistant.", timestamp: Date.now() }]);
      } finally {
          setIsChatProcessing(false);
      }
  };

  // --- CORE FUNCTIONS ---
  const executeGeneration = async () => {
    setShowConsent(false);
    setIsGenerating(true);
    setErrorMessage(null);
    setGenerationPhase('Synthesizing Voice...');
    try {
      const { blob, duration } = await generateAudio(
        text, selectedVoice.id, emotion, musicStyle, emotionIntensity, 
        isMultiSpeaker, speakerMap, bgLevel / 100, 
        (bgSource === 'UPLOAD' && customBgFile) ? customBgFile : null
      );
      setGenerationPhase(bgSource === 'UPLOAD' ? 'Mixing Custom Track...' : `Composing ${musicStyle} Score...`);
      const url = URL.createObjectURL(blob);
      const newGen: GeneratedAudio = {
        id: Date.now().toString(), url, text: text.length > 50 ? text.substring(0, 50) + '...' : text,
        timestamp: Date.now(), duration, emotion, bgLevel
      };
      setGeneratedList(prev => [newGen, ...prev]);
      setCurrentAudio(newGen);
      setRightPanelTab('HISTORY'); // Switch to history to see result
      if (audioRef.current) { audioRef.current.src = url; audioRef.current.load(); }
    } catch (error: any) {
      setErrorMessage(error.message || "Synthesis failed.");
    } finally {
      setIsGenerating(false); setGenerationPhase('');
    }
  };

  const handleTranslate = async (lang: string) => {
      if (!text) return;
      setIsGenerating(true);
      setGenerationPhase(`Translating to ${lang}...`);
      setShowTranslate(false);
      try {
          const translated = await translateScript(text, lang);
          setText(translated);
      } catch (e) { setErrorMessage("Translation failed."); } 
      finally { setIsGenerating(false); setGenerationPhase(''); }
  };

  const startRecording = async () => {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const recorder = new MediaRecorder(stream);
        const chunks: BlobPart[] = [];
        recorder.ondataavailable = e => chunks.push(e.data);
        recorder.onstop = async () => {
            setIsGenerating(true); setGenerationPhase('Transcribing...');
            const blob = new Blob(chunks, { type: 'audio/webm' }); 
            try {
                const transcript = await transcribeAudio(blob);
                setText(prev => (prev ? prev + '\n' + transcript : transcript));
            } catch (e) { setErrorMessage("Transcription failed."); } 
            finally { setIsGenerating(false); setGenerationPhase(''); stream.getTracks().forEach(t => t.stop()); }
        };
        recorder.start();
        setMediaRecorder(recorder);
        setIsRecording(true);
    } catch (e) { setErrorMessage("Microphone access denied."); }
  };
  const stopRecording = () => { if (mediaRecorder && mediaRecorder.state !== 'inactive') { mediaRecorder.stop(); setIsRecording(false); } };

  const handleCloneSubmit = () => {
     if (!cloneFile || !cloneName.trim()) return;
     setIsCloning(true); setCloneProgress(0);
     const interval = setInterval(() => {
         setCloneProgress(p => { if (p >= 100) { clearInterval(interval); return 100; } return p + Math.random() * 5; });
     }, 100);
     setTimeout(() => {
        clearInterval(interval); setCloneProgress(100);
        setTimeout(() => {
            const newVoice: VoiceOption = { id: `cloned-${Date.now()}-${cloneGender}`, name: cloneName, gender: cloneGender, description: `Cloned from ${cloneFile.name}`, isCustom: true };
            const updatedVoices = [...availableVoices, newVoice];
            localStorage.setItem('dolor_custom_voices', JSON.stringify(updatedVoices.filter(v => v.isCustom)));
            setAvailableVoices(updatedVoices); setSelectedVoice(newVoice); setIsCloning(false); setMode(AppMode.STUDIO); setCloneFile(null); setCloneName(''); setCloneGender('Male'); setCloneProgress(0);
        }, 500);
     }, 3000);
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setText(prev => prev + text);
    } catch (err) {
      console.error('Failed to read clipboard contents: ', err);
    }
  };

  const handleGenerateClick = () => {
    setShowConsent(true);
  };

  const togglePlayback = useCallback((item?: GeneratedAudio) => {
    if (!audioRef.current) return;
    
    // Determine the target audio to act upon
    // If item is provided, that is the target.
    // If item is NOT provided, the target is currentAudio.
    const targetId = item ? item.id : currentAudio?.id;
    
    if (!targetId) return; // No audio to play

    if (currentAudio?.id === targetId) {
        // Toggle
        if (isPlaying) audioRef.current.pause(); 
        else audioRef.current.play();
    } else if (item) {
        // Switch (only if item provided, implied by logic reaching here)
        setCurrentAudio(item);
        audioRef.current.src = item.url;
        audioRef.current.play();
    }
  }, [currentAudio, isPlaying]);

  // --- RENDER ---
  return (
    <div className="h-screen bg-dolor-bg text-dolor-text font-sans overflow-hidden flex flex-col">
      {/* Header */}
      <header className="h-14 border-b border-dolor-border bg-dolor-panel flex items-center justify-between px-6 z-20 shadow-lg shadow-black/40 shrink-0">
        <div className="flex items-center gap-3">
          <div className="bg-dolor-surface p-1.5 rounded border border-dolor-border">
            <AudioWaveform className="w-5 h-5 text-dolor-accent" />
          </div>
          <h1 className="text-lg font-bold tracking-widest text-dolor-text font-mono">
            THE VOICE<span className="text-dolor-accent">_</span>OF<span className="text-dolor-accent">_</span>DOLOR
          </h1>
        </div>
        <div className="flex gap-4">
          <button onClick={() => setMode(AppMode.STUDIO)} className={`text-xs font-bold px-4 py-1.5 rounded-sm transition-all tracking-wider ${mode === AppMode.STUDIO ? 'bg-dolor-accent text-dolor-bg shadow-lg shadow-dolor-accent/20' : 'text-dolor-muted hover:text-white hover:bg-dolor-surface'}`}>STUDIO</button>
          <button onClick={() => setMode(AppMode.CLONING)} className={`text-xs font-bold px-4 py-1.5 rounded-sm transition-all tracking-wider ${mode === AppMode.CLONING ? 'bg-dolor-accent text-dolor-bg shadow-lg shadow-dolor-accent/20' : 'text-dolor-muted hover:text-white hover:bg-dolor-surface'}`}>CLONING</button>
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden relative min-h-0">
        {errorMessage && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-red-900/90 border border-red-500 text-red-100 px-6 py-3 rounded shadow-2xl backdrop-blur flex items-center gap-3 animate-in slide-in-from-top-4">
                <AlertCircle className="w-5 h-5" /> <span className="text-sm font-medium">{errorMessage}</span> <button onClick={() => setErrorMessage(null)}><X className="w-4 h-4" /></button>
            </div>
        )}

        {/* --- LEFT PANEL: CONFIG --- */}
        <div className="w-[420px] bg-dolor-panel border-r border-dolor-border flex flex-col z-10 min-h-0 shrink-0">
           <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-8">
            {mode === AppMode.STUDIO ? (
                <>
                {/* Voice Selection */}
                <div className="space-y-3">
                    <label className="text-xs font-mono text-dolor-accent uppercase tracking-widest flex items-center gap-2"><Mic className="w-3 h-3" /> Voice Model</label>
                    <div className="grid grid-cols-1 gap-2">
                    {availableVoices.map(voice => (
                        <button key={voice.id} onClick={() => setSelectedVoice(voice)} className={`p-3 rounded border text-left transition-all ${selectedVoice.id === voice.id ? 'bg-dolor-surface border-dolor-accent shadow-md shadow-dolor-accent/5' : 'bg-transparent border-dolor-border hover:border-dolor-muted hover:bg-dolor-surface/50'}`}>
                        <div className="flex justify-between items-center mb-1"><span className={`font-semibold text-sm tracking-wide ${selectedVoice.id === voice.id ? 'text-dolor-accent' : 'text-dolor-text'}`}>{voice.name}</span><span className={`text-[10px] px-2 py-0.5 rounded uppercase font-mono border ${selectedVoice.id === voice.id ? 'border-dolor-accent/30 text-dolor-accent bg-dolor-accent/10' : 'border-dolor-border text-dolor-muted bg-dolor-bg'}`}>{voice.gender}</span></div>
                        <p className="text-xs text-dolor-muted truncate font-light flex justify-between">{voice.description}{voice.isCustom && <Save className="w-3 h-3 text-dolor-accent" />}</p>
                        </button>
                    ))}
                    </div>
                </div>
                {/* Emotion */}
                <div className="space-y-3">
                    <div className="flex justify-between items-center"><label className="text-xs font-mono text-dolor-accent uppercase tracking-widest flex items-center gap-2"><Wand2 className="w-3 h-3" /> Emotional Depth</label>{emotion !== 'Neutral' && <span className="text-xs text-dolor-accent font-mono">{emotionIntensity}%</span>}</div>
                    <div className="flex flex-wrap gap-2">{EMOTIONS.map(e => (<button key={e} onClick={() => setEmotion(e)} className={`px-3 py-1.5 rounded-sm text-xs font-medium transition-all uppercase tracking-wider ${emotion === e ? 'bg-dolor-accent text-dolor-bg font-bold shadow-lg shadow-dolor-accent/20' : 'bg-dolor-surface text-dolor-muted border border-dolor-border hover:border-dolor-accent hover:text-white'}`}>{e}</button>))}</div>
                    {emotion !== 'Neutral' && <div className="pt-3 animate-in fade-in slide-in-from-top-1 duration-300"><input type="range" min="0" max="100" value={emotionIntensity} onChange={(e) => setEmotionIntensity(parseInt(e.target.value))} className="w-full h-1 bg-dolor-surface rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-dolor-accent [&::-webkit-slider-thumb]:shadow-[0_0_10px_rgba(251,191,36,0.5)]" /></div>}
                </div>
                {/* Advanced Settings */}
                <div className="p-5 rounded-lg bg-gradient-to-br from-dolor-surface to-dolor-panel border border-dolor-border space-y-5">
                    <div className="flex items-center justify-between"><label className="text-xs font-mono text-dolor-muted uppercase flex items-center gap-2"><Users className="w-3 h-3 text-dolor-accent" /> Multi-Speaker</label><button onClick={() => setIsMultiSpeaker(!isMultiSpeaker)} className={`w-10 h-5 rounded-full relative transition-colors ${isMultiSpeaker ? 'bg-dolor-accent' : 'bg-black/40 border border-dolor-border'}`}><div className={`absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white transition-all shadow-sm ${isMultiSpeaker ? 'left-[22px]' : 'left-0.5'}`} /></button></div>
                    <div className="space-y-4 pt-2 border-t border-dolor-border/30">
                        <div className="flex justify-between items-center"><label className="text-xs font-mono text-dolor-muted uppercase flex items-center gap-2"><Music className="w-3 h-3 text-dolor-accent" /> Background Score</label><span className="text-xs text-dolor-accent font-mono">{bgLevel === 0 ? 'OFF' : `${bgLevel}%`}</span></div>
                        <input type="range" min="0" max="100" value={bgLevel} onChange={(e) => setBgLevel(parseInt(e.target.value))} className="w-full h-1 bg-black/40 rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-dolor-accent [&::-webkit-slider-thumb]:shadow-[0_0_10px_rgba(251,191,36,0.5)]" />
                        <div className="flex bg-black/40 p-1 rounded border border-dolor-border"><button onClick={() => setBgSource('GENERATIVE')} className={`flex-1 text-[10px] font-mono py-1 rounded transition-all ${bgSource === 'GENERATIVE' ? 'bg-dolor-surface text-dolor-accent shadow-sm' : 'text-dolor-muted hover:text-white'}`}>AI GENERATED</button><button onClick={() => setBgSource('UPLOAD')} className={`flex-1 text-[10px] font-mono py-1 rounded transition-all ${bgSource === 'UPLOAD' ? 'bg-dolor-surface text-dolor-accent shadow-sm' : 'text-dolor-muted hover:text-white'}`}>UPLOAD CUSTOM</button></div>
                        {bgLevel > 0 && bgSource === 'GENERATIVE' && <div className="grid grid-cols-2 gap-2 pt-1">{MUSIC_STYLES.map(style => (<button key={style} onClick={() => setMusicStyle(style)} className={`px-2 py-1.5 rounded text-[10px] font-mono border transition-all ${musicStyle === style ? 'bg-dolor-surface border-dolor-accent text-dolor-accent' : 'border-dolor-border text-dolor-muted hover:bg-dolor-surface/50'}`}>{style.toUpperCase()}</button>))}</div>}
                        {bgLevel > 0 && bgSource === 'UPLOAD' && <div className="pt-1"><div className="border border-dashed border-dolor-border rounded bg-dolor-surface/10 p-3 flex flex-col items-center justify-center gap-2 hover:bg-dolor-surface/30 transition-colors relative cursor-pointer"><FileMusic className="w-5 h-5 text-dolor-muted" /><span className="text-[10px] font-mono text-dolor-muted">{customBgFile ? customBgFile.name : "DRAG & DROP INSTRUMENTAL"}</span><input type="file" accept="audio/*" className="opacity-0 absolute inset-0 cursor-pointer" onChange={(e) => e.target.files && setCustomBgFile(e.target.files[0])} />{customBgFile && <button onClick={(e) => { e.preventDefault(); setCustomBgFile(null); }} className="absolute top-1 right-1 text-dolor-muted hover:text-red-400 p-1"><X className="w-3 h-3" /></button>}</div></div>}
                    </div>
                </div>
                {isMultiSpeaker && detectedSpeakers.length > 0 && <div className="space-y-3 border-t border-dolor-border pt-4"><label className="text-xs font-mono text-dolor-accent uppercase tracking-widest">Cast Assignment</label>{detectedSpeakers.map(speaker => (<div key={speaker} className="flex items-center justify-between text-sm"><span className="text-dolor-text font-medium">{speaker}</span><select className="bg-dolor-surface border border-dolor-border text-xs rounded px-2 py-1 outline-none focus:border-dolor-accent text-dolor-muted" value={speakerMap[speaker] || ''} onChange={(e) => setSpeakerMap(prev => ({...prev, [speaker]: e.target.value}))}>{availableVoices.map(v => (<option key={v.id} value={v.id}>{v.name} ({v.gender})</option>))}</select></div>))}</div>}
                </>
            ) : (
                <div className="space-y-6">
                 <div className="bg-dolor-surface/30 p-5 rounded border border-dolor-accent/20"><h3 className="text-dolor-accent font-mono font-bold text-sm mb-2 flex items-center gap-2"><Layers className="w-4 h-4" /> CLONING ENGINE</h3><p className="text-xs text-dolor-muted leading-relaxed">Upload a high-fidelity vocal sample (WAV/MP3) to train a neural voice replica.</p></div>
                 {!isCloning ? (
                    <>
                    <div className="space-y-4"><label className="block text-xs font-mono text-dolor-accent uppercase">Voice Name</label><input type="text" value={cloneName} onChange={(e) => setCloneName(e.target.value)} className="w-full bg-dolor-surface border border-dolor-border rounded p-3 text-sm focus:border-dolor-accent outline-none text-white placeholder-dolor-border" placeholder="e.g. My Narrator Voice" /></div>
                    <div className="space-y-4"><label className="block text-xs font-mono text-dolor-accent uppercase">Voice Gender</label><select value={cloneGender} onChange={(e) => setCloneGender(e.target.value as 'Male' | 'Female')} className="w-full bg-dolor-surface border border-dolor-border rounded p-3 text-sm focus:border-dolor-accent outline-none text-white"><option value="Male">Male</option><option value="Female">Female</option></select></div>
                    <div className="space-y-4"><label className="block text-xs font-mono text-dolor-accent uppercase">Source Audio</label><div className="border-2 border-dashed border-dolor-border rounded bg-dolor-surface/20 h-32 flex flex-col items-center justify-center gap-3 text-dolor-muted hover:border-dolor-accent hover:text-dolor-accent transition-all cursor-pointer relative group"><UploadCloud className="w-8 h-8 group-hover:scale-110 transition-transform" /><span className="text-xs font-mono">{cloneFile ? cloneFile.name : "DRAG & DROP / CLICK"}</span><input type="file" className="opacity-0 absolute inset-0 cursor-pointer" accept="audio/*" onChange={(e) => e.target.files && setCloneFile(e.target.files[0])} /></div></div>
                    <button onClick={handleCloneSubmit} disabled={isCloning || !cloneFile || !cloneName} className="w-full py-4 bg-gradient-to-r from-dolor-gold to-dolor-accent text-dolor-bg font-bold rounded shadow-lg hover:shadow-dolor-accent/30 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 uppercase tracking-widest text-xs transition-all hover:scale-[1.01]"><Layers className="w-4 h-4" /> Initialize Cloning</button>
                    </>
                 ) : (
                    <div className="flex flex-col items-center justify-center h-[400px] space-y-6"><div className="flex items-end justify-center gap-1 h-32 w-full px-8">{Array.from({length: 20}).map((_, i) => (<div key={i} className="w-2 bg-dolor-accent rounded-t-sm animate-pulse-slow" style={{height: `${Math.max(20, Math.random() * 100)}%`, animationDelay: `${i * 0.1}s`, opacity: 0.8}} />))}</div><div className="relative w-full px-8"><div className="h-1 bg-dolor-surface w-full rounded overflow-hidden"><div className="h-full bg-dolor-accent transition-all duration-300 ease-out shadow-[0_0_10px_#fbbf24]" style={{ width: `${cloneProgress}%` }} /></div></div></div>
                 )}
                </div>
            )}
           </div>
        </div>

        {/* --- CENTER PANEL: WORKSPACE --- */}
        {mode === AppMode.STUDIO || mode === AppMode.CLONING ? (
        <div className="flex-1 flex flex-col bg-dolor-bg relative min-w-0">
                <div className="flex-1 p-6 flex flex-col min-h-0">
                    <div className="flex-1 bg-dolor-panel border border-dolor-border rounded shadow-2xl relative flex flex-col overflow-hidden ring-1 ring-dolor-border/50">
                        <div className="p-3 border-b border-dolor-border flex items-center justify-between bg-dolor-surface/50 shrink-0">
                            <div className="flex items-center gap-2 text-dolor-muted"><Type className="w-4 h-4 text-dolor-accent" /><span className="text-xs font-mono tracking-wider">SCRIPT_EDITOR_V2.0</span></div>
                            <div className="flex items-center gap-2">
                                <button onClick={isRecording ? stopRecording : startRecording} className={`p-1.5 rounded transition-all flex items-center gap-1 ${isRecording ? 'bg-red-900/50 text-red-400 animate-pulse' : 'hover:bg-dolor-surface text-dolor-muted'}`} title="Transcribe Audio"><Mic className="w-3.5 h-3.5" />{isRecording && <span className="text-[9px] font-mono">REC</span>}</button>
                                <div className="relative">
                                    <button onClick={() => setShowTranslate(!showTranslate)} className="p-1.5 hover:bg-dolor-surface text-dolor-muted transition-colors rounded" title="Translate / Refine"><Globe className="w-3.5 h-3.5" /></button>
                                    {showTranslate && <div className="absolute top-8 right-0 bg-dolor-panel border border-dolor-border rounded shadow-xl w-48 z-50 overflow-hidden animate-in fade-in slide-in-from-top-2">{LANGUAGES.map(lang => (<button key={lang} onClick={() => handleTranslate(lang)} className="w-full text-left px-3 py-2 text-xs text-dolor-muted hover:bg-dolor-surface hover:text-white transition-colors border-b border-dolor-border/20 last:border-0">{lang}</button>))}</div>}
                                </div>
                                <div className="h-4 w-px bg-dolor-border mx-1" />
                                <button onClick={handlePaste} className="p-1 hover:text-dolor-accent text-dolor-muted transition-colors" title="Paste from Clipboard"><Clipboard className="w-3.5 h-3.5" /></button>
                                <button onClick={() => setText('')} className="p-1 hover:text-dolor-accent text-dolor-muted transition-colors" title="Clear Text"><Eraser className="w-3.5 h-3.5" /></button>
                            </div>
                        </div>
                        <div className="flex-1 relative">
                            <textarea className="w-full h-full bg-transparent p-8 text-lg text-dolor-text placeholder-dolor-border/50 outline-none resize-none font-serif leading-relaxed custom-scrollbar" placeholder="Enter your script here... Or ask the AI Director to write one for you." value={text} onChange={(e) => setText(e.target.value)} />
                        </div>
                        <div className="h-40 border-t border-dolor-border bg-black/20 p-4 shrink-0">
                            <AudioVisualizer analyser={analyserRef.current} />
                        </div>
                    </div>
                </div>
                <div className="h-24 border-t border-dolor-border bg-dolor-panel px-8 flex items-center justify-between shadow-[0_-10px_40px_rgba(0,0,0,0.5)] z-20 shrink-0">
                    <div className="flex items-center gap-4 min-w-0">
                        {currentAudio && (
                            <div className="flex items-center gap-4 bg-dolor-bg pl-2 pr-6 py-2 rounded-full border border-dolor-border shadow-inner max-w-full">
                                <button onClick={() => togglePlayback()} className="w-10 h-10 rounded-full bg-dolor-accent text-dolor-bg flex items-center justify-center hover:bg-white transition-colors shadow-lg shadow-dolor-accent/20 shrink-0">{isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current pl-1" />}</button>
                                <div className="flex flex-col min-w-0"><span className="text-xs font-bold text-white truncate">{currentAudio.text}</span><div className="flex items-center gap-2"><span className="text-[10px] text-dolor-accent font-mono">{isPlaying ? 'PLAYING' : 'PAUSED'}</span><span className="text-[10px] text-dolor-muted">|</span><span className="text-[10px] text-dolor-muted font-mono">{currentAudio.duration.toFixed(1)}s</span></div></div>
                            </div>
                        )}
                    </div>
                    <button onClick={handleGenerateClick} disabled={isGenerating || !text.trim()} className="px-10 py-4 bg-gradient-to-r from-dolor-gold to-dolor-accent text-dolor-bg font-extrabold rounded shadow-lg shadow-dolor-gold/20 hover:shadow-dolor-gold/40 transition-all flex items-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed hover:scale-105 active:scale-95 uppercase tracking-widest text-sm shrink-0 ml-4">{isGenerating ? <Loader2 className="w-5 h-5 animate-spin" /> : <Command className="w-5 h-5" />}{isGenerating ? generationPhase : 'GENERATE AUDIO'}</button>
                </div>
        </div>
        ) : null}

        {/* --- RIGHT PANEL: ASSISTANT & HISTORY --- */}
        <div className="w-96 border-l border-dolor-border bg-dolor-panel flex flex-col z-10 shrink-0 min-h-0">
           {/* Tab Header */}
           <div className="flex border-b border-dolor-border">
               <button onClick={() => setRightPanelTab('ASSISTANT')} className={`flex-1 py-3 text-xs font-mono tracking-widest transition-colors flex items-center justify-center gap-2 border-b-2 ${rightPanelTab === 'ASSISTANT' ? 'border-dolor-accent text-dolor-accent bg-dolor-surface/50' : 'border-transparent text-dolor-muted hover:text-white'}`}><Bot className="w-4 h-4" /> AI DIRECTOR</button>
               <button onClick={() => setRightPanelTab('HISTORY')} className={`flex-1 py-3 text-xs font-mono tracking-widest transition-colors flex items-center justify-center gap-2 border-b-2 ${rightPanelTab === 'HISTORY' ? 'border-dolor-accent text-dolor-accent bg-dolor-surface/50' : 'border-transparent text-dolor-muted hover:text-white'}`}><Clock className="w-4 h-4" /> PRODUCTION LOG</button>
           </div>
           
           <div className="flex-1 overflow-hidden relative">
              {/* INTERFACE 2: HISTORY & DOWNLOAD */}
              {rightPanelTab === 'HISTORY' && (
                  <div className="absolute inset-0 overflow-y-auto p-3 space-y-3 custom-scrollbar">
                        {generatedList.map(item => (
                            <div key={item.id} className={`p-4 rounded border transition-all cursor-pointer group relative overflow-hidden ${currentAudio?.id === item.id ? 'bg-dolor-surface border-dolor-accent shadow-md' : 'bg-dolor-bg/40 border-dolor-border hover:border-dolor-muted hover:bg-dolor-surface/50'}`} onClick={() => togglePlayback(item)}>
                                {currentAudio?.id === item.id && <div className="absolute left-0 top-0 bottom-0 w-1 bg-dolor-accent" />}
                                <div className="flex justify-between items-start mb-2"><span className="text-[10px] text-dolor-muted font-mono opacity-70">{new Date(item.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                                {/* Download Button */}
                                <a href={item.url} download={`dolor-${item.id}.wav`} className="text-dolor-muted hover:text-dolor-accent transition-colors p-1" onClick={(e) => e.stopPropagation()} title="Download WAV"><Download className="w-3.5 h-3.5" /></a></div>
                                <p className="text-xs text-dolor-text line-clamp-2 mb-3 font-medium leading-relaxed">{item.text}</p>
                            </div>
                        ))}
                        {generatedList.length === 0 && <div className="flex flex-col items-center justify-center py-20 text-dolor-border gap-2"><AudioWaveform className="w-8 h-8 opacity-20" /><span className="text-xs font-mono opacity-50">NO LOGS FOUND</span></div>}
                  </div>
              )}

              {/* INTERFACE 1: TEXT TYPING & VOICE ASSISTANT */}
              {rightPanelTab === 'ASSISTANT' && (
                  <div className="absolute inset-0 flex flex-col">
                      {/* Chat Area */}
                      <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
                          {chatMessages.map((msg, i) => (
                              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                  <div className={`max-w-[85%] p-3 rounded-lg text-xs leading-relaxed ${msg.role === 'user' ? 'bg-dolor-border text-white' : 'bg-dolor-surface border border-dolor-border text-dolor-text'}`}>
                                      {msg.role === 'system' && <span className="block text-[9px] text-dolor-accent font-bold mb-1 uppercase tracking-wider">Director AI</span>}
                                      {msg.text}
                                  </div>
                              </div>
                          ))}
                          {isChatProcessing && <div className="flex justify-start"><div className="bg-dolor-surface p-3 rounded-lg"><Loader2 className="w-4 h-4 animate-spin text-dolor-accent" /></div></div>}
                          <div ref={chatEndRef} />
                      </div>

                      {/* Visualizer for Voice Mode */}
                      {isLiveConnected && (
                          <div className="h-20 border-t border-dolor-border bg-black/40 p-2 relative">
                               <div className="absolute top-1 right-2 text-[9px] text-red-500 font-mono animate-pulse font-bold flex items-center gap-1"><Mic className="w-3 h-3" /> LISTENING</div>
                               <AudioVisualizer analyser={liveAnalyser} />
                          </div>
                      )}

                      {/* Manual Text Typing Interface */}
                      <div className="p-3 bg-dolor-surface/50 border-t border-dolor-border">
                          <label className="text-[10px] text-dolor-muted font-mono mb-1 block">MANUAL INPUT / VOICE CONTROL</label>
                          <div className="flex items-end gap-2">
                              <button onClick={toggleLiveSession} className={`p-3 rounded-lg transition-all border ${isLiveConnected ? 'bg-red-900/30 border-red-500 text-red-500 animate-pulse' : 'bg-dolor-bg border-dolor-border text-dolor-muted hover:border-dolor-accent hover:text-white'}`} title="Voice Mode">
                                  <Mic className="w-5 h-5" />
                              </button>
                              <div className="flex-1 bg-dolor-bg border border-dolor-border rounded-lg flex items-center pr-2 focus-within:border-dolor-muted transition-colors">
                                  <input 
                                    type="text" 
                                    value={chatInput}
                                    onChange={(e) => setChatInput(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleTextChat()}
                                    placeholder={isLiveConnected ? "Voice active. Speak now..." : "Type here to chat with AI..."}
                                    className="flex-1 bg-transparent p-3 text-xs text-white outline-none placeholder-dolor-border/50"
                                    disabled={isLiveConnected}
                                  />
                                  <button onClick={handleTextChat} disabled={!chatInput.trim() || isLiveConnected} className="p-1.5 text-dolor-muted hover:text-dolor-accent disabled:opacity-30"><Send className="w-4 h-4" /></button>
                              </div>
                          </div>
                      </div>
                  </div>
              )}
           </div>
        </div>

      </main>

      {showConsent && <ConsentModal mode="GENERATE" onAccept={executeGeneration} onDecline={() => setShowConsent(false)} />}
    </div>
  );
}