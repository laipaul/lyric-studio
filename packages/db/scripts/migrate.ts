// pnpm db:migrate — creates the workspace folders and applies database migrations.
import { dbFile, openWorkspace } from "../src";

const ws = openWorkspace();
console.log(`Database up to date: ${dbFile(ws.dir)}`);
ws.close();
