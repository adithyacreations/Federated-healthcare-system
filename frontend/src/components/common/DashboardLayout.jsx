import { useState } from 'react';
import Navbar from './Navbar';
import Sidebar from './Sidebar';

const DashboardLayout = ({ children }) => {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar onToggleSidebar={() => setMobileOpen((v) => !v)} />
      <div className="flex flex-1 min-h-0">
        {/* Desktop sidebar — sticky below the 64px navbar so it stays put while
            the page content scrolls; the sidebar scrolls internally if tall. */}
        <div className="hidden lg:flex sticky top-16 self-start h-[calc(100vh-4rem)]">
          <Sidebar />
        </div>

        {/* Mobile sidebar overlay */}
        {mobileOpen && (
          <div className="lg:hidden fixed inset-0 z-30 flex">
            <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
            <div className="relative">
              <Sidebar onClose={() => setMobileOpen(false)} />
            </div>
          </div>
        )}

        <main className="flex-1 overflow-x-hidden bg-cream">
          <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">{children}</div>
        </main>
      </div>
    </div>
  );
};

export default DashboardLayout;
