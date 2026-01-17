import React, { useRef, useEffect } from 'react';

interface AudioVisualizerProps {
  analyser: AnalyserNode | null;
}

const AudioVisualizer: React.FC<AudioVisualizerProps> = ({ analyser }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const requestRef = useRef<number | null>(null);

  useEffect(() => {
    if (!analyser) return;

    const animate = () => {
      if (!canvasRef.current) return;
      
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      analyser.getByteTimeDomainData(dataArray);

      // Clear with background color matches new 'panel' color
      ctx.fillStyle = '#051a10'; 
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.lineWidth = 2;
      // Gold line
      ctx.strokeStyle = '#fbbf24'; 
      ctx.beginPath();

      const sliceWidth = canvas.width * 1.0 / bufferLength;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = v * canvas.height / 2;

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }

        x += sliceWidth;
      }

      ctx.lineTo(canvas.width, canvas.height / 2);
      ctx.stroke();

      requestRef.current = requestAnimationFrame(animate);
    };

    requestRef.current = requestAnimationFrame(animate);

    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [analyser]);

  return (
    <div className="relative w-full h-full rounded-lg overflow-hidden bg-dolor-panel border border-dolor-border shadow-inner">
        <div className="absolute top-2 left-2 text-[10px] text-dolor-accent font-mono tracking-widest z-10 opacity-70">SIGNAL OUTPUT L/R</div>
        <canvas 
        ref={canvasRef} 
        width={800} 
        height={200} 
        className="w-full h-full"
        />
        {/* Grid Overlay */}
        <div className="absolute inset-0 pointer-events-none opacity-10" 
            style={{
                backgroundImage: 'linear-gradient(to right, #fbbf24 1px, transparent 1px), linear-gradient(to bottom, #fbbf24 1px, transparent 1px)',
                backgroundSize: '40px 40px'
            }}>
        </div>
    </div>
  );
};

export default AudioVisualizer;