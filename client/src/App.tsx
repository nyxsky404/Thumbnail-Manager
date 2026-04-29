import { Outlet } from "react-router-dom";

export function App() {
  return (
    <div className="min-h-screen bg-[#0b0d10] text-neutral-200">
      <Outlet />
    </div>
  );
}
