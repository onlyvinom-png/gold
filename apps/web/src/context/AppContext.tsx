import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getDict, isRtl, type Dict, type Lang } from '../lib/i18n';

const STORAGE_KEY = 'goldscope.lang';

interface AppContextValue {
  lang: Lang;
  dir: 'rtl' | 'ltr';
  t: Dict;
  setLang: (lang: Lang) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

function detectInitialLang(): Lang {
  if (typeof window !== 'undefined') {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'ar' || stored === 'en') return stored;
  }
  // Arabic is the product default.
  return 'ar';
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectInitialLang);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const dir = isRtl(lang) ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
    try {
      window.localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      /* storage unavailable — language still applies for this session */
    }
  }, [lang]);

  const value = useMemo<AppContextValue>(
    () => ({
      lang,
      dir: isRtl(lang) ? 'rtl' : 'ltr',
      t: getDict(lang),
      setLang: setLangState,
    }),
    [lang],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
  return ctx;
}
