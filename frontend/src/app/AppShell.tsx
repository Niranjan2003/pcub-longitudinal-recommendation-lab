import { useEffect } from 'react';
import { NavLink, Outlet, useLocation, useNavigationType } from 'react-router';
import { ConnectionIndicator, GlobalBanners } from './StatusStrip';

/**
 * A new page starts at the top. Without this the browser keeps the previous
 * page's scroll offset, so e.g. a just-created session opened ~1000 px down,
 * past its header and the Get recommendation button. Back/forward (POP)
 * keeps the browser's own restoration.
 */
function ScrollToTopOnNavigate() {
  const { pathname } = useLocation();
  const type = useNavigationType();
  useEffect(() => {
    if (type === 'POP' || typeof window.scrollTo !== 'function' || navigator.userAgent.includes('jsdom')) return;
    window.scrollTo(0, 0);
  }, [pathname, type]);
  return null;
}

const NAV = [
  { to: '/', label: 'Overview', end: true },
  { to: '/lab', label: 'Live Session', end: false },
  { to: '/architecture', label: 'Architecture', end: false },
  { to: '/r1', label: 'R1 archive', end: false },
  { to: '/method', label: 'Method', end: false },
  { to: '/system', label: 'System', end: false },
];

function BrandMark() {
  return (
    <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="6" fill="#0F5E6B" />
      <circle cx="16" cy="9" r="3" fill="#FAF8F3" />
      <circle cx="8" cy="23" r="3" fill="#FAF8F3" />
      <circle cx="24" cy="23" r="3" fill="#FAF8F3" />
      <path d="M16 12v4M16 16l-6 5M16 16l6 5" stroke="#FAF8F3" strokeWidth="1.6" fill="none" />
    </svg>
  );
}

export function AppShell() {
  return (
    <div className="flex min-h-screen flex-col">
      <ScrollToTopOnNavigate />
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="border-b border-rule bg-card">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-8 gap-y-2 px-4 py-3">
          <NavLink to="/" className="flex items-center gap-3 no-underline" aria-label="PCUB home">
            <BrandMark />
            <span className="leading-tight">
              <span className="block font-serif text-lg font-semibold tracking-tight">PCUB</span>
              <span className="block text-xs text-muted">Longitudinal Recommendation Lab</span>
            </span>
          </NavLink>
          <nav aria-label="Primary" className="flex flex-wrap gap-1">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  `rounded-md px-3 py-1.5 text-sm font-medium no-underline ${isActive ? 'bg-teal text-white' : 'text-ink hover:bg-paper-2'}`
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto">
            <ConnectionIndicator />
          </div>
        </div>
      </header>
      <GlobalBanners />
      <main id="main" className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6" tabIndex={-1}>
        <Outlet />
      </main>
      <footer className="border-t border-rule px-4 py-4 text-center text-xs text-muted">
        Research demonstration. Interactive sessions are an engineering simulation, not a human study, and not clinical or allergy-safety advice.
      </footer>
    </div>
  );
}
