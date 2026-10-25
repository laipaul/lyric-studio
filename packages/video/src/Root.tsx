import { Composition } from "remotion";

import { LyricVideo } from "./LyricVideo";
import { COMPOSITION_ID, VIDEO } from "./config";
import { defaultLyricVideoProps, type LyricVideoProps } from "./props";
import { defaultThumbnailProps, Thumbnail, THUMBNAIL_ID, THUMBNAIL_SIZE } from "./Thumbnail";

export const RemotionRoot: React.FC = () => (
  <>
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
    <Composition
      id={THUMBNAIL_ID}
      component={Thumbnail}
      durationInFrames={1}
      fps={VIDEO.fps}
      width={THUMBNAIL_SIZE.width}
      height={THUMBNAIL_SIZE.height}
      defaultProps={defaultThumbnailProps}
    />
  </>
);
