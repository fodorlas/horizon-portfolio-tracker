import { getI18n } from "@/lib/i18n-server";
import { signOut } from "./logout-actions";

export async function LogoutButtons() {
  const { m } = await getI18n();
  return (
    <form action={signOut} className="flex flex-wrap gap-3 text-sm">
      <button type="submit" name="scope" value="local" className="underline underline-offset-4">
        {m.logout.local}
      </button>
      <button type="submit" name="scope" value="global" className="text-text-muted underline underline-offset-4">
        {m.logout.global}
      </button>
    </form>
  );
}
