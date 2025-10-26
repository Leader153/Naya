
import React, { useState, useRef, useEffect } from 'react';
import { Chat, LiveSession, LiveServerMessage } from '@google/genai';
import { createChatSession, generateVideo, connectToLiveSession, decode, decodeAudioData, createBlob } from './services/geminiService';
import { AspectRatio, ChatMessage, GenerationStatus } from './types';
import { ApiKeySelector } from './components/ApiKeySelector';
import { SendIcon, UploadIcon, XCircleIcon, MicrophoneIcon, StopIcon } from './components/icons';

const DEFAULT_VIDEO_PROMPT = `Generate a 10-second high-resolution 3D character animation.

Character: A female AI assistant named Naya with short blonde hair, blue eyes, and an elegant white and gold futuristic suit. She has a friendly, professional expression.

Scene: Medium shot against a simple, blurred background of a shopping mall. She is a coffee shop clerk.

Action:
1. (0-3 seconds): Naya stands in a relaxed, professional, "down" pose, smiling warmly at the camera. She blinks naturally.
2. (3-6 seconds): She raises her right hand in a friendly, gentle gesture, greeting the viewer.
3. (6-10 seconds): She lowers her hand and gestures with an open palm to the side, as if about to present information on an invisible screen. Her facial expression remains friendly and interested.`;


const fileToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = (error) => reject(error);
    });

