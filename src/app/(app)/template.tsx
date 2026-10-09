import { PageTransition } from "@/components/ui-kit";

// Templates remount on navigation, so every page animates in.
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  return <PageTransition className="flex flex-1 flex-col gap-6">{children}</PageTransition>;
}
