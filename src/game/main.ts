/* main.ts — boot. Wires every piece of the kit to a game that actually runs.

   DELETE-AS-YOU-GO: this example exists so a fresh project shows something alive
   in seconds and so every wire in the stack is proven before you write a line.
   Replace sim.ts / view.ts / cfg.ts with your game and keep the scaffolding.

   The shape to keep:
     loop.update  -> scenes.update -> sim only     (no drawing, no DOM)
     loop.render  -> scenes.render -> app.render() (no rules, no mutation)
     everything tunable                            -> cfg.ts
     everything the player chose                   -> settings
     everything worth reading later                -> log

   Scenes own BOTH halves of a screen: ctx.el for chrome, ctx.layer for board
   content. Both are destroyed on exit, so nothing leaks into the next screen.
*/

import '../kit/theme.css';
import { Application, Assets, Container, Text, type Texture } from 'pixi.js';

import * as Audio from '../kit/audio.js';
import { createCamera } from '../kit/camera.js';
import { button, meter, modal, overlay, panel, readout, stage, toast } from '../kit/chrome.js';
import { installDbg } from '../kit/dbg.js';
import { installErrorBanner } from '../kit/errors.js';
import { hubRemote } from '../kit/hubsave.js';
import { createInspector } from '../kit/inspector.js';
import { createLoop } from '../kit/loop.js';
import { createLog } from '../kit/log.js';
import { seedWord } from '../kit/rng.js';
import { createStore } from '../kit/save.js';
import { createScenes, type SceneContext } from '../kit/scenes.js';
import { createSettings } from '../kit/settings.js';

import { CFG } from './cfg.js';
import { createSim, resetSim, stats, tick, type Sim } from './sim.js';
import { createView, type View } from './view.js';

import moteUrl from '../assets/mote.png';
import pingUrl from '../assets/ping.wav';

installErrorBanner();

/* ── persistence ────────────────────────────────────────────────────────────
   version 2 with a real migration, so the mechanism is proven, not described.

   AND IT SYNCS. `remote` is what makes the save follow the PERSON rather than
   live in one browser: the hub keys it by tailnet login and profile, so this
   game picked up on a phone is the same game you left on the desktop. It is here
   from the first minute deliberately — a save that syncs is what a game IS, not
   a capability to discover and retrofit once two devices have already disagreed.
   IndexedDB stays underneath as the local copy.

   No slug argument: the project's name on the hub comes from project.mjs. A
   PROFILE argument is the real per-game decision — `hubRemote(profileFromUrl('sam'))`
   for a game with a default player. See src/kit/hubsave.ts, and the README. */
const remote = hubRemote();

const store = createStore({
  key: 'template',
  version: 2,
  remote,
  defaults: { totalLaps: 0, bestSession: 0, lastSeed: '', camera: { x: 0, y: 0, zoom: 1 } },
  migrate: {
    2: (d) => {
      if (d.laps !== undefined) { d.totalLaps = d.laps; delete d.laps; }   // v1 called it `laps`
      if (d.bestSession === undefined) d.bestSession = 0;
      return d;
    },
  },
});

let currentView: View | null = null;

const settings = createSettings({
  key: 'template',
  schema: {
    master: { type: 'range', label: 'Master volume', default: 0.7, min: 0, max: 1, step: 0.05,
              format: (v) => `${Math.round(v * 100)}%`, onChange: (v) => Audio.volume('master', v) },
    sfx:    { type: 'range', label: 'Effects', default: 0.9, min: 0, max: 1, step: 0.05,
              format: (v) => `${Math.round(v * 100)}%`, onChange: (v) => Audio.volume('sfx', v) },
    muted:  { type: 'toggle', label: 'Mute', default: false, onChange: (v) => Audio.mute(v) },
    trails: { type: 'toggle', label: 'Show trail', default: true, onChange: (v) => currentView?.setTrailVisible(v) },
  },
});

const openSettings = () =>
  modal({
    title: 'Settings',
    body: settings.panel({ title: null }),
    actions: [{ id: 'close', label: 'Close', variant: 'primary' }],
  }).show();

