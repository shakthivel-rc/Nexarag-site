/* ==========================================================================
   Nexarag — the lens motif engine.

   Everything here animates ONE idea: a lens scanning a body of text and
   retrieving what matters. Six parts:

     1. A custom cursor — the lens you carry around the page.
     2. The hero sequence — words "found" one by one as the lens calibrates.
     3. The retrieval scene — a sticky, scroll-driven sweep across a document
        wall: terms illuminate as the lens passes, connectors draw between
        matches, and the answer surfaces once the evidence exists.
     4. The architecture diagram — the page's second set piece: boxes resolve
        band by band, edges draw in the order data flows, packets travel them,
        and hovering a box traces one hop out from it.
     5. The data-flow rail — the reader's scroll position advances the pipeline.
     6. Small echoes — a scan-flash on copy.

   The rest of the motif is declarative: the section treatments in the lens
   layer of styles.css ride the .reveal observer in site.js and need no code.

   Performance rules, enforced throughout: continuous animation writes ONLY
   transform/opacity/CSS-variables; geometry is measured on resize, never in
   the frame loop (one bounding-rect read per scroll frame, batched by rAF);
   the scene's loop runs only while the scene is on screen.

   Accessibility rules: prefers-reduced-motion (or no JS) gets every scene at
   its FINAL state — everything found, everything drawn, nothing moving. The
   custom cursor exists only for fine pointers with motion enabled.
   ========================================================================== */
