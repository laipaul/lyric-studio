"use client";

// A silent take played with the song (Creation's player, 21 Nov 2026: "why can't I hear the song with the take? I'd have
// to go back to Shape to check"): the take's video (no sound of its own) and the song file from the second the take's
// first frame belongs to (`fromS`; `clipInS`: where in the take the line starts), kept together through play, pause,
// seeking and the end. The song file is only played, never changed. "With the song" off: the take alone, as before.
import { useEffect, useRef, useState } from "react";

export function WithSong({ video, song, fromS, clipInS = 0, why }: { video: string; song: string | null; fromS: number | null; clipInS?: number; why: string | null }) {
  const v = useRef<HTMLVideoElement>(null);
  const a = useRef<HTMLAudioElement>(null);
  const can = !!song && fromS !== null;
  const [on, setOn] = useState(can);
  const songAt = () => (fromS ?? 0) + Math.max(0, (v.current?.currentTime ?? 0) - clipInS);
  const follow = () => {
    const audio = a.current;
    const vid = v.current;
    if (!audio || !vid || !on || !can) return;
    if (Math.abs(audio.currentTime - songAt()) > 0.08) audio.currentTime = songAt();
    if (vid.paused !== audio.paused) void (vid.paused ? audio.pause() : audio.play().catch(() => undefined));
  };
  useEffect(() => {
    const vid = v.current;
    if (!vid) return;
    if (can && on) vid.currentTime = clipInS;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per take
  }, [video]);
  useEffect(() => {
    if (!on) a.current?.pause();
    else follow();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the switch only
  }, [on]);
  return (
    <div className="flex flex-col gap-2" data-with-song={can && on ? "on" : "off"}>
      <video
        ref={v}
        key={video}
        src={video}
        controls
        autoPlay
        muted
        playsInline
        loop={!(can && on)}
        className="bg-muted max-h-[70vh] w-full rounded object-contain"
        onPlay={follow}
        onPause={() => a.current?.pause()}
        onSeeked={follow}
        onTimeUpdate={follow}
        onEnded={() => a.current?.pause()}
      />
      {can ? <audio ref={a} src={song!} preload="auto" data-with-song-audio /> : null}
      <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
        {can ? (
          <>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} data-with-song-switch /> With the song
            </label>
            <span data-with-song-why>{on ? why : "the take alone, without sound"}</span>
          </>
        ) : (
          <span data-with-song-why>On no line yet: put it on a line (Lyrics Sync → Show a clip) to hear it with the song. Takes are made without sound.</span>
        )}
      </div>
    </div>
  );
}
