import { Composition } from "remotion";

import { LyricVideo } from "./LyricVideo";
import { COMPOSITION_ID, VIDEO } from "./config";
import { defaultLyricVideoProps, type LyricVideoProps } from "./props";

export const RemotionRoot: React.FC = () => (
  <Composition
    id={COMPOSITION_ID}
    component={LyricVideo}
    durationInFrames={defaultLyricVideoProps.durationInFrames}
    fps={VIDEO.fps}
    width={VIDEO.width}
    height={VIDEO.height}
    defaultProps={defaultLyricVideoProps}
    calculateMetadata={({ props }: { props: LyricVideoProps }) => ({
      durationInFrames: props.durationInFrames,
      width: props.format?.width ?? VIDEO.width,
      height: props.format?.height ?? VIDEO.height,
    })}
  />
);
