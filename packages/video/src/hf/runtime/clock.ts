// Stands in for Remotion inside the HyperFrames text layer: the shared text code (LyricScene, TextCards) asks
// for the current frame and the video's settings; here they come from the page's own clock, set before each
// frame is drawn. The bundler maps "remotion" to this file for the text layer only.
let frame = 0;
let config = { fps: 30, durationInFrames: 1, width: 1080, height: 1920, id: "main", defaultProps: {}, props: {}, defaultCodec: null };
export const setFrame = (f: number) => {
  frame = f;
};
export const setVideoConfig = (c: Partial<typeof config>) => {
  config = { ...config, ...c };
};
export const useCurrentFrame = () => frame;
export const useVideoConfig = () => config;
