'use client';

import { ArrowRight, FolderGit2, Plus, ShieldCheck, Sparkles } from 'lucide-react';

export function FirstRunWelcome({ onStart }: { onStart(intent: 'new' | 'existing'): void }) {
  return <section className="first-run-welcome mode-scene" aria-labelledby="welcome-title">
    <div className="welcome-panel liquid-surface">
      <div className="welcome-brand"><span><Sparkles size={18} /></span><div><small>Welcome to Autonomous Builder</small><strong>Build software without the setup headache.</strong></div></div>
      <h1 id="welcome-title">What do you want to do?</h1>
      <p className="welcome-lead">Describe what you want in plain language. Builder can create something new or safely work on an app you already have. You review the plan before it changes anything.</p>
      <div className="welcome-choice-grid">
        <button className="welcome-choice" onClick={() => onStart('new')}>
          <span className="welcome-choice-icon"><Plus size={21} /></span>
          <span><strong>Build a new app</strong><small>Start from your idea. Builder creates the project folder and handles the technical setup.</small></span>
          <ArrowRight size={17} />
        </button>
        <button className="welcome-choice" onClick={() => onStart('existing')}>
          <span className="welcome-choice-icon"><FolderGit2 size={21} /></span>
          <span><strong>Improve an existing app</strong><small>Choose the app or repo folder, then tell Builder what you want added, fixed, or changed.</small></span>
          <ArrowRight size={17} />
        </button>
      </div>
      <div className="welcome-how">
        <strong>How it works</strong>
        <ol><li><span>1</span><div><b>Describe it</b><small>Tell Builder the result you want.</small></div></li><li><span>2</span><div><b>Check the plan</b><small>Review what Builder understood from your words and files.</small></div></li><li><span>3</span><div><b>Approve once</b><small>Nothing starts until you approve the build direction.</small></div></li><li><span>4</span><div><b>Builder takes it from there</b><small>It builds, repairs ordinary failures, tests, and verifies the result.</small></div></li></ol>
      </div>
      <div className="welcome-privacy"><ShieldCheck size={16} /><span><strong>Private by default.</strong> Your project files and Builder control data stay on this computer unless a build you approve specifically needs an outside service.</span></div>
    </div>
  </section>;
}
