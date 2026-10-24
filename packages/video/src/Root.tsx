import { Composition } from "remotion";
import { LyricVideo } from "./LyricVideo";
import { COMPOSITION_ID, VIDEO, defaultLyricVideoProps } from "./config";

export const RemotionRoot: React.FC = () => (
  <Composition
    id={COMPOSITION_ID}
    component={LyricVideo}
    durationInFrames={VIDEO.fps * 5}
    fps={VIDEO.fps}
    width={VIDEO.width}
    height={VIDEO.height}
    defaultProps={defaultLyricVideoProps}
  />
);