export default function App() {
    // Chat state
    const chatRef = useRef<Chat | null>(null);
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
        { role: 'model', text: "Hello! I'm Naya, your personal AI assistant. How can I help you today?" }
    ]);
    const [userInput, setUserInput] = useState('');
    const [isChatting, setIsChatting] = useState(false);
    const chatContainerRef = useRef<HTMLDivElement>(null);

    // Video state
    const [videoPrompt, setVideoPrompt] = useState(DEFAULT_VIDEO_PROMPT);
    const [uploadedImage, setUploadedImage] = useState<{ file: File; preview: string; } | null>(null);
    const [generationStatus, setGenerationStatus] = useState<GenerationStatus>('idle');
    const [progressMessage, setProgressMessage] = useState('');
    const [generatedVideoUrl, setGeneratedVideoUrl] = useState<string | null>(null);
    const [errorMessage, setErrorMessage] = useState('');
    const [isKeySelected, setIsKeySelected] = useState(false);

    // Live session state
    const [isRecording, setIsRecording] = useState(false);
    const sessionPromiseRef = useRef<Promise<LiveSession> | null>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const audioContextRef = useRef<{ input: AudioContext; output: AudioContext; scriptProcessor: ScriptProcessorNode; source: MediaStreamAudioSourceNode } | null>(null);
    const audioPlaybackRef = useRef<{ nextStartTime: number, sources: Set<AudioBufferSourceNode> }>({ nextStartTime: 0, sources: new Set() });


    useEffect(() => {
        chatRef.current = createChatSession();

        return () => { // Cleanup on unmount
            if (isRecording) {
                stopRecording();
            }
        };
    }, []);
    
    useEffect(() => {
        if (chatContainerRef.current) {
            chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
        }
    }, [chatMessages]);

    const handleSendMessage = async () => {
        if (!userInput.trim() || !chatRef.current || isChatting) return;

        const newUserMessage: ChatMessage = { role: 'user', text: userInput };
        setChatMessages(prev => [...prev, newUserMessage]);
        setUserInput('');
        setIsChatting(true);

        try {
            const stream = await chatRef.current.sendMessageStream({ message: userInput });
            let modelResponse = '';
            setChatMessages(prev => [...prev, { role: 'model', text: '' }]);
            
            for await (const chunk of stream) {
                modelResponse += chunk.text;
                setChatMessages(prev => {
                    const newMessages = [...prev];
                    newMessages[newMessages.length - 1].text = modelResponse;
                    return newMessages;
                });
            }
        } catch (error) {
            console.error(error);
            const errorText = 'Sorry, I encountered an error. Please try again.';
            setChatMessages(prev => {
                const newMessages = [...prev];
                if(newMessages[newMessages.length - 1].role === 'model' && newMessages[newMessages.length - 1].text === ''){
                    newMessages[newMessages.length - 1].text = errorText;
                } else {
                    newMessages.push({ role: 'model', text: errorText });
                }
                return newMessages;
            });
        } finally {
            setIsChatting(false);
        }
    };
    
    const handleLiveMessage = async (message: LiveServerMessage) => {
        // --- Handle Audio Playback ---
        const audioData = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
        if (audioData && audioContextRef.current?.output) {
            const outputCtx = audioContextRef.current.output;
            const playback = audioPlaybackRef.current;
            
            playback.nextStartTime = Math.max(playback.nextStartTime, outputCtx.currentTime);
            const audioBuffer = await decodeAudioData(decode(audioData), outputCtx, 24000, 1);
            const source = outputCtx.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(outputCtx.destination);
            source.addEventListener('ended', () => playback.sources.delete(source));
            source.start(playback.nextStartTime);
            playback.nextStartTime += audioBuffer.duration;
            playback.sources.add(source);
        }

        if (message.serverContent?.interrupted) {
            audioPlaybackRef.current.sources.forEach(source => source.stop());
            audioPlaybackRef.current.sources.clear();
            audioPlaybackRef.current.nextStartTime = 0;
        }

        // --- Handle Transcription ---
        if (message.serverContent?.inputTranscription) {
            const text = message.serverContent.inputTranscription.text;
            setChatMessages(prev => {
                const lastMsg = prev[prev.length - 1];
                if (lastMsg?.role === 'user') {
                    const newMessages = [...prev];
                    newMessages[newMessages.length - 1].text += text;
                    return newMessages;
                }
                return [...prev, { role: 'user', text }];
            });
        } else if (message.serverContent?.outputTranscription) {
            const text = message.serverContent.outputTranscription.text;
             setChatMessages(prev => {
                const lastMsg = prev[prev.length - 1];
                if (lastMsg?.role === 'model') {
                    const newMessages = [...prev];
                    newMessages[newMessages.length - 1].text += text;
                    return newMessages;
                }
                return [...prev, { role: 'model', text }];
            });
        }
    };
    
    const startRecording = async () => {
        try {
            setIsRecording(true);
            mediaStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });

            // FIX: Cast window to `any` to allow access to the vendor-prefixed `webkitAudioContext` for broader browser compatibility.
            const inputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
            const outputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });

            sessionPromiseRef.current = connectToLiveSession({
                onOpen: () => {
                    const source = inputAudioContext.createMediaStreamSource(mediaStreamRef.current!);
                    const scriptProcessor = inputAudioContext.createScriptProcessor(4096, 1, 1);
                    scriptProcessor.onaudioprocess = (event) => {
                        const inputData = event.inputBuffer.getChannelData(0);
                        const pcmBlob = createBlob(inputData);
                        sessionPromiseRef.current?.then(session => session.sendRealtimeInput({ media: pcmBlob }));
                    };
                    source.connect(scriptProcessor);
                    scriptProcessor.connect(inputAudioContext.destination);
                    audioContextRef.current = { ...audioContextRef.current, scriptProcessor, source };
                },
                onMessage: handleLiveMessage,
                onError: (e) => {
                    console.error('Live session error:', e);
                    setErrorMessage('A connection error occurred.');
                    stopRecording();
                },
                onClose: () => {
                    console.log('Live session closed.');
                },
            });
            audioContextRef.current = { input: inputAudioContext, output: outputAudioContext, scriptProcessor: null!, source: null! };

        } catch (err) {
            console.error('Failed to start recording:', err);
            setErrorMessage('Could not access microphone. Please check your browser permissions.');
            setIsRecording(false);
        }
    };

    const stopRecording = () => {
        setIsRecording(false);
        mediaStreamRef.current?.getTracks().forEach(track => track.stop());
        
        if (sessionPromiseRef.current) {
            sessionPromiseRef.current.then(session => session.close());
            sessionPromiseRef.current = null;
        }

        if (audioContextRef.current) {
            audioContextRef.current.scriptProcessor?.disconnect();
            audioContextRef.current.source?.disconnect();
            audioContextRef.current.input.close();
            audioContextRef.current.output.close();
            audioContextRef.current = null;
        }

        audioPlaybackRef.current.sources.forEach(source => source.stop());
        audioPlaybackRef.current.sources.clear();
        audioPlaybackRef.current.nextStartTime = 0;
    };


    const handleToggleRecording = () => {
        if (isRecording) {
            stopRecording();
        } else {
            startRecording();
        }
    };


    const handleGenerateVideo = async () => {
        if (!videoPrompt.trim() || generationStatus === 'generating') return;

        setGenerationStatus('generating');
        setGeneratedVideoUrl(null);
        setErrorMessage('');
        
        try {
            let imagePayload;
            if (uploadedImage) {
                const base64Data = await fileToBase64(uploadedImage.file);
                imagePayload = { data: base64Data, mimeType: uploadedImage.file.type };
            }
            const url = await generateVideo(videoPrompt, AspectRatio.Portrait, setProgressMessage, imagePayload);
            setGeneratedVideoUrl(url);
            setGenerationStatus('success');
        } catch (error: any) {
            console.error(error);
             if (error.message && error.message.includes("Requested entity was not found.")) {
                setErrorMessage("API Key not found or invalid. Please re-select your key.");
                setIsKeySelected(false); // Force re-selection
            } else {
                setErrorMessage(error.message || 'An unknown error occurred during video generation.');
            }
            setGenerationStatus('error');
        }
    };

    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setUploadedImage({ file, preview: URL.createObjectURL(file) });
        }
    };
    
    const VideoPanel = () => (
        <div className="flex flex-col h-full bg-gray-800 rounded-2xl p-4 md:p-6 text-white overflow-y-auto">
            <ApiKeySelector onKeySelectionChange={setIsKeySelected}>
            <div className="space-y-4">
                <h3 className="text-xl font-bold text-yellow-400">Veo Video Generation</h3>
                
                {errorMessage && <div className="p-3 bg-red-900 border border-red-700 text-red-200 rounded-lg">{errorMessage}</div>}

                {generationStatus === 'generating' ? (
                    <div className="text-center p-8 border-2 border-dashed border-gray-600 rounded-lg">
                        <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-yellow-400 mx-auto mb-4"></div>
                        <p className="text-lg font-semibold">{progressMessage}</p>
                        <p className="text-gray-400 mt-2">Video generation can take a few minutes. Please wait.</p>
                    </div>
                ) : generatedVideoUrl ? (
                    <div>
                        <video controls src={generatedVideoUrl} className="w-full rounded-lg"></video>
                        <button onClick={() => setGeneratedVideoUrl(null)} className="mt-4 w-full bg-yellow-500 hover:bg-yellow-600 text-gray-900 font-bold py-2 px-4 rounded-lg">
                            Create Another Video
                        </button>
                    </div>
                ) : (
                    <>
                        <div>
                            <label htmlFor="videoPrompt" className="block mb-2 font-semibold">Prompt</label>
                            <textarea
                                id="videoPrompt"
                                value={videoPrompt}
                                onChange={(e) => setVideoPrompt(e.target.value)}
                                rows={8}
                                className="w-full p-3 bg-gray-700 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-500"
                            />
                        </div>

                        <div>
                            <label htmlFor="imageUpload" className="block mb-2 font-semibold">Start Image (Optional)</label>
                           <label htmlFor="imageUpload" className="flex items-center justify-center gap-2 w-full p-2 bg-gray-700 border-2 border-gray-600 rounded-lg cursor-pointer hover:bg-gray-600">
                               <UploadIcon />
                               <span>{uploadedImage ? "Change Image" : "Upload Image"}</span>
                           </label>
                           <input id="imageUpload" type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                       </div>


                        {uploadedImage && (
                            <div className="relative w-32 h-32">
                                <img src={uploadedImage.preview} alt="Upload preview" className="w-full h-full object-cover rounded-lg" />
                                <button onClick={() => setUploadedImage(null)} className="absolute -top-2 -right-2 bg-gray-900 rounded-full p-1 text-white hover:bg-red-600">
                                    <XCircleIcon />
                                </button>
                            </div>
                        )}
                        
                        <button onClick={handleGenerateVideo} className="w-full bg-yellow-500 hover:bg-yellow-600 text-gray-900 font-bold py-3 px-4 rounded-lg disabled:bg-gray-600 disabled:cursor-not-allowed" disabled={!videoPrompt.trim()}>
                            Generate Video
                        </button>
                    </>
                )}
            </ApiKeySelector>
        </div>
    );


    return (
        <main className="bg-gray-900 text-white min-h-screen p-4 sm:p-6 lg:p-8">
            <div className="container mx-auto max-w-7xl grid grid-cols-1 lg:grid-cols-2 gap-8 h-[calc(100vh-4rem)]">
                {/* Chat Panel */}
                <div className="flex flex-col h-full bg-gray-800 rounded-2xl p-4 md:p-6">
                    <div className="flex items-center pb-4 mb-4 border-b border-gray-700">
                        <img src="https://storage.googleapis.com/generative-ai-projen-dev-public/user-assets/db2a89c8-5f25-4672-9e2c-2d04a60f9521/original.jpg" alt="Naya AI Assistant" className="w-12 h-12 object-cover rounded-full" />
                        <div className="ml-4">
                           <h1 className="text-xl font-bold text-yellow-300">Naya</h1>
                           <p className="text-gray-400 text-sm">AI-Powered Virtual Assistant</p>
                        </div>
                    </div>
                    <div ref={chatContainerRef} className="flex-1 overflow-y-auto pr-2 space-y-4 mb-4">
                        {chatMessages.map((msg, index) => (
                            <div key={index} className={`flex items-start ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                {msg.role === 'model' && (
                                    <img src="https://storage.googleapis.com/generative-ai-projen-dev-public/user-assets/db2a89c8-5f25-4672-9e2c-2d04a60f9521/original.jpg" alt="Naya's avatar" className="w-8 h-8 rounded-full mr-3 object-cover flex-shrink-0"/>
                                )}
                                <div className={`max-w-xs lg:max-w-md p-3 rounded-lg ${msg.role === 'user' ? 'bg-yellow-500 text-gray-900' : 'bg-gray-700 text-white'}`}>
                                    <p className="whitespace-pre-wrap">{msg.text}</p>
                                </div>
                            </div>
                        ))}
                         {isRecording && <div className="text-center text-gray-400 italic">Listening...</div>}
                    </div>
                    <div className="flex items-center space-x-2">
                        <input
                            type="text"
                            value={userInput}
                            onChange={(e) => setUserInput(e.target.value)}
                            onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                            placeholder={isRecording ? "Voice input is active..." : "Ask Naya anything..."}
                            className="flex-1 p-3 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-yellow-500"
                            disabled={isChatting || isRecording}
                        />
                         <button
                            onClick={handleToggleRecording}
                            className={`p-3 rounded-lg transition-colors ${isRecording ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-blue-500 text-white hover:bg-blue-600'}`}
                            aria-label={isRecording ? 'Stop recording' : 'Start recording'}
                        >
                            {isRecording ? <StopIcon /> : <MicrophoneIcon />}
                        </button>
                        <button
                            onClick={handleSendMessage}
                            disabled={isChatting || isRecording}
                            className="p-3 bg-yellow-500 text-gray-900 rounded-lg disabled:bg-gray-600 disabled:cursor-not-allowed hover:bg-yellow-600 transition-colors"
                        >
                            <SendIcon />
                        </button>
                    </div>
                </div>

                {/* Video Panel */}
                <VideoPanel />
            </div>
        </main>
    );
}