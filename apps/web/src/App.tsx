import { Suspense, lazy, useEffect } from 'react';
import { ToastHost, toast } from './components/ui';
import { useOnline } from './lib/online';
import { useBackgroundMusic } from './lib/music';
import { setTableLandscape } from './lib/platform';
import { useRoute } from './lib/router';
import { settings } from './lib/store';
import { Home } from './screens/Home';
import { LocalGame } from './screens/LocalGame';
import { OnlineRoom } from './screens/OnlineRoom';

const Gallery = import.meta.env.DEV ? lazy(() => import('./screens/Gallery')) : null;

function useThemeSync() {
  const s = settings.use();
  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = s.theme === 'dark' || (s.theme === 'system' && media.matches);
      root.dataset.theme = dark ? 'dark' : 'light';
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', dark ? '#121314' : '#f4f1ea');
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [s.theme]);
  useEffect(() => {
    if (s.fourColor) document.documentElement.setAttribute('data-four-color', '');
    else document.documentElement.removeAttribute('data-four-color');
  }, [s.fourColor]);
}

function useOnlineErrors() {
  const net = useOnline();
  useEffect(() => {
    if (net.error && !/不存在/.test(net.error.message)) toast(net.error.message, 'error');
  }, [net.error]);
}

export function App() {
  const route = useRoute();
  const net = useOnline();
  const s = settings.use();
  const atTable =
    route.name === 'play' ||
    (route.name === 'room' &&
      route.code === net.room?.code &&
      net.room.status !== 'waiting' &&
      !!net.game);
  useEffect(() => {
    let active = true;
    void setTableLandscape(s.tableLandscape && atTable).catch(() => {
      if (active) toast('无法调整屏幕方向，请使用系统自动旋转', 'error');
    });
    return () => {
      active = false;
    };
  }, [s.tableLandscape, atTable]);
  useBackgroundMusic(
    route.name === 'play' ? route.gameId : route.name === 'room' ? net.room?.gameId : undefined,
  );
  useThemeSync();
  useOnlineErrors();
  return (
    <>
      {route.name === 'home' && <Home />}
      {route.name === 'play' && <LocalGame key={route.gameId} gameId={route.gameId} />}
      {route.name === 'room' && <OnlineRoom key={route.code} code={route.code} />}
      {route.name === 'gallery' && Gallery && (
        <Suspense fallback={null}>
          <Gallery />
        </Suspense>
      )}
      <ToastHost />
    </>
  );
}
