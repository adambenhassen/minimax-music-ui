import { useEffect, useRef, useState } from 'react';
import type { Track } from '../types';
import { api } from '../api';
import { coverStyle } from '../lib/cover';
import { fmtTime } from '../lib/format';
import { Waveform } from './Waveform';
import { Download, Next, Pause, Play, Prev } from './Icons';

interface Props {
  track: Track | null;
  playing: boolean;
  onPlayingChange: (p: boolean) => void;
  onPrev: () => void;
  onNext: () => void;
  onEnded: () => void;
}

export function Player({ track, playing, onPlayingChange, onPrev, onNext, onEnded }: Props) {
  const audio = useRef<HTMLAudioElement>(null);
  const [time, setTime] = useState(0);
  const [dur, setDur] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [starved, setStarved] = useState(false);
  const starvedRef = useRef(false);
  const loadedSrc = useRef('');
  const pendingSeek = useRef<number | null>(null);

  const live = track?.status === 'running';
  const rendered = track?.renderedSeconds ?? 0;
  const total = track ? (live ? track.duration : dur || track.duration) : 0;
  // live tracks: bump the url whenever more audio exists so a reload picks up the longer file
  const src = track ? (live ? `${api.audioUrl(track.id)}?r=${Math.floor(rendered)}` : api.audioUrl(track.id)) : '';

  useEffect(() => {
    const el = audio.current;
    if (!el || !track || !src || loadedSrc.current === src) return;
    const sameTrack = loadedSrc.current.startsWith(api.audioUrl(track.id));
    const nearEnd = el.duration > 0 && el.duration - el.currentTime < 2;
    // Keep playing what we have unless we're about to run dry; a reload costs a small gap.
    if (sameTrack && live && playing && !starved && !nearEnd) return;
    const pos = sameTrack ? el.currentTime : 0;
    loadedSrc.current = src;
    if (!sameTrack) { setTime(0); setDur(0); }
    setErr(null);
    pendingSeek.current = pos > 0 ? pos : null;
    const resume = playing || starved;
    starvedRef.current = false; setStarved(false);
    el.src = src;
    el.load();
    if (resume) el.play().catch((e) => setErr(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, live, playing, starved]);

  useEffect(() => {
    const el = audio.current;
    if (!el || !track) return;
    if (playing) { if (!starvedRef.current) el.play().catch((e) => setErr(e.message)); }
    else el.pause();
  }, [playing, track]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return;
      if (e.code === 'Space' && track) { e.preventDefault(); onPlayingChange(!playing); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [playing, track, onPlayingChange]);

  const seek = (frac: number) => {
    const el = audio.current;
    if (!el || !total) return;
    const target = Math.min(frac * total, Math.max(0, (dur || total) - 0.1));
    el.currentTime = target;
    setTime(el.currentTime);
    if (starvedRef.current && target < dur - 0.1) { starvedRef.current = false; setStarved(false); if (playing) el.play().catch(() => {}); }
  };

  const handleEnded = () => {
    if (live) { starvedRef.current = true; setStarved(true); return; } // wait for more audio, keep "playing"
    onEnded();
  };

  const subtitle = err ?? (starved ? 'Buffering — waiting for the renderer…' : live ? `Live · ${fmtTime(rendered)} rendered` : track ? track.prompt : 'Pick a finished track');

  return (
    <div className="h-20 shrink-0 border-t border-ink-700 bg-ink-900/95 backdrop-blur px-3 md:px-4 flex items-center gap-2 md:gap-4">
      <audio
        ref={audio}
        preload="metadata"
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onDurationChange={(e) => setDur(e.currentTarget.duration)}
        onLoadedMetadata={(e) => { if (pendingSeek.current !== null) { e.currentTarget.currentTime = pendingSeek.current; pendingSeek.current = null; } }}
        onEnded={handleEnded}
        onPlay={() => onPlayingChange(true)}
        onPause={() => { if (!starvedRef.current) onPlayingChange(false); }}
        onError={() => setErr('playback error')}
      />
      <div className="flex items-center gap-3 w-36 md:w-64 min-w-0">
        <div className="w-12 h-12 rounded-lg shrink-0" style={track ? coverStyle(track.id) : { background: '#22222f' }} />
        <div className="min-w-0">
          <div className="text-sm font-medium truncate">{track?.title ?? 'Nothing playing'}</div>
          <div className="text-[11px] text-zinc-500 truncate">{subtitle}</div>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <button className="icon-btn" onClick={onPrev} disabled={!track} aria-label="Previous"><Prev width={18} height={18} /></button>
        <button
          className="w-10 h-10 rounded-full bg-white text-ink-950 flex items-center justify-center hover:scale-105 transition disabled:opacity-40"
          onClick={() => onPlayingChange(!playing)}
          disabled={!track}
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? <Pause width={18} height={18} /> : <Play width={18} height={18} className="translate-x-[1px]" />}
        </button>
        <button className="icon-btn" onClick={onNext} disabled={!track} aria-label="Next"><Next width={18} height={18} /></button>
      </div>
      <div className="flex-1 flex items-center gap-3 min-w-0">
        <span className="text-[11px] text-zinc-400 tabular-nums w-10 text-right">{fmtTime(time)}</span>
        <div className="flex-1 min-w-0">
          {track ? <Waveform url={src} progress={total ? time / total : 0} coverage={live ? Math.min(1, (dur || rendered) / track.duration) : 1} onSeek={seek} /> : <div className="h-[2px] bg-ink-700 rounded" />}
        </div>
        <span className="text-[11px] text-zinc-400 tabular-nums w-10">{fmtTime(total)}</span>
      </div>
      <a className={`icon-btn hidden md:inline-flex ${track ? '' : 'pointer-events-none opacity-40'}`} href={track ? api.downloadUrl(track.id) : '#'} title="Download"><Download width={18} height={18} /></a>
    </div>
  );
}
