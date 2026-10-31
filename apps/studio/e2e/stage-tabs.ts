// The song page: a Canva-style rail on the left with the four stages (Prepare, Shape, Make, Review) and,
// on Shape, its menus (Fonts, Effects, Colour, Clips, Text, This song, To make, Automatic), each opening
// one panel. Generate's full panel is folded under "Make release pack": opened here when asked.
const STAGE_OF: Record<string, string> = { Assets: "prepare", Lyrics: "prepare", Style: "shape", Storyboard: "shape", Shape: "shape", Generate: "make", Videos: "review", Post: "review" };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function openTab(page: any, tab: string): Promise<void> {
  await page.click(`[data-stage=${STAGE_OF[tab]}]`);
  if (tab === "Generate") {
    const toggle = await page.waitForSelector("button[aria-expanded]:has-text('Generate videos')");
    if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
    return;
  }
  if (STAGE_OF[tab] === "shape") {
    await page.waitForSelector("[data-shape]");
    return;
  }
  await page.click(`[role=tab]:has-text('${tab}')`);
}

// Opens one of the Shape panels from the rail (fonts, effects, colour, clips, text, song, make, auto);
// "fonts" also unfolds Fine-tune (the six font rows).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function openPanel(page: any, id: string): Promise<void> {
  if (!(await page.$(`[data-rail-item=${id}][aria-pressed=true]`))) await page.click(`[data-rail-item=${id}]`);
  await page.waitForSelector(`[data-shape-panel=${id}]`);
  if (id === "fonts") {
    const toggle = await page.waitForSelector("[data-fine-tune]");
    if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
  }
}

// Kept for older tests: the Automatic panel (where the tempo is).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function unfoldStyle(page: any): Promise<void> {
  await page.waitForSelector("[data-shape]");
  await openPanel(page, "auto");
}

// A setting's ⋯ menu item (lock, reset, per platform, use for all my songs): opens the menu, then clicks it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function menuItem(page: any, field: string, item: string): Promise<void> {
  await page.click(`[data-row-menu="${field}"]`);
  await page.click(`[role=menuitem][${item}]`);
}
