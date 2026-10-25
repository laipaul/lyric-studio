import { redirect } from "next/navigation";

// The Library is the start page now.
export default function LibraryRedirect() {
  redirect("/");
}
