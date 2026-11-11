import { createFileRoute, Outlet } from "@tanstack/react-router";
import { Shell } from "@/components/shell";

export const Route = createFileRoute("/wills/$willId")({
  component: WillLayout,
});

function WillLayout() {
  return (
    <Shell>
      <Outlet />
    </Shell>
  );
}
