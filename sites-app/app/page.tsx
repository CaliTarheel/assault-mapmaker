export default function Home() {
  return (
    <main className="app-shell">
      <div className="loading-state" aria-hidden="true">
        <div className="loading-mark">
          <span />
          <span />
          <span />
        </div>
        <p>Loading terrain workspace</p>
      </div>
      <iframe
        className="mapmaker-frame"
        src="/mapmaker/index.html"
        title="Assault Map Maker — interactive terrain board generator"
        allow="fullscreen"
      />
      <noscript>
        <p className="no-script">
          Assault Map Maker requires JavaScript to render terrain boards.
        </p>
      </noscript>
    </main>
  );
}
