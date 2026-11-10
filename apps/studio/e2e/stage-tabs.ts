// The song page (N1): a rail with the four stages only (Prepare, Shape, Make, Review), numbered; each stage's sections
// are tabs inside it. Prepare: Files · Lyrics & timing · Details · Clips; Shape: Look · Part & ending · Pace · Shots (each
// opens one panel); Make: Videos · Try other looks · Options (one form); Review: Videos · Post.
const STAGE_OF: Record<string, string> = { Assets: "prepare", Files: "prepare", Audio: "prepare", Lyrics: "prepare", Details: "prepare", Clips: "prepare", Style: "shape", Storyboard: "shape", Shape: "shape", Generate: "make", Make: "make", Videos: "review", Post: "review" };
// Prepare (10 Nov 2026): Audio · Lyrics & timing · Details · Storyboard; the tab ids stay (assets, lyrics, details, clips).
// "Storyboard" here still means the Shape page (older tests); Prepare's Storyboard tab is "Clips".
const TAB_ID: Record<string, string> = { Assets: "assets", Files: "assets", Audio: "assets", Lyrics: "lyrics", Details: "details", Clips: "clips", Videos: "videos", Post: "post" };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function openTab(page: any, tab: string): Promise<void> {
  await page.click(`[data-stage=${STAGE_OF[tab]}]`);
  if (tab === "Generate" || tab === "Make") {
    await page.click("[data-make-tab=videos]");
    const toggle = await page.waitForSelector("button[aria-expanded]:has-text('Generate videos')");
    if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
    return;
  }
  if (STAGE_OF[tab] === "shape") {
    await page.waitForSelector("[data-shape]");
    return;
  }
  await page.click(`[data-stage-tab=${TAB_ID[tab]}]`);
}

// Opens where a setting lives now (N1). Shape's tabs: look, part, pace, shots (old names: clips -> shots, auto -> part,
// theme -> look). The song's settings moved out of Shape: "song" / "details" -> Prepare → Details, "tempo" -> Prepare →
// Lyrics & timing, "collections" -> Prepare → Clips, "make" -> Make → Videos. The theme editor (fonts, effects, colour):
// Look → Edit theme (nothing is saved until saveTheme below); "fonts" also unfolds "Choose each font".
const SHAPE_TAB: Record<string, string> = { look: "look", theme: "look", part: "part", auto: "part", pace: "pace", shots: "shots", clips: "shots" };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function openPanel(page: any, id: string): Promise<void> {
  if (id === "song" || id === "details") {
    await openTab(page, "Details");
    await page.waitForSelector("[data-style-block=details]");
    return;
  }
  if (id === "tempo") {
    await openTab(page, "Lyrics");
    await page.waitForSelector("[data-style-block=timing]");
    return;
  }
  if (id === "collections") {
    await openTab(page, "Clips");
    await page.waitForSelector("[data-style-block=collections]");
    return;
  }
  if (id === "make") {
    await page.click("[data-stage=make]");
    await page.click("[data-make-tab=videos]");
    await page.waitForSelector("[data-style-block=make]");
    return;
  }
  const look = ["fonts", "effects", "colour"].includes(id);
  if (!(await page.$("[data-stage=shape][aria-current=step]"))) await page.click("[data-stage=shape]");
  const tab = look ? "look" : SHAPE_TAB[id];
  if (look && (await page.$("[data-theme-editors]"))) return void (id === "fonts" && (await unfoldFonts(page)));
  if (!(await page.$(`[data-shape-panel=${tab}]`))) await page.click(`[data-shape-tab=${tab}]`); // the tab stays selected under Theme / Text / Analysis: a click goes back to it
  await page.waitForSelector(`[data-shape-panel=${tab}]`);
  if (tab !== "shots") await page.waitForSelector(`[data-style-block=${tab}]`); // the song's settings loaded (Shape remounts after another stage)
  if (!look) return;
  await page.click("[data-look-edit-theme]");
  await page.waitForSelector("[data-theme-editors]");
  if (id === "fonts") await unfoldFonts(page);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function unfoldFonts(page: any): Promise<void> {
  const toggle = await page.waitForSelector("[data-fine-tune]");
  if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
}

// Shape's panel (N1 polish): a tab is always selected and its panel always shows; it can only be collapsed (the button
// on its edge), so the viewer takes the width. Text / Theme / Analysis first go back to the tab (their ×).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function collapsePanel(page: any): Promise<void> {
  if (await page.isVisible("[data-panel-close]")) await page.click("[data-panel-close]");
  if (await page.isVisible("[data-panel-collapse]")) await page.click("[data-panel-collapse]");
  await page.waitForSelector("[data-panel-expand]");
}

// The theme editor's "Save": the draft goes into the song's theme; the editor closes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function saveTheme(page: any): Promise<void> {
  await page.click("[data-theme-save]");
  await page.waitForSelector("[data-theme-editors]", { state: "detached" });
}

// Kept for older tests: where the tempo is (Prepare → Lyrics & timing since N1; it was in Automatic).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function unfoldStyle(page: any): Promise<void> {
  await openPanel(page, "tempo");
}

// A setting's ⋯ menu item (lock, reset, per platform, use for all my songs): opens the menu, then clicks it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function menuItem(page: any, field: string, item: string): Promise<void> {
  await page.click(`[data-row-menu="${field}"]`);
  await page.click(`[role=menuitem][${item}]`);
}