async function boot() {
  /* THE LOCK, made visible. Registered before load(), because load() is where
     the claim happens. Two devices on one profile do not last-write-wins: the
     second is refused and the store goes read-only, which is the right answer
     and a baffling one if the game says nothing. Say something. */
  store.on('error', (e: { reason: string; heldBy?: { device: string } }) => {
    if (e.reason === 'held-elsewhere') {
      toast(`Already open on ${e.heldBy?.device ?? 'another device'} — not saving here.`, { tone: 'warn' });
    } else if (e.reason === 'taken-over') {
      toast('Another device took over this save — not saving here any more.', { tone: 'warn' });
    }
  });

  await store.load();
  await settings.load();          // reads AND applies — volumes reach the mixer

  /* ── the board: one Pixi app for the whole game ───────────────────────── */
  const root = document.getElementById('app')!;
  const canvas = document.createElement('canvas');
  root.appendChild(canvas);
  const board = stage(canvas);
  const host = board.el;

  const app = new Application();
  await app.init({
    canvas,
    autoStart: false,            // our loop drives rendering, not Pixi's ticker
    antialias: true,
    background: 0x080b11,
    resolution: Math.min(2, window.devicePixelRatio || 1),
    autoDensity: true,
    width: host.clientWidth || 800,
    height: host.clientHeight || 600,
  });

  const texture: Texture = await Assets.load(moteUrl);
  const log = createLog({ build: import.meta.env.MODE });

  const scenes = createScenes({ root: host, stage: app.stage, transition: 'fade', ms: 180 });

  const ro = new ResizeObserver(() => {
    const w = host.clientWidth || 800, h = host.clientHeight || 600;
    app.renderer.resize(w, h);
    scenes.resize(w, h);
  });
  ro.observe(host);

  Audio.load({ ping: pingUrl }).then((r) => {
    if (!r.ok) console.warn('[game] audio missing:', r.failed);
  });

  /* ── menu ───────────────────────────────────────────────────────────────── */
  scenes.add('menu', {
    enter(ctx: SceneContext) {
      const centre = overlay('center');
      centre.append(
        Object.assign(document.createElement('h1'), {
          textContent: 'ACCRETE',
          style: 'font:600 34px/1.1 var(--kit-font);letter-spacing:.18em;margin:0;text-align:center',
        }),
        panel({
          title: null,
          children: [
            button({ label: 'Play', variant: 'primary', hotkey: 'enter', onClick: () => scenes.go('play') }),
            button({ label: 'The experiment', hotkey: 'e', onClick: () => scenes.go('compare') }),
            button({ label: 'Settings', hotkey: 's', onClick: openSettings }),
            readout({ label: 'All time', value: String(store.data.totalLaps) }),
          ],
        }),
      );
      ctx.el.append(centre);
    },
  });

  /* ── compare: the experiment, made watchable ─────────────────────────────
     Nothing HAPPENS in the ambient world — 200,000 ticks and every gene sits at
     mutation-drift balance. So the thing worth looking at is not the world, it
     is the EXPERIMENT: the derivation says a uniform environment cannot hold a
     niche, and this is that claim with a beginning and an end.

     Two worlds, same seed, same everything except how far substrate spreads.
     Each is seeded with two lineages: amber divides early and cheap, blue
     divides late and rich. Left keeps its patches, right is smoothed. Watch the
     minority hold on the left and get squeezed on the right. */
  const PATCHY = 0.002;
  const SMOOTH = 0.08;
  scenes.add('compare', () => {
    let a: Sim, b: Sim;
    let va: View, vb: View;
    let cam: ReturnType<typeof createCamera>;
    let hud: { rTick: any; mA: any; mB: any };
    let saved: Partial<typeof CFG> = {};

    /* Both sims read the same global CFG, so they cannot hold different values
       at once — they are ticked alternately with `diffuse` swapped between. Safe
       because nothing caches it across a tick, and CFG is restored on exit. */
    const withDiffuse = (d: number, fn: () => void) => { CFG.diffuse = d; fn(); };
    const minority = (sim: Sim) => {
      const n = sim.cells.length;
      if (!n) return 0;
      const early = sim.cells.filter((c) => c.genes.budThreshold < 0.7).length / n;
      return Math.min(early, 1 - early);
    };

    return {
      get sim() { return a; },
      get cam() { return cam; },

      enter(ctx: SceneContext) {
        saved = { diffuse: CFG.diffuse, mutStickiness: CFG.mutStickiness, mutRatio: CFG.mutRatio };
        CFG.mutStickiness = 0;   // mutation off: this measures competition, not drift
        CFG.mutRatio = 0;

        const seed = store.data.lastSeed || seedWord();
        const half = (CFG.fieldSize * CFG.fieldCell) / 2;
        const gap = half * 1.25;

        a = createSim(seed);
        b = createSim(seed);
        for (const sim of [a, b]) {
          sim.cells.forEach((c, i) => { c.genes.budThreshold = i % 2 ? 0.45 : 0.95; });
        }

        cam = createCamera(app, { minZoom: 0.05, maxZoom: 3 });
        ctx.layer.addChild(cam.viewport);
        cam.setZoom(0.34).moveTo(0, 0);

        const left = new Container();
        const right = new Container();
        left.x = -gap;
        right.x = gap;
        cam.viewport.addChild(left, right);
        va = createView(left, a, { colourBy: 'lineage' });
        vb = createView(right, b, { colourBy: 'lineage' });

        /* Labelled IN the world, not in the chrome: the two panels are the whole
           point of the screen and a reader should never have to work out which
           is which from a readout somewhere else. */
        const label = (parent: Container, text: string, sub: string) => {
          const t = new Text({
            text: `${text}
${sub}`,
            style: { fill: 0xdfe6ee, fontSize: 46, fontFamily: 'monospace', align: 'center', lineHeight: 58 },
          });
          t.anchor.set(0.5, 1);
          t.y = -half - 40;
          parent.addChild(t);
        };
        label(left, 'PATCHY', 'substrate stays where it is');
        label(right, 'SMOOTHED', 'substrate spreads out');

        const rTick = readout({ label: 'Tick', value: '0' });
        const mA = readout({ label: 'Patchy — minority', value: '50%' });
        const mB = readout({ label: 'Smoothed — minority', value: '50%' });
        const top = overlay('top-left', { row: true });
        top.append(rTick, mA, mB, readout({ label: 'Seed', value: seed }));

        const topRight = overlay('top-right', { row: true });
        topRight.append(button({ label: 'Back', hotkey: 'escape', onClick: () => scenes.go('menu') }));

        const note = panel({
          title: 'What you are watching',
          children: [
            Object.assign(document.createElement('p'), {
              textContent:
                'Same seed, same rules. Two lineages: amber divides early and cheap, blue divides late and rich. '
                + 'Only difference is how far substrate spreads — left keeps its patches, right is smoothed flat. '
                + 'A uniform world cannot hold a niche, so the minority should be squeezed out on the right and hold on the left.',
              style: 'margin:0;font:400 12px/1.5 var(--kit-font);opacity:.8;max-width:34ch',
            }),
          ],
        });
        const bottom = overlay('bottom-left');
        bottom.append(note);

        ctx.el.append(top, topRight, bottom);
        hud = { rTick, mA, mB };
      },

      update(dt: number) {
        withDiffuse(PATCHY, () => tick(a, dt));
        withDiffuse(SMOOTH, () => tick(b, dt));
        cam.update(dt);
      },

      render() {
        va.render();
        vb.render();
        hud.rTick.set(a.tick);
        hud.mA.set(`${(minority(a) * 100).toFixed(0)}%`);
        hud.mB.set(`${(minority(b) * 100).toFixed(0)}%`);
      },

      exit() {
        Object.assign(CFG, saved);
      },
    };
  });

  /* ── play ───────────────────────────────────────────────────────────────── */
  /* A FACTORY, not an object: it's re-invoked on every entry, so scene state
     lives in a closure and starts clean each time. No `this`, nothing to reset
     by hand, and no stale reference surviving into the next run. */
  scenes.add('play', () => {
    let sim: Sim;
    let view: View;
    let cam: ReturnType<typeof createCamera>;
    let hud: { rCells: any; rClusters: any; rLargest: any; rDeaths: any; rSticky: any; mPatch: any; mSticky: any;
      fWho: any; fAge: any; fFed: any; fStick: any; fSize: any; fPanel: any };
    /* The followed cell, kept by STABLE ID — array indices shift under death and
       compaction, so an index would silently start pointing at a stranger. */
    let followed: number | null = null;
    let followedDiedAt: number | null = null;
    let onDown: ((e: PointerEvent) => void) | null = null;
    let onUp: ((e: PointerEvent) => void) | null = null;

    return {
      // getters, so DBG.sim reaches the CURRENT scene's state
      get sim() { return sim; },
      get cam() { return cam; },

      enter(ctx: SceneContext) {
        const seed = store.data.lastSeed || seedWord();
        store.data.lastSeed = seed;
        store.save();

        sim = createSim(seed);
        log.event('run-start', { seed });

        // the camera goes INSIDE the scene layer, so layer.destroy() tears the
        // viewport down with everything else — no manual cam.destroy() needed
        cam = createCamera(app, { minZoom: 0.3, maxZoom: 5 });
        cam.fromJSON(store.data.camera);
        ctx.layer.addChild(cam.viewport);

        view = createView(cam.viewport, sim);
        view.setTrailVisible(settings.get('trails'));
        currentView = view;

        /* chrome — inside ctx.el, so it leaves when the scene does */
        const rCells = readout({ label: 'Cells', value: '0' });
        const rClusters = readout({ label: 'Clusters', value: '0' });
        const rLargest = readout({ label: 'Largest', value: '0' });
        const rDeaths = readout({ label: 'Died', value: '0' });
        const rSticky = readout({ label: 'Stickiness', value: '0.00' });
        const rSeed = readout({ label: 'Seed', value: seed });
        const topLeft = overlay('top-left', { row: true });
        topLeft.append(rCells, rClusters, rLargest, rDeaths, rSticky, rSeed);

        /* Patchiness starts at exactly zero and everything above it was made by
           the cells — so this meter is the one readout that shows a rule
           producing something nobody supplied. */
        const mPatch = meter({ label: 'Patchiness (made by them)', value: 0 });
        /* The central question, live. Seeded unicellular, this rising IS
           multicellularity evolving; it falling back to zero is the world
           answering no. */
        const mSticky = meter({ label: 'In a cluster', value: 0 });

        /* Follow one individual. "Noise is what five thousand dots look like" —
           the answer is being able to pick one out and keep hold of it, watch it
           feed, see what it is made of, and be told when it dies rather than
           having it vanish into the crowd. */
        const fWho = readout({ label: 'Following', value: '—' });
        const fAge = readout({ label: 'Age', value: '—' });
        const fFed = readout({ label: 'Reserve', value: '—' });
        const fStick = readout({ label: 'Its stickiness', value: '—' });
        const fSize = readout({ label: 'Its cluster', value: '—' });
        const fPanel = panel({ title: 'One cell', children: [fWho, fAge, fFed, fStick, fSize] });
        const side = panel({ title: null, children: [mPatch, mSticky] });
        side.style.width = '190px';
        const bottomLeft = overlay('bottom-left');
        bottomLeft.append(side, fPanel);

        /* Click to follow, drag to pan: told apart by how far the pointer moved,
           because pixi-viewport is already using the same gestures. */
        let downX = 0;
        let downY = 0;
        onDown = (e: PointerEvent) => { downX = e.offsetX; downY = e.offsetY; };
        onUp = (e: PointerEvent) => {
          if (Math.hypot(e.offsetX - downX, e.offsetY - downY) > 4) return; // a drag
          const w = cam.toWorld(e.offsetX, e.offsetY);
          followed = currentView?.pick(w.x, w.y) ?? null;
          followedDiedAt = null;
          currentView?.select(followed);
        };
        canvas.addEventListener('pointerdown', onDown);
        canvas.addEventListener('pointerup', onUp);

        const topRight = overlay('top-right', { row: true });
        topRight.append(
          button({ label: 'Pause', hotkey: 'space', onClick: () => scenes.push('pause') }),
          button({ label: 'Recentre', hotkey: 'c', onClick: () => { cam.setZoom(1).moveTo(0, 0); } }),
          button({ label: 'Playtest log', variant: 'ghost', onClick: () => toast(`Saved ${log.download()}`, { tone: 'good' }) }),
        );

        ctx.el.append(topLeft, bottomLeft, topRight);
        hud = { rCells, rClusters, rLargest, rDeaths, rSticky, mPatch, mSticky, fWho, fAge, fFed, fStick, fSize, fPanel };
      },

      update(dt: number) {
        tick(sim, dt);
        cam.update(dt);

        /* A fracture is the event this stage exists to produce, so it is the
           thing that gets logged and heard. Nothing anywhere decided it should
           happen — a bond was simply carrying more than it could hold. */
        if (sim.fracturesThisTick > 0) {
          const s = stats(sim);
          store.data.totalLaps += sim.fracturesThisTick;
          store.data.bestSession = Math.max(store.data.bestSession, s.largest);
          store.touch();
          log.event('fracture', { n: sim.fracturesThisTick, largest: s.largest, cells: s.cells, tick: sim.tick });
          Audio.sfx('ping', { volume: 0.28, rate: 0.8 + Math.min(1, s.largest / 40) * 0.6 });
        }
      },

      render() {
        view.render();
        const s = stats(sim);
        hud.rCells.set(s.cells);
        hud.rClusters.set(s.clusters);
        hud.rLargest.set(s.largest);
        hud.rDeaths.set(s.totalDeaths);
        hud.rSticky.set(s.geneStickiness.toFixed(2));
        hud.mSticky.set(s.clusteredFraction);

        const me = followed === null ? undefined : sim.cells.find((c) => c.id === followed);
        if (me) {
          hud.fWho.set(`#${me.id}`);
          hud.fAge.set(`${sim.tick - me.birthTick} ticks`);
          hud.fFed.set(`${((me.reserve / CFG.reserveMax) * 100).toFixed(0)}%`);
          hud.fStick.set(me.genes.stickiness.toFixed(2));
          hud.fSize.set(`${sim.clusterSizeOf[me.cluster] ?? 1} cell(s)`);
        } else if (followed !== null) {
          // it died: say so and keep saying so, rather than blanking silently
          if (followedDiedAt === null) followedDiedAt = sim.tick;
          hud.fWho.set(`#${followed} — starved`);
          hud.fAge.set(`at tick ${followedDiedAt}`);
          hud.fFed.set('0%');
          hud.fSize.set('—');
        } else {
          hud.fWho.set('— click one —');
        }
        // sd of a uniform-ish field tops out well under a quarter of full
        hud.mPatch.set(Math.min(1, s.fieldSd / (CFG.fieldMax * 0.25)));
      },

      /** Reachable as DBG.reset() — a known state is what makes stepping reproducible. */
      reset(seed?: string) { resetSim(sim, seed); },

      /** Reachable as DBG.follow(id). Clicking is the real interface; this is so a
          scripted capture or a test can drive it to a known cell, the same way
          reset() makes stepping reproducible. */
      follow(id: number | null) {
        followed = id;
        followedDiedAt = null;
        currentView?.select(id);
      },

      exit() {
        if (onDown) canvas.removeEventListener('pointerdown', onDown);
        if (onUp) canvas.removeEventListener('pointerup', onUp);
        onDown = onUp = null;
        store.data.camera = cam.toJSON();
        store.save();
        currentView = null;
        // view and camera live in ctx.layer; the scene destroys it for us
      },
    };
  });

  /* ── pause: PUSHED over play, so the board stays mounted behind it ──────── */
  scenes.add('pause', {
    enter(ctx: SceneContext) {
      loop.pause(true);
      const centre = overlay('center');
      centre.append(panel({
        title: 'Paused',
        children: [
          button({ label: 'Resume', variant: 'primary', hotkey: 'space', onClick: () => scenes.back() }),
          button({ label: 'Settings', onClick: openSettings }),
          button({ label: 'Quit to menu', variant: 'ghost', onClick: () => scenes.go('menu') }),
        ],
      }));
      ctx.el.append(centre);
    },
    exit() { loop.pause(false); },
  });

  /* ── the loop: one driver for sim and render ────────────────────────────── */
  const loop = createLoop({
    fixed: 1 / 60,
    update: (dt) => scenes.update(dt),
    render: (alpha) => { scenes.render(alpha); app.render(); },
  });

  /* ── dev surfaces ───────────────────────────────────────────────────────── */
  createInspector({
    cfg: CFG,
    schema: {
      orbitSpeed:  { min: 0, max: 4, step: 0.01 },
      orbitRadius: { min: 20, max: 400, step: 1 },
      trailLength: { min: 0, max: 200, step: 1 },
      wobbleRate:  { min: 0, max: 12, step: 1 },
    },
    stats: {
      fps: () => loop.stats().fps,
      ticks: () => loop.stats().ticks,
      scene: () => scenes.current ?? '—',
      laps: () => (scenes.active as any)?.sim?.laps ?? 0,
      events: () => log.entries.length,
    },
  });

  installDbg({
    loop,
    expose: {
      app, scenes, cfg: CFG, store, settings, log,
      // live getters: installDbg uses defineProperties, so these re-evaluate
      get sim() { return (scenes.active as any)?.sim ?? null; },
      get cam() { return (scenes.active as any)?.cam ?? null; },
      // so a scripted capture can drive the follow-one-cell view to a known state
      get view() { return currentView; },
      reset: (seed?: string) => (scenes.active as any)?.reset?.(seed),
      follow: (id: number | null) => (scenes.active as any)?.follow?.(id),
    },
    state: () => {
      const sim: Sim | null = (scenes.active as any)?.sim ?? null;
      return {
        scene: scenes.current,
        tick: sim?.tick ?? 0,
        t: sim ? +sim.t.toFixed(3) : 0,
        cells: sim?.cells.length ?? 0,
        clusters: sim?.clusterSizes.length ?? 0,
        largest: sim?.clusterSizes[0] ?? 0,
        fractures: sim?.totalFractures ?? 0,
        deaths: sim?.totalDeaths ?? 0,
        stickiness: sim ? +stats(sim).geneStickiness.toFixed(4) : 0,
        clustered: sim ? +stats(sim).clusteredFraction.toFixed(3) : 0,
        fieldSd: sim ? +stats(sim).fieldSd.toFixed(3) : 0,
        seed: sim?.seed ?? '',
      };
    },
  });

  store.autosave(4000);
  await scenes.go('menu', undefined, { transition: 'none' });
  loop.start();
}

boot();
