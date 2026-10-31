// The song page: a Canva-style rail on the left with the four stages (Prepare, Shape, Make, Review) and,
// on Shape, its menus (Theme, Clips, This song, To make, Automatic), each opening
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

// Opens one of the Shape panels from the rail (theme, clips, song, make, auto). The look's old panels
// (fonts, effects, colour) now live in the theme editor: they open the Theme panel and "Edit theme"
// (nothing is saved until saveTheme below); "fonts" also unfolds "Choose each font".
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function openPanel(page: any, id: string): Promise<void> {
  const look = ["fonts", "effects", "colour"].includes(id);
  const rail = look ? "theme" : id;
  if (!(await page.$(`[data-rail-item=${rail}][aria-pressed=true]`))) await page.click(`[data-rail-item=${rail}]`);
  await page.waitForSelector(`[data-shape-panel=${rail}]`);
  if (!look) return;
  if (!(await page.$("[data-theme-editors]"))) {
    await page.click("[data-theme-edit]");
    await page.waitForSelector("[data-theme-editors]");
  }
  if (id === "fonts") {
    const toggle = await page.waitForSelector("[data-fine-tune]");
    if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
  }
}

// The theme editor's "Save": the draft goes into the song's theme; the editor closes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function saveTheme(page: any): Promise<void> {
  await page.click("[data-theme-save]");
  await page.waitForSelector("[data-theme-editors]", { state: "detached" });
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
