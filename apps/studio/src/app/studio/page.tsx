import { redirect } from "next/navigation";

// The Studio editor comes in a later step; until then its address leads to the Library.
export default function StudioRedirect() {
  redirect("/");
}
