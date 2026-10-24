import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import type { LyricVideoProps } from "./config";

// Placeholder composition. Clips, beats and lyrics arrive in later steps.
export const LyricVideo: React.FC<LyricVideoProps> = ({ title, artist }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 15], [0, 1], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: "#0a0a0a",
        color: "white",
        justifyContent: "center",
        alignItems: "center",
        fontFamily: "Arial, Helvetica, sans-serif",
        opacity,
      }}
    >
      <div style={{ fontSize: 96, fontWeight: 800, textAlign: "center" }}>
        {title}
      </div>
      <div style={{ fontSize: 48, marginTop: 24, opacity: 0.7 }}>{artist}</div>
    </AbsoluteFill>
  );
};
