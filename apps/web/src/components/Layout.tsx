import { NavLink, Outlet } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { isRtl } from '../lib/i18n';

const NAV = [
  { to: '/', key: 'dashboard', icon: '◎' },
  { to: '/signals', key: 'signals', icon: '◆' },
  { to: '/history', key: 'history', icon: '≡' },
  { to: '/strategy', key: 'strategy', icon: '✦' },
  { to: '/settings', key: 'settings', icon: '⚙' },
  { to: '/diagnostics', key: 'diagnostics', icon: '⚑' },
] as const;

export function Layout() {
  const { t, lang, setLang } = useApp();

  return (
    <div className="min-h-screen bg-ink-900 pb-20 lg:pb-0">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-ink-800/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-gold-500 font-black text-ink-900">
              GS
            </span>
            <div className="leading-tight">
              <p className="text-sm font-bold text-gold-300">{t.appName}</p>
              <p className="hidden text-[11px] text-slate-500 sm:block">{t.tagline}</p>
            </div>
          </div>

          <nav className="hidden items-center gap-1 lg:flex" aria-label={t.appName}>
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-2 text-sm font-medium transition ${
                    isActive
                      ? 'bg-gold-500/15 text-gold-300'
                      : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
                  }`
                }
              >
                {t.nav[item.key]}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-ghost !px-2 !py-1.5 text-xs"
              onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}
              aria-label={lang === 'ar' ? 'Switch to English' : 'التبديل إلى العربية'}
            >
              {lang === 'ar' ? 'EN' : 'ع'}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-5">
        <Outlet />
      </main>

      {/* Mobile bottom navigation — thumb friendly on iPhone */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-6 border-t border-white/10 bg-ink-800/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
        aria-label={t.appName}
      >
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium ${
                isActive ? 'text-gold-300' : 'text-slate-500'
              }`
            }
          >
            <span className="text-base leading-none">{item.icon}</span>
            <span className="truncate px-0.5">{t.nav[item.key]}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

export default Layout;
