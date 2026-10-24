import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const TABS = ["Projects", "Exports", "Uploads", "Collections"];

// Library: placeholder tabs. Real content arrives in a later step.
export default function LibraryPage() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-8">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Library</h1>
        <div className="relative w-64">
          <Search className="text-muted-foreground absolute top-2.5 left-2.5 size-4" />
          <Input placeholder="Search" className="pl-8" />
        </div>
      </div>

      <Tabs defaultValue={TABS[0]}>
        <TabsList>
          {TABS.map((tab) => (
            <TabsTrigger key={tab} value={tab}>
              {tab}
            </TabsTrigger>
          ))}
        </TabsList>
        {TABS.map((tab) => (
          <TabsContent key={tab} value={tab}>
            <div className="text-muted-foreground flex h-40 items-center justify-center rounded-xl border border-dashed text-sm">
              No {tab.toLowerCase()} yet.
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
