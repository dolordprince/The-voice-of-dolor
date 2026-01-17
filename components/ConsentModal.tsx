import React, { useState } from 'react';
import { ShieldCheck, AlertTriangle, X } from 'lucide-react';

interface ConsentModalProps {
  onAccept: () => void;
  onDecline: () => void;
  mode: 'CLONE' | 'GENERATE';
}

const ConsentModal: React.FC<ConsentModalProps> = ({ onAccept, onDecline, mode }) => {
  const [checked, setChecked] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div className="bg-dolor-800 border border-dolor-600 rounded-xl shadow-2xl max-w-md w-full overflow-hidden">
        <div className="bg-dolor-900 p-4 border-b border-dolor-700 flex justify-between items-center">
          <h2 className="text-xl font-bold flex items-center text-white">
            <ShieldCheck className="w-5 h-5 mr-2 text-dolor-accent" />
            Ethics & Consent
          </h2>
          <button onClick={onDecline} className="text-dolor-500 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="p-6 space-y-4">
          <div className="bg-yellow-900/20 border border-yellow-700/50 p-4 rounded-lg flex gap-3">
            <AlertTriangle className="w-6 h-6 text-yellow-500 flex-shrink-0" />
            <p className="text-sm text-yellow-200">
              The Voice of Dolor engine generates hyper-realistic human audio. 
              Misuse for deepfakes, fraud, or harassment is strictly prohibited and monitored.
            </p>
          </div>

          <p className="text-dolor-300 text-sm leading-relaxed">
            {mode === 'CLONE' 
              ? "You are about to upload a voice sample for analysis. By proceeding, you certify that you are the owner of this voice or have explicit written consent from the owner to clone it for this specific usage."
              : "By generating audio with this tool, you agree to use the output responsibly. All generated artifacts are watermarked and traceable."
            }
          </p>

          <label className="flex items-start gap-3 p-3 bg-dolor-900/50 rounded-lg cursor-pointer hover:bg-dolor-900 transition-colors">
            <input 
              type="checkbox" 
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
              className="mt-1 w-4 h-4 rounded border-dolor-600 bg-dolor-800 text-dolor-accent focus:ring-dolor-accent"
            />
            <span className="text-sm text-gray-300">
              I certify that I have the right to use this content/voice and agree to the Terms of Ethical Use.
            </span>
          </label>
        </div>

        <div className="p-4 bg-dolor-900 border-t border-dolor-700 flex justify-end gap-3">
          <button 
            onClick={onDecline}
            className="px-4 py-2 rounded-lg text-sm text-dolor-300 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button 
            onClick={onAccept}
            disabled={!checked}
            className={`px-6 py-2 rounded-lg text-sm font-semibold shadow-lg transition-all ${
              checked 
                ? 'bg-dolor-accent text-dolor-900 hover:bg-sky-300 shadow-dolor-accent/20' 
                : 'bg-dolor-700 text-dolor-500 cursor-not-allowed'
            }`}
          >
            Confirm & Proceed
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConsentModal;