(function () {
  'use strict';

  var REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)');
  var FINE = window.matchMedia('(pointer: fine)');

  function motionOK() {
    return !REDUCED.matches;
  }

  /* --- 1. cursor ----------------------------------------------------------- */

  function initCursor() {
    if (!FINE.matches || !motionOK()) return;

    var root = document.documentElement;
    var wrap = document.createElement('div');
    wrap.className = 'nx-cursor';
    wrap.setAttribute('aria-hidden', 'true');
    wrap.innerHTML =
      '<span class="nx-cursor__ring"><i></i><i></i><i></i><i></i></span>' +
      '<span class="nx-cursor__dot"></span>';
    document.body.appendChild(wrap);
    root.classList.add('has-lens-cursor');

    var ring = wrap.children[0];
    var dot = wrap.children[1];
    var mx = -100, my = -100, rx = -100, ry = -100, dx = -100, dy = -100;
    var raf = null;

    // The ring trails the pointer (low lerp factor = the fluid "heavy glass"
    // feel), the dot stays tight. The loop parks itself once both settle, so
    // an idle pointer costs zero frames.
    function frame() {
      rx += (mx - rx) * 0.16;
      ry += (my - ry) * 0.16;
      dx += (mx - dx) * 0.55;
      dy += (my - dy) * 0.55;
      ring.style.transform = 'translate3d(' + rx + 'px,' + ry + 'px,0)';
      dot.style.transform = 'translate3d(' + dx + 'px,' + dy + 'px,0)';
      if (Math.abs(mx - rx) + Math.abs(my - ry) > 0.15) {
        raf = requestAnimationFrame(frame);
      } else {
        raf = null;
      }
    }

    document.addEventListener('mousemove', function (e) {
      mx = e.clientX;
      my = e.clientY;
      if (raf === null) raf = requestAnimationFrame(frame);
    }, { passive: true });

    // Engage states by delegation: over anything interactive the ring snaps
    // into a viewfinder bracket; over the retrieval scene it widens to scan.
    document.addEventListener('mouseover', function (e) {
      var t = e.target;
      root.classList.toggle('cur-engage', !!(t.closest && t.closest('a, button, [role="button"]')));
      root.classList.toggle('cur-scan', !!(t.closest && t.closest('.scene__stage, .doc')));
    });

    document.addEventListener('mouseleave', function () {
      wrap.style.opacity = '0';
    });
    document.addEventListener('mouseenter', function () {
      wrap.style.opacity = '1';
    });
  }

  /* --- 2. hero sequence ----------------------------------------------------- */

  function initHero() {
    if (!document.querySelector('.hero')) return;
    if (!motionOK()) return;
    // Double-rAF so the armed (hidden) state paints before the play state
    // starts transitions — without it the whole sequence resolves instantly.
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        document.documentElement.classList.add('lens-play');
      });
    });
  }

  /* --- 3. the retrieval scene ------------------------------------------------ */

  function initScene() {
    var scene = document.getElementById('retrieve-scene');
    if (!scene) return;

    var stage = scene.querySelector('.scene__stage');
    var lens = scene.querySelector('.scene__lens');
    var hits = [].slice.call(scene.querySelectorAll('.doc__sharp .hit'));
    var dimHits = [].slice.call(scene.querySelectorAll('.doc__dim .hit'));
    var linksSvg = scene.querySelector('.scene__links');
    var answer = scene.querySelector('.scene__answer');
    var counter = scene.querySelector('[data-scene-count]');
    var status = scene.querySelector('[data-scene-status]');
    if (!stage || !lens || !hits.length || !answer) return;

    var pts = [], paths = [], ansPt = null, rBase = 130;

    function measure() {
      var sr = stage.getBoundingClientRect();
      var doc = scene.querySelector('.doc__sharp');
      var dr = doc.getBoundingClientRect();
      stage.style.setProperty('--dox', (dr.left - sr.left).toFixed(1) + 'px');
      stage.style.setProperty('--doy', (dr.top - sr.top).toFixed(1) + 'px');
      rBase = Math.max(80, Math.min(140, sr.width * 0.2));
      pts = hits.map(function (h) {
        var r = h.getBoundingClientRect();
        return { x: r.left - sr.left + r.width / 2, y: r.top - sr.top + r.height / 2 };
      });
      var ar = answer.getBoundingClientRect();
      ansPt = { x: ar.left - sr.left + ar.width / 2, y: ar.top - sr.top + 6 };

      // Connectors are rebuilt from the REAL positions of the matched terms,
      // so the drawing always lands on the words — at any viewport width.
      while (linksSvg.firstChild) linksSvg.removeChild(linksSvg.firstChild);
      linksSvg.setAttribute('viewBox', '0 0 ' + sr.width + ' ' + sr.height);
      paths = pts.map(function (a) {
        var b = ansPt;
        // A gentle arc: control point at the midpoint, pushed perpendicular to
        // the segment by a distance proportional to its length but capped low.
        // Big loops read as scribble and cross intervening text; a shallow bow
        // reads as a drawn connection.
        var vx = b.x - a.x, vy = b.y - a.y;
        var len = Math.sqrt(vx * vx + vy * vy) || 1;
        var bow = Math.min(22, len * 0.12);
        var cx = (a.x + b.x) / 2 - (vy / len) * bow;
        var cy = (a.y + b.y) / 2 + (vx / len) * bow;
        var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        p.setAttribute('d', 'M' + a.x + ' ' + a.y + ' Q' + cx + ' ' + cy + ' ' + b.x + ' ' + b.y);
        p.setAttribute('pathLength', '1');
        p.setAttribute('class', 'scene__link');
        linksSvg.appendChild(p);
        return p;
      });
    }

    // Reduced motion: measure once so the connectors exist, then jump the
    // whole scene to its found state. The story is still told — as a still.
    if (!motionOK()) {
      measure();
      scene.classList.add('scene--done');
      if (counter) counter.textContent = hits.length + '/' + hits.length;
      if (status) status.textContent = 'GROUNDED';
      return;
    }

    scene.classList.add('scene--live');
    measure();
    if (counter) counter.textContent = '0/' + pts.length;

    var LEAD = 0.74; // the lens completes its route at 74% scroll; the rest is the answer
    var START = { fx: 0.1, fy: 0.08 };

    function lensAt(p, sw, sh) {
      var way = [{ x: START.fx * sw, y: START.fy * sh }].concat(pts).concat([ansPt]);
      var segs = way.length - 1;
      var t = Math.min(p / LEAD, 1) * segs;
      var i = Math.min(Math.floor(t), segs - 1);
      var f = t - i;
      // Smoothstep per segment: the lens decelerates INTO each match and
      // dwells for a beat — finding, not flying past.
      f = f * f * (3 - 2 * f);
      return {
        x: way[i].x + (way[i + 1].x - way[i].x) * f,
        y: way[i].y + (way[i + 1].y - way[i].y) * f,
      };
    }

    var lit = -1, phase = '';

    function render(p) {
      var sr = stage.getBoundingClientRect();
      var pos = lensAt(p, sr.width, sr.height);
      var r = p < 0.04 ? (p / 0.04) * rBase : rBase;
      if (p > 0.84) {
        var t = (p - 0.84) / 0.16;
        r = rBase + t * t * Math.hypot(sr.width, sr.height);
      }
      lens.style.opacity = p > 0.84 ? '0' : '';

      stage.style.setProperty('--cx', pos.x.toFixed(1) + 'px');
      stage.style.setProperty('--cy', pos.y.toFixed(1) + 'px');
      stage.style.setProperty('--cr', r.toFixed(1) + 'px');
      lens.style.transform =
        'translate3d(' + pos.x.toFixed(1) + 'px,' + pos.y.toFixed(1) + 'px,0) translate(-50%,-50%)';

      var segs = pts.length + 1;
      var newLit = -1;
      for (var i = 0; i < pts.length; i++) {
        if (p >= ((i + 1) / segs) * LEAD - 0.01) newLit = i;
      }
      if (newLit !== lit) {
        lit = newLit;
        for (var j = 0; j < hits.length; j++) {
          hits[j].classList.toggle('lit', j <= lit);
          if (dimHits[j]) dimHits[j].classList.toggle('lit', j <= lit);
        }
        if (counter) counter.textContent = (lit + 1) + '/' + pts.length;
      }

      for (var k = 0; k < paths.length; k++) {
        var start = ((k + 1) / segs) * LEAD;
        var q = Math.max(0, Math.min(1, (p - start) / 0.09));
        paths[k].style.strokeDashoffset = String(1 - q);
      }

      answer.classList.toggle('surfaced', p > 0.8);

      var ph = p < 0.05 ? 'CALIBRATING' : p < 0.72 ? 'SCANNING' : p < 0.8 ? 'COMPOSING' : 'GROUNDED';
      if (ph !== phase) {
        phase = ph;
        if (status) status.textContent = ph;
      }
    }

    var active = false, ticking = false;

    function onScroll() {
      if (!active || ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        ticking = false;
        var r = scene.getBoundingClientRect();
        var total = r.height - window.innerHeight;
        var p = Math.max(0, Math.min(1, -r.top / (total <= 0 ? 1 : total)));
        render(p);
      });
    }

    // The loop exists only while the scene is on screen.
    new IntersectionObserver(function (entries) {
      active = entries[0].isIntersecting;
      if (active) {
        measure();
        onScroll();
      }
    }, { rootMargin: '20% 0px 20% 0px' }).observe(scene);

    window.addEventListener('scroll', onScroll, { passive: true });

    var resizeTimer;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        measure();
        onScroll();
      }, 150);
    });
  }

  /* --- 4. shared scrub plumbing ---------------------------------------------
     One scroll listener and one rAF for every scroll-scrubbed scene, split into
     a read pass and a write pass. Two scenes each doing read-then-write in turn
     would make the second one's measurement land after the first one's style
     write — a forced synchronous layout, once per scene, every frame. Reading
     everything first costs nothing and removes the whole class of problem. */

  var scrubs = [];
  var scrubQueued = false;

  function runScrubFrame() {
    scrubQueued = false;
    var i, reads = [];
    for (i = 0; i < scrubs.length; i++) {
      reads[i] = scrubs[i].active ? scrubs[i].read() : null;
    }
    for (i = 0; i < scrubs.length; i++) {
      if (reads[i] !== null) scrubs[i].write(reads[i]);
    }
  }

  function requestScrubFrame() {
    if (scrubQueued) return;
    scrubQueued = true;
    requestAnimationFrame(runScrubFrame);
  }

  function registerScrub(read, write) {
    var scrub = { read: read, write: write, active: false };
    scrubs.push(scrub);
    if (scrubs.length === 1) {
      window.addEventListener('scroll', requestScrubFrame, { passive: true });
    }
    return scrub;
  }

  function clamp01(v) {
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }

  /* A scene's progress through the viewport, 0 → 1. A scene taller than the
     viewport (the sticky case) scrubs across its own overflow; a shorter one
     scrubs as it travels past. One function, so a scene that loses its sticky
     treatment on a short viewport still animates rather than falling dead. */
  function sceneProgress(el) {
    var r = el.getBoundingClientRect();
    var vh = window.innerHeight;
    var span = r.height - vh;
    if (span > 40) return clamp01(-r.top / span);
    var from = vh * 0.9;
    var to = vh * 0.15;
    return clamp01((from - r.top) / (from - to));
  }

  function onResize(fn) {
    var timer;
    window.addEventListener('resize', function () {
      clearTimeout(timer);
      timer = setTimeout(fn, 150);
    }, { passive: true });
  }

  /* Anything already on screen when the script boots is left at its resting
     (final) state — arming it would paint a flash of hidden content. */
  function belowTheFold(el) {
    return el.getBoundingClientRect().top > window.innerHeight * 0.85;
  }

  /* --- 5. the architecture diagram ------------------------------------------
     The page's second set piece. Boxes resolve band by band in pipeline order,
     each edge draws only once its source box exists, and the finished graph
     carries travelling packets so direction is visible and not just topology.

     Every beat is declared in the markup as a --t0 on the group and derived in
     CSS from a single --p. The scroll handler therefore writes exactly one
     property per frame however many parts the diagram grows. */

  function initTrace(svg) {
    var nodes = [].slice.call(svg.querySelectorAll('.d-node'));
    var flows = [].slice.call(svg.querySelectorAll('.d-flow'));
    if (!nodes.length || !flows.length) return;

    var current = null;

    // One hop out from the box under the pointer: the box, every edge touching
    // it, and whatever sits at the other end. Which is, more or less, what the
    // product does to a question.
    function trace(id) {
      if (id === current) return;
      current = id;

      if (!id) {
        svg.removeAttribute('data-trace');
        nodes.forEach(function (n) { n.removeAttribute('data-on'); });
        flows.forEach(function (f) { f.removeAttribute('data-on'); });
        return;
      }

      var reached = {};
      reached[id] = true;
      flows.forEach(function (f) {
        var a = f.getAttribute('data-from');
        var b = f.getAttribute('data-to');
        if (a === id || b === id) {
          reached[a] = true;
          reached[b] = true;
          f.setAttribute('data-on', '');
        } else {
          f.removeAttribute('data-on');
        }
      });
      nodes.forEach(function (n) {
        if (reached[n.getAttribute('data-node')]) n.setAttribute('data-on', '');
        else n.removeAttribute('data-on');
      });
      svg.setAttribute('data-trace', id);
    }

    svg.addEventListener('mouseover', function (e) {
      var box = e.target.closest ? e.target.closest('.d-node') : null;
      trace(box ? box.getAttribute('data-node') : null);
    });
    svg.addEventListener('mouseleave', function () {
      trace(null);
    });
  }

  function initArchitecture() {
    var scene = document.getElementById('architecture-scene');
    if (!scene) return;
    var svg = scene.querySelector('.diagram svg');
    var figure = scene.querySelector('.diagram');
    if (!svg || !figure) return;

    // Tracing is information, not decoration — it stays available under reduced
    // motion, where the opacity changes simply land instantly.
    initTrace(svg);

    // Reduced motion: the CSS resting state already IS the final state — every
    // box present, every edge drawn — and nothing below runs, so the scene never
    // claims the extra scroll height either.
    if (!motionOK()) return;

    var header = document.querySelector('.site-header');
    var wide = window.matchMedia('(min-width: 1024px)');
    var armed = false;
    var flowing = false;
    var lastP = -1;

    // Sticky only where the figure genuinely fits. A sticky element taller than
    // its viewport does not stick — it scrolls, and all the extra height buys is
    // dead space.
    //
    // Measured WITHOUT dropping the class first. `arch--live` changes only the
    // figure's margin and a width it already had, neither of which offsetHeight
    // counts — but dropping it takes 130vh out of the document for the length of
    // the measurement, and if the reader is below the scene the browser clamps
    // their scroll position to the shorter page and does not put it back.
    function layout() {
      var avail = window.innerHeight - (header ? header.offsetHeight : 60) - 24;
      scene.classList.toggle('arch--live', wide.matches && figure.offsetHeight <= avail);
    }

    var scrub = registerScrub(
      function () {
        return sceneProgress(scene);
      },
      function (p) {
        if (Math.abs(p - lastP) < 0.0008) return;
        lastP = p;
        if (armed) svg.style.setProperty('--p', p.toFixed(4));
        // Packets belong to a finished graph. On a scene that was never armed
        // (already on screen at boot) the graph is finished from the start.
        var wantFlow = armed ? p > 0.8 : true;
        if (wantFlow !== flowing) {
          flowing = wantFlow;
          scene.classList.toggle('arch--flow', wantFlow);
        }
      }
    );

    layout();
    if (belowTheFold(scene)) {
      armed = true;
      scene.classList.add('arch--armed');
      // Write the starting beat with the class, not on the first scroll. Armed
      // but unwritten, --p keeps its resting 1 and the diagram sits fully drawn
      // until something scrolls — which would then snap it back to empty.
      svg.style.setProperty('--p', sceneProgress(scene).toFixed(4));
    }

    new IntersectionObserver(function (entries) {
      scrub.active = entries[0].isIntersecting;
      if (scrub.active) {
        layout();
        lastP = -1;
        requestScrubFrame();
      } else if (flowing) {
        // Off screen the packet animation is stopped outright, not merely
        // invisible: an infinite animation nobody can see is still work.
        flowing = false;
        scene.classList.remove('arch--flow');
      }
    }, { rootMargin: '20% 0px 20% 0px' }).observe(scene);

    onResize(function () {
      layout();
      lastP = -1;
      requestScrubFrame();
    });
  }

  /* --- 6. the data-flow rail -------------------------------------------------
     The reader's scroll position drives the pipeline: the rail fills as they
     descend it, and the step level with the reading line is the live one. */

  function initSteps() {
    var list = document.getElementById('data-flow-steps');
    if (!list || !motionOK()) return;

    var steps = [].slice.call(list.querySelectorAll('.step'));
    var badges = [];
    for (var i = 0; i < steps.length; i++) {
      var badge = steps[i].querySelector('.step__badge');
      if (!badge) return;
      badges.push(badge);
    }
    if (steps.length < 2) return;
    if (!belowTheFold(list)) return;

    var offsets = [];

    // Badge centres in list space. Measured on entry and on resize — never in a
    // scroll frame, where the reads would interleave with the writes.
    function measure() {
      var lr = list.getBoundingClientRect();
      offsets = badges.map(function (b) {
        var r = b.getBoundingClientRect();
        return r.top - lr.top + r.height / 2;
      });
    }

    var lastFill = -1;
    var lastIndex = -2;

    var scrub = registerScrub(
      function () {
        return list.getBoundingClientRect().top;
      },
      function (top) {
        if (offsets.length < 2) return;
        var line = window.innerHeight * 0.42 - top;
        var first = offsets[0];
        var last = offsets[offsets.length - 1];
        var fill = clamp01((line - first) / ((last - first) || 1));

        if (Math.abs(fill - lastFill) > 0.001) {
          lastFill = fill;
          list.style.setProperty('--fill', fill.toFixed(4));
        }

        var index = -1;
        for (var j = 0; j < offsets.length; j++) {
          if (line >= offsets[j] - 6) index = j;
        }
        if (index !== lastIndex) {
          lastIndex = index;
          for (var k = 0; k < steps.length; k++) {
            if (k === index) steps[k].setAttribute('data-active', '');
            else steps[k].removeAttribute('data-active');
          }
        }
      }
    );

    list.classList.add('steps--armed');
    list.style.setProperty('--fill', '0');

    // Transitions come one paint later, so arming lands instantly and only the
    // reader's own progress is ever animated.
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        list.classList.add('steps--motion');
      });
    });

    new IntersectionObserver(function (entries) {
      scrub.active = entries[0].isIntersecting;
      if (scrub.active) {
        measure();
        lastFill = -1;
        requestScrubFrame();
      }
    }, { rootMargin: '20% 0px 20% 0px' }).observe(list);

    onResize(function () {
      measure();
      lastFill = -1;
      requestScrubFrame();
    });
  }

  /* --- 7. echoes ------------------------------------------------------------ */

  function initEchoes() {
    // A copy is an acquisition: flash the block's frame once.
    document.addEventListener('click', function (e) {
      var btn = e.target.closest && e.target.closest('.copy-btn');
      if (!btn || !motionOK()) return;
      var block = btn.closest('.code-block');
      if (!block) return;
      block.classList.remove('scan-flash');
      // Force a reflow so a second copy replays the animation.
      void block.offsetWidth;
      block.classList.add('scan-flash');
    });
  }

  /* --- boot ----------------------------------------------------------------- */

  function boot() {
    initCursor();
    initHero();
    initScene();
    initArchitecture();
    initSteps();
    initEchoes();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
