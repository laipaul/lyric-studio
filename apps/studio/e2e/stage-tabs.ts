// The song page groups its tabs in four stages (Prepare, Shape, Make, Review & Post): a tab is reached by
// its stage first. Generate's full panel is folded under "Make release pack": opened here when asked.
const STAGE_OF: Record<string, string> = { Assets: "prepare", Lyrics: "prepare", Style: "shape", Storyboard: "shape", Generate: "make", Videos: "review", Post: "review" };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function openTab(page: any, tab: string): Promise<void> {
  await page.click(`[data-stage=${STAGE_OF[tab]}]`);
  if (tab === "Generate") {
    const toggle = await page.waitForSelector("button[aria-expanded]:has-text('Generate videos')");
    if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
    return;
  }
  await page.click(`[role=tab]:has-text('${tab}')`);
  // The Style tab folds its Automatic block and the six font rows (Look → Fine-tune): these tests use every setting.
  if (tab === "Style") await unfoldStyle(page);
}

// Opens the Style tab's Automatic block and the font Fine-tune rows when folded.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function unfoldStyle(page: any): Promise<void> {
  for (const sel of ["[data-auto-toggle]", "[data-fine-tune]"]) {
    const toggle = await page.waitForSelector(sel);
    if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
  }
}
