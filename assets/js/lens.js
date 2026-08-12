/* ==========================================================================
   Nexarag — the lens motif engine.

   Everything here animates ONE idea: a lens scanning a body of text and
   retrieving what matters. Eight parts:

     1. The lens cursor — a ring that accompanies the pointer. It never replaces
        it: see the note in styles.css for what that cost the light theme.
     2. The hero sequence — words "found" one by one as the lens calibrates.
     3. The retrieval scene — a pinned, scroll-driven telling of four named
        beats (ask · search · gather · answer): the lens crosses the page, each
        match stays lit, connectors are drawn to the answer column, and the
        answer arrives there. The status text and the beat list are read from
        the same beat table the animation uses, so the words on screen cannot
        drift out of step with the picture.
     4. The architecture diagram — the page's second set piece: boxes resolve
        band by band, edges draw in the order data flows, packets travel them,
        and hovering a box traces one hop out from it. Its progress is eased
        toward the scroll position, so a fling builds the diagram instead of
        teleporting it.
     5. The data-flow rail — the reader's scroll position advances the pipeline.
     6. Hero counters, and parking the orbs when the hero is off screen.
     7. The mode disclosures — six native <details> whose panels are moved into
        one shared modal <dialog> on open, paged through with prev/next, and
        moved back on close. Opening is still the element's own click behaviour;
        with scripting off the panels expand in place instead.
     8. Small echoes — a scan-flash on copy.

   The rest of the motif is declarative. Section treatments are scrubbed by
   native scroll-driven animations in the last layer of styles.css and need no
   code at all; the .reveal observer in site.js is their fallback.

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

  /* --- 1. the lens cursor ----------------------------------------------------
     Replaces the system pointer with a lens. Four states, each re-creating an
     affordance the system cursor was carrying:

       default   ring + a lag-free centre dot
       snap      over a link or button the ring morphs to that element's box
       text      over selectable copy the ring collapses to an I-beam
       scan      over the retrieval scene's document the crosshair appears

     Read the note above `.has-lens-cursor` in styles.css before changing any of
     this: an earlier version hid the system pointer and then failed to draw
     anything on the light theme, which left visitors with no pointer at all. The
     rules that prevent a repeat are (a) everything is painted in theme tokens
     with a halo of the page background, never a blend mode, and (b) `cursor:
     none` is only applied once the ring is in the DOM and positioned, and is
     withdrawn if the motion preference changes. */

  /* THE LENS STANDS DOWN FOR A MODAL, AND HANDS THE SYSTEM POINTER BACK.
   *
   * A modal <dialog> is in the browser's TOP LAYER, which paints above every
   * z-index in the document — there is no number that beats it. The ring lives in
   * <body> at z-index 999, so with the mode dialog open it was painted underneath
   * the frame while `.has-lens-cursor *` went on forcing `cursor: none` inside it.
   * Measured: ZERO cursor pixels over the frame. The reader had no pointer at all
   * over the one thing they had just opened — precisely the failure the note above
   * `.has-lens-cursor` in styles.css exists to prevent, reached by a route that
   * note did not anticipate.
   *
   * Re-parenting the ring INTO the dialog was tried first and is not the answer.
   * It does join the top layer that way, but the ring is `position: fixed` and
   * inside a top-layer element those coordinates stop resolving against the
   * viewport: measured, the ring drew 59px to the left of the actual pointer. A
   * pointer in the wrong place is worse than no pointer, because the reader trusts
   * it. Correcting the offset by hand would mean tracking the host's own box every
   * frame to compensate for a browser behaviour this file cannot pin down.
   *
   * So the lens stands down instead: the class is removed, `cursor: none` lifts,
   * and the real system pointer comes back for as long as the dialog is open. It
   * costs the motif on one surface and buys a pointer that is certainly there and
   * certainly in the right place — and the modal's buttons get their own
   * `cursor: pointer` back, which the lens had been suppressing. The ring itself is
   * hidden by `html.mmodal-open .nx-cursor` in CSS, because at z-index 999 behind a
   * 58%-opaque backdrop it was still faintly visible, glowing under the veil.
   *
   * `wasLens` matters: with a coarse pointer or reduced motion the class was never
   * added, and restoring it on close would switch the lens on for someone the
   * feature deliberately excludes. */
  var wasLens = false;

  function lensStandDown() {
    wasLens = document.documentElement.classList.contains('has-lens-cursor');
    if (wasLens) document.documentElement.classList.remove('has-lens-cursor');
  }

  function lensResume() {
    if (wasLens) document.documentElement.classList.add('has-lens-cursor');
    wasLens = false;
  }

  function initCursor() {
    if (!FINE.matches || !motionOK()) return;

    var root = document.documentElement;
    var wrap = document.createElement('div');
    wrap.className = 'nx-cursor';
    wrap.setAttribute('aria-hidden', 'true');
    wrap.innerHTML =
      '<span class="nx-cursor__ring"><i></i><i></i><i></i><i></i></span>' +
      '<span class="nx-cursor__dot"></span>';
    wrap.style.opacity = '0';
    document.body.appendChild(wrap);

    var ring = wrap.children[0];
    var dot = wrap.children[1];
    var mx = -1, my = -1, rx = 0, ry = 0;
    var snap = null;
    var raf = null;

    /* Geometry is written as three custom properties rather than as a transform,
       so the CSS owns the morph timing and this loop stays a position writer. */
    function setRingBox(w, h, r) {
      ring.style.setProperty('--ring-w', w + 'px');
      ring.style.setProperty('--ring-h', h + 'px');
      ring.style.setProperty('--ring-r', r);
    }

    function frame() {
      // Snapped, the ring parks on the element's centre; free, it trails the
      // pointer. The dot always sits exactly on the pointer.
      var tx = snap ? snap.cx : mx;
      var ty = snap ? snap.cy : my;
      var k = snap ? 0.3 : 0.16;
      rx += (tx - rx) * k;
      ry += (ty - ry) * k;
      ring.style.transform = 'translate3d(' + rx.toFixed(1) + 'px,' + ry.toFixed(1) + 'px,0)';
      dot.style.transform = 'translate3d(' + mx + 'px,' + my + 'px,0)';
      if (Math.abs(tx - rx) + Math.abs(ty - ry) > 0.15) {
        raf = requestAnimationFrame(frame);
      } else {
        raf = null;
      }
    }

    function kick() {
      if (raf === null) raf = requestAnimationFrame(frame);
    }

    document.addEventListener('mousemove', function (e) {
      if (mx < 0) {
        // First sighting: place both parts, reveal, and only now take the system
        // pointer away — so a failure before this point leaves it alone.
        rx = mx = e.clientX;
        ry = my = e.clientY;
        ring.style.transform = 'translate3d(' + rx + 'px,' + ry + 'px,0)';
        dot.style.transform = 'translate3d(' + mx + 'px,' + my + 'px,0)';
        wrap.style.opacity = '1';
        root.classList.add('has-lens-cursor');
        return;
      }
      mx = e.clientX;
      my = e.clientY;
      kick();
    }, { passive: true });

    /* State by delegation. `mouseover` fires on entering any descendant, which is
       exactly when the state might change. */
    document.addEventListener('mouseover', function (e) {
      var t = e.target;
      if (!t.closest) return;

      var hit = t.closest('a, button, [role="button"], summary, label, input, select, textarea');
      if (hit) {
        var r = hit.getBoundingClientRect();
        // Snap only to something small enough that becoming its outline still
        // reads as a cursor. A full-width block would just look like a border.
        if (r.width > 8 && r.width < 340 && r.height < 90) {
          var cs = getComputedStyle(hit);
          var radius = parseFloat(cs.borderTopLeftRadius) || 0;
          snap = { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
          setRingBox(Math.round(r.width + 14), Math.round(r.height + 12), Math.round(radius + 7) + 'px');
          root.classList.add('cur-snap');
          root.classList.remove('cur-text', 'cur-scan');
          kick();
          return;
        }
      }

      if (snap) {
        snap = null;
        root.classList.remove('cur-snap');
      }

      if (t.closest('.scene__stage, .doc, .diagram')) {
        setRingBox(64, 64, '999px');
        root.classList.add('cur-scan');
        root.classList.remove('cur-text');
        kick();
        return;
      }
      root.classList.remove('cur-scan');

      // Selectable copy. Links were handled above, so this cannot steal them.
      if (t.closest('p, h1, h2, h3, h4, li, td, th, code, pre, dd, dt, figcaption, blockquote, .cite, .mode__name')) {
        setRingBox(3, 26, '2px');
        root.classList.add('cur-text');
        kick();
        return;
      }

      root.classList.remove('cur-text');
      setRingBox(38, 38, '999px');
      kick();
    });

    document.addEventListener('mousedown', function () {
      root.classList.add('cur-press');
    }, { passive: true });
    document.addEventListener('mouseup', function () {
      root.classList.remove('cur-press');
    }, { passive: true });

    // Leaving the window: give the system pointer back, so the browser chrome and
    // anything outside the document behave normally.
    document.addEventListener('mouseleave', function () {
      wrap.style.opacity = '0';
      root.classList.remove('has-lens-cursor');
    });
    document.addEventListener('mouseenter', function () {
      wrap.style.opacity = '1';
      root.classList.add('has-lens-cursor');
    });

    // A preference that changes mid-session must not leave the pointer hidden.
    REDUCED.addEventListener('change', function () {
      if (REDUCED.matches) {
        root.classList.remove('has-lens-cursor');
        wrap.style.opacity = '0';
      }
    });

    // A touch anywhere means this is not a mouse session after all.
    window.addEventListener('touchstart', function () {
      root.classList.remove('has-lens-cursor');
      wrap.style.opacity = '0';
    }, { passive: true, once: true });
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

  /* --- 3. the retrieval scene ------------------------------------------------
     Four beats, named in the markup and lit from the scroll position:

       1 Ask     the question is on screen from the start
       2 Search  the lens crosses the page, each match staying lit behind it
       3 Gather  a connector is drawn from every match to the answer column
       4 Answer  the answer surfaces, and the whole page comes into focus

     The beat boundaries below are the single source of that story: the status
     text, the beat list, the connectors and the answer all read from them, so
     the words on screen cannot drift out of step with the animation. */

  /* Beat boundaries as a fraction of the scene's scroll. The reading time each
     beat gets is (next.at - this.at) x the scene's 280vh of travel, so these
     numbers ARE the pacing — there is no separate duration to tune.

     Rebalanced 2026-08-11: gather and answer used to hold 0.20 and 0.18, which at
     the old 300vh was 40vh and 36vh of scroll for the two beats that carry the
     point of the whole section — four connectors drawn and an answer written in
     less than a screen each. They now hold 0.26 and 0.30 of a longer scene: 73vh
     and 84vh, i.e. 1.8x and 2.3x the reading time. Search keeps its old absolute
     pace (0.40 x 280vh = 112vh, unchanged) because the sweep was never the
     problem. */
  var BEATS = [
    { at: 0,    label: 'Your question' },
    { at: 0.04, label: 'Reading your document' },
    { at: 0.44, label: 'Keeping the passages that match' },
    { at: 0.70, label: 'Answering — from those passages only' },
  ];

  /* Beat 4 has its own three-part choreography, because 0.30 of the scene spent
     watching a finished card is dead scroll: the answer arrives, then its
     citations, then the page it was read from comes into focus. */
  var ANSWER_CITES_AT = 0.08;   // after beat 4 starts
  var FINALE_AT = 0.12;         // when the lens opens out over the whole page
  var FINALE_SPAN = 0.13;

  function initScene() {
    var scene = document.getElementById('retrieve-scene');
    if (!scene) return;

    var stage = scene.querySelector('.scene__stage');
    var lens = scene.querySelector('.scene__lens');
    var hits = [].slice.call(scene.querySelectorAll('.doc__sharp .hit'));
    var dimHits = [].slice.call(scene.querySelectorAll('.doc__dim .hit'));
    var linksSvg = scene.querySelector('.scene__links');
    var answer = scene.querySelector('.scene__answer');
    var beats = [].slice.call(scene.querySelectorAll('.scene__beats li'));
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
      rBase = Math.max(78, Math.min(132, dr.width * 0.3));
      pts = hits.map(function (h) {
        var r = h.getBoundingClientRect();
        return { x: r.left - sr.left + r.width / 2, y: r.top - sr.top + r.height / 2 };
      });

      // Where the connectors land. Beside the document (the wide layout) they
      // aim at the answer card's near edge; stacked, they aim at its top. Either
      // way it is a point on something the reader can already see — the previous
      // version drew them into the corner where the card would eventually be.
      var ar = answer.getBoundingClientRect();
      ansPt = ar.left - dr.right > 8
        ? { x: ar.left - sr.left, y: ar.top - sr.top + Math.min(28, ar.height / 2) }
        : { x: ar.left - sr.left + ar.width / 2, y: ar.top - sr.top + 4 };

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

    // The still version: everything found, every beat readable. Used for reduced
    // motion, and for any viewport where pinning a two-column stage would mean
    // squeezing it — a scene the reader has to scroll *inside* explains nothing.
    function tellAsStill() {
      measure();
      scene.classList.remove('scene--live');
      if (counter) counter.textContent = hits.length + ' of ' + hits.length;
      if (status) status.textContent = 'Answered from ' + hits.length + ' passages';
      hits.forEach(function (h) { h.classList.add('lit'); });
      dimHits.forEach(function (h) { h.classList.add('lit'); });
      beats.forEach(function (b) { b.removeAttribute('data-on'); b.setAttribute('data-done', ''); });
      answer.classList.add('surfaced');
    }

    /* Both bounds are measured, not guessed: below 1000px the document and the
       answer cannot sit side by side, and below 780px of viewport the answer card
       runs past the bottom of the stage. Pinning a scene the reader has to scroll
       inside explains nothing, so those viewports get the still instead. */
    function canPin() {
      return motionOK() &&
        window.matchMedia('(min-width: 1000px)').matches &&
        window.innerHeight >= 800;
    }

    if (!canPin()) {
      // Decided once. A window that later grows keeps the still — re-arming
      // mid-session would add 300vh underneath a reader who is already past the
      // scene, and the browser clamps their scroll position to the shorter page
      // without putting it back. The still is a complete telling, not a stub.
      tellAsStill();
      onResize(measure);
      return;
    }

    scene.classList.add('scene--live');
    measure();
    if (counter) counter.textContent = '0 of ' + pts.length;

    var LEAD = BEATS[2].at; // the lens finishes its route as beat 3 begins
    var START = { fx: 0.12, fy: 0.1 };

    function lensAt(p, sw, sh) {
      // The route ends on the last match, not on the answer: the lens belongs to
      // the document, and flying it into the answer column suggested the answer
      // was somewhere on the page to be found.
      var way = [{ x: START.fx * sw, y: START.fy * sh }].concat(pts);
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

    var lit = -1, beat = -1;

    function render(p) {
      var sr = stage.getBoundingClientRect();
      var pos = lensAt(p, sr.width, sr.height);
      var finale = BEATS[3].at + FINALE_AT;
      var r = p < 0.03 ? (p / 0.03) * rBase : rBase;
      if (p > finale) {
        // The circle grows past the stage so the whole page ends up in focus —
        // "all of it was read", not "here is the bit we liked". It has to
        // *finish* inside the beat; a finale still expanding at the end of the
        // scroll leaves the reader looking at a lens-shaped hole with the answer
        // already written.
        var t = Math.min((p - finale) / FINALE_SPAN, 1);
        r = rBase + t * t * Math.hypot(sr.width, sr.height) * 1.15;
      }
      lens.style.opacity = p > finale ? '0' : '';

      stage.style.setProperty('--cx', pos.x.toFixed(1) + 'px');
      stage.style.setProperty('--cy', pos.y.toFixed(1) + 'px');
      stage.style.setProperty('--cr', r.toFixed(1) + 'px');
      lens.style.transform =
        'translate3d(' + pos.x.toFixed(1) + 'px,' + pos.y.toFixed(1) + 'px,0) translate(-50%,-50%)';

      var newLit = -1;
      for (var i = 0; i < pts.length; i++) {
        if (p >= ((i + 0.85) / pts.length) * LEAD) newLit = i;
      }
      if (newLit !== lit) {
        lit = newLit;
        for (var j = 0; j < hits.length; j++) {
          hits[j].classList.toggle('lit', j <= lit);
          if (dimHits[j]) dimHits[j].classList.toggle('lit', j <= lit);
        }
        if (counter) counter.textContent = (lit + 1) + ' of ' + pts.length;
      }

      // Beat 3: one connector per match, drawn in the order they were found.
      // One connector per match, drawn in the order they were found. Each gets its
      // own slice of beat 3 plus a little overlap, so the strokes read as a
      // sequence rather than four lines appearing together.
      var span = BEATS[3].at - BEATS[2].at;
      for (var k = 0; k < paths.length; k++) {
        var from = BEATS[2].at + (k / paths.length) * span;
        var q = clamp01((p - from) / (span / paths.length + 0.03));
        paths[k].style.strokeDashoffset = String(1 - q);
      }

      answer.classList.toggle('surfaced', p > BEATS[3].at);
      answer.classList.toggle('cited', p > BEATS[3].at + ANSWER_CITES_AT);

      var b = 0;
      for (var m = 0; m < BEATS.length; m++) if (p >= BEATS[m].at) b = m;
      if (b !== beat) {
        beat = b;
        if (status) status.textContent = BEATS[b].label;
        for (var n = 0; n < beats.length; n++) {
          if (n === b) beats[n].setAttribute('data-on', '');
          else beats[n].removeAttribute('data-on');
          if (n < b) beats[n].setAttribute('data-done', '');
          else beats[n].removeAttribute('data-done');
        }
      }
    }

    var scrub = registerScrub(
      function () {
        return sceneProgress(scene);
      },
      render
    );

    new IntersectionObserver(function (entries) {
      scrub.active = entries[0].isIntersecting;
      if (scrub.active) {
        measure();
        requestScrubFrame();
      }
    }, { rootMargin: '20% 0px 20% 0px' }).observe(scene);

    onResize(function () {
      if (!canPin()) {
        tellAsStill();
        return;
      }
      measure();
      requestScrubFrame();
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

  /* The scene's own progress curve. Two things it must do that a plain
     "how far through the pin are we" cannot:

     1. Pre-roll. A 185vh scene pins with the figure centred and --p at 0, which
        means the reader's first sight of it is an empty bordered panel the height
        of their screen. Reading as broken is worse than any build animation is
        good. So the first PRE of the beat range is spent while the section is
        still travelling up the viewport: by the time it pins, the top tier is
        already there and their scroll continues the build.

     2. Work unpinned. On a short or narrow viewport the figure does not pin at
        all, and the same function has to scrub it as it travels past. */
  var ARCH_PRE = 0.26;

  function archProgress(el) {
    var r = el.getBoundingClientRect();
    var vh = window.innerHeight;
    var span = r.height - vh;
    if (span > 40) {
      if (r.top > 0) {
        var from = vh * 0.85;
        return clamp01((from - r.top) / from) * ARCH_PRE;
      }
      return ARCH_PRE + clamp01(-r.top / span) * (1 - ARCH_PRE);
    }
    var f = vh * 0.9;
    var t = vh * 0.12;
    return clamp01((f - r.top) / (f - t));
  }

  function initArchitecture() {
    var scene = document.getElementById('architecture-scene');
    if (!scene) return;
    var svg = scene.querySelector('.diagram svg');
    var figure = scene.querySelector('.diagram');
    var head = scene.querySelector('.arch__head');
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

    // Sticky only where the figure genuinely fits. A sticky element taller than
    // its viewport does not stick — it scrolls, and all the extra height buys is
    // dead space.
    //
    // Measured WITHOUT dropping the class first. `arch--live` changes only the
    // figure's margin and a width it already had, neither of which offsetHeight
    // counts — but dropping it takes the scene's height out of the document for
    // the length of the measurement, and if the reader is below the scene the
    // browser clamps their scroll position to the shorter page and does not put
    // it back.
    function layout() {
      var avail = window.innerHeight - (header ? header.offsetHeight : 60) - 24;
      var need = figure.offsetHeight + (head ? head.offsetHeight + 12 : 0);
      scene.classList.toggle('arch--live', wide.matches && need <= avail);
    }

    /* Scrubbed motion is only as smooth as the scroll events driving it, and a
       trackpad fling or a mouse-wheel notch delivers a big jump between two
       frames — which lands on a diagram as a whole tier appearing at once, then
       nothing, then another tier. Easing the written value toward the scroll's
       value costs one rAF and turns those jumps into a build that keeps moving
       at a legible speed whether the reader creeps or flings.

       The loop parks itself as soon as it has caught up, so a still page and an
       off-screen scene both cost zero frames. */
    var target = 0;
    var cur = -1;
    var raf = null;

    function write(p) {
      // One custom property for the whole scene: the SVG's own groups and the
      // build meter in the heading all derive their state from it in CSS, so a
      // frame is a single style write however many parts the diagram grows.
      if (armed) scene.style.setProperty('--p', p.toFixed(4));
      // Packets belong to a finished graph. On a scene that was never armed
      // (already on screen at boot) the graph is finished from the start.
      var wantFlow = armed ? p > 0.82 : true;
      if (wantFlow !== flowing) {
        flowing = wantFlow;
        scene.classList.toggle('arch--flow', wantFlow);
      }
    }

    function tick() {
      raf = null;
      var d = target - cur;
      if (Math.abs(d) < 0.0012) {
        cur = target;
        write(cur);
        return;
      }
      cur += d * 0.22;
      write(cur);
      raf = requestAnimationFrame(tick);
    }

    function toward(p) {
      target = p;
      if (raf === null) raf = requestAnimationFrame(tick);
    }

    var scrub = registerScrub(
      function () {
        return archProgress(scene);
      },
      toward
    );

    layout();
    if (belowTheFold(scene)) {
      armed = true;
      scene.classList.add('arch--armed');
      // Write the starting beat with the class, not on the first scroll. Armed
      // but unwritten, --p keeps its resting 1 and the diagram sits fully drawn
      // until something scrolls — which would then snap it back to empty.
      cur = archProgress(scene);
      target = cur;
      write(cur);
    }

    new IntersectionObserver(function (entries) {
      scrub.active = entries[0].isIntersecting;
      if (scrub.active) {
        layout();
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

  /* --- 7. the mode disclosures -----------------------------------------------
     Six retrieval modes; each one's detail panel opens in a modal dialog.

     WHY THE MARKUP IS STILL <details>

     Because it has to work with scripting off, and because a mode's panel is the
     only place the site explains what the mode actually does. A <button> that
     opens a dialog is the correct control — but with no JavaScript it is a control
     that does nothing at all, which is strictly worse than a disclosure that
     expands in place. So the markup stays a native disclosure and this function
     upgrades it. Both paths are live: the inline panel CSS is what a no-JS reader
     gets, and `html.nx-js` is what gates it off.

     WHY THE PANEL IS MOVED AND NOT CLONED

     One dialog serves all six. On open, that mode's `.mode__panel` element is
     moved into the dialog body; on close it goes back to its <details>. Cloning
     would put a second copy of six flowcharts and six step lists in the document
     for find-in-page and a screen reader to walk through, and would need the two
     copies kept in sync for no benefit.

     WHY THE <details> IS ALLOWED TO OPEN AT ALL

     It would be less code to swallow the summary's click and just open the
     dialog. But <summary> has an implicit role of button with aria-expanded, and
     a control that reports itself collapsed forever while opening something
     somewhere else is a lie told to exactly the users who cannot see where the
     content went. Letting it open keeps aria-expanded true for as long as the
     panel is on screen — which is what is actually happening — and
     `aria-haspopup="dialog"`, set below, is what says where. */


  function initModes() {
    var list = document.querySelector('.modes');
    if (!list) return;
    var modes = [].slice.call(list.querySelectorAll('details.mode'));
    if (!modes.length) return;

    var dialog = document.getElementById('mode-dialog');
    /* No <dialog> support means no modal — and that is a complete outcome, not a
       degraded one: the accordion below is the pre-modal behaviour, and it is the
       same code path a no-JS reader gets. Nothing needs polyfilling. */
    var modal = dialog && typeof dialog.showModal === 'function' ? buildModal(dialog, modes) : null;

    modes.forEach(function (mode) {
      var summary = mode.querySelector('summary');
      if (modal && summary) summary.setAttribute('aria-haspopup', 'dialog');

      /* `toggle` rather than `click`, because it also fires for keyboard
         activation and for the programmatic closes below — a click listener would
         miss both. Closing the others re-enters this handler for each of them,
         which is why it returns immediately unless it is the panel that just
         OPENED. */
      mode.addEventListener('toggle', function () {
        if (!mode.open) return;
        modes.forEach(function (other) {
          if (other !== mode) other.open = false;
        });
        if (modal) modal.open(mode);
      });
    });

    // Escape inside the dialog is the dialog's own; this is the accordion's, for
    // the no-modal path. Returning focus to the summary is what a keyboard user
    // expects from a disclosure they just opened.
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' || (modal && modal.isOpen())) return;
      var open = modes.filter(function (m) { return m.open; });
      if (!open.length) return;
      open.forEach(function (m) { m.open = false; });
      var summary = open[0].querySelector('summary');
      if (summary) summary.focus();
    });
  }

  /* The dialog. Everything hard about a modal — the focus trap, Escape, making
     the rest of the page inert, and sitting above every stacking context on the
     page — is showModal()'s job and is not reimplemented here. What is left is
     four things it does not do: move the panel in and out, fill the header from
     the card so the two are visibly the same object, step between modes, and lock
     the document scroll that showModal leaves running behind the backdrop. */
  function buildModal(dialog, modes) {
    var host = dialog.querySelector('.mmodal__body');
    var nameEl = dialog.querySelector('#mode-dialog-name');
    var gistEl = dialog.querySelector('.mmodal__gist');
    var countEl = dialog.querySelector('.mmodal__count');
    var closeBtn = dialog.querySelector('.mmodal__close');
    var steps = [].slice.call(dialog.querySelectorAll('.mmodal__step'));
    var current = null;

    function label(mode) {
      var el = mode.querySelector('.mode__name');
      return el ? el.textContent.trim() : '';
    }

    function show(mode) {
      // Put the outgoing panel back where it came from BEFORE taking the next
      // one, so the two can never both be detached and there is no window in
      // which a panel exists in neither place.
      release();
      current = mode;
      var panel = mode.querySelector('.mode__panel');
      if (panel) host.appendChild(panel);

      nameEl.textContent = label(mode);
      var gist = mode.querySelector('.mode__gist');
      gistEl.textContent = gist ? gist.textContent.trim() : '';

      var i = modes.indexOf(mode);
      countEl.textContent = i + 1 + ' / ' + modes.length;
      steps.forEach(function (btn) {
        var dir = parseInt(btn.getAttribute('data-dir'), 10);
        var span = btn.querySelector('span');
        // Wraps rather than disabling at the ends. Six modes is a ring you page
        // through to compare them; a dead button at each end turns the last one
        // into a cul-de-sac.
        if (span) span.textContent = label(modes[(i + dir + modes.length) % modes.length]);
      });

      host.scrollTop = 0;
    }

    function release() {
      if (!current) return;
      var panel = host.querySelector('.mode__panel');
      if (panel) current.appendChild(panel);
      current = null;
    }

    function step(dir) {
      if (!current) return;
      var next = modes[(modes.indexOf(current) + dir + modes.length) % modes.length];
      // Through `open`, not through show(), so the card the reader eventually
      // closes back to is the one the dialog is actually showing — the accordion
      // handler is the single place that decides which <details> is open.
      next.open = true;
    }

    dialog.addEventListener('close', function () {
      var last = current;
      release();
      lensResume();
      document.documentElement.classList.remove('mmodal-open');
      modes.forEach(function (m) { m.open = false; });
      // Deliberately after showModal's own focus restore, which returns focus to
      // whatever opened the dialog — three steps later that is the wrong card, and
      // landing on the wrong one is how a keyboard reader loses their place.
      var summary = last && last.querySelector('summary');
      if (summary) summary.focus();
    });

    // A click that lands on the dialog element itself landed on the backdrop:
    // the frame inside it covers every pixel the reader would call "the dialog".
    dialog.addEventListener('click', function (e) {
      if (e.target === dialog) dialog.close();
    });

    if (closeBtn) closeBtn.addEventListener('click', function () { dialog.close(); });

    steps.forEach(function (btn) {
      btn.addEventListener('click', function () {
        step(parseInt(btn.getAttribute('data-dir'), 10));
      });
    });

    // Left/right page through the modes. Guarded on the dialog being open so the
    // listener cannot act on arrow keys pressed anywhere else on the page.
    dialog.addEventListener('keydown', function (e) {
      if (!dialog.open) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    });

    return {
      isOpen: function () { return dialog.open; },
      open: function (mode) {
        show(mode);
        if (dialog.open) return;
        document.documentElement.classList.add('mmodal-open');
        dialog.showModal();
        lensStandDown();
      },
    };
  }

  /* --- 6. hero counters and the orb idle switch ------------------------------ */

  /* The four numbers under the hero are the page's claim; counting them up is
     the one entrance animation worth keeping here, because it draws the eye to
     the figures rather than to the motion. Runs once, on first sight. */
  function initFacts() {
    var values = [].slice.call(document.querySelectorAll('.fact__value'));
    if (!values.length || !motionOK() || !('IntersectionObserver' in window)) return;

    function run(el) {
      var text = el.textContent.trim();
      // "1,650+" → 1650 counted, "+" kept, thousands separator restored on the
      // way out. Anything that does not start with a number is left alone.
      var parts = /^([\d,]+)(.*)$/.exec(text);
      if (!parts) return;
      var target = parseInt(parts[1].replace(/,/g, ''), 10);
      var suffix = parts[2];
      var grouped = parts[1].indexOf(',') > -1;
      var start = null;
      var DUR = 900;

      function step(now) {
        if (start === null) start = now;
        var t = Math.min((now - start) / DUR, 1);
        var eased = 1 - Math.pow(1 - t, 3);
        var n = Math.round(target * eased);
        el.textContent = (grouped ? n.toLocaleString('en-US') : String(n)) + suffix;
        if (t < 1) requestAnimationFrame(step);
      }

      el.textContent = '0' + suffix;
      requestAnimationFrame(step);
    }

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        observer.unobserve(entry.target);
        run(entry.target);
      });
    }, { threshold: 0.6 });

    values.forEach(function (el) {
      observer.observe(el);
    });
  }

  /* Where scroll timelines are missing, the orbs still drift on an infinite
     loop; two blurred 26rem surfaces being recomposited behind a page nobody is
     looking at is the kind of cost that shows up as scroll jank three sections
     later. Parked whenever the hero is off screen. (With scroll timelines the
     CSS keeps them running — there is nothing to park.) */
  function initHeroIdle() {
    var hero = document.querySelector('.hero');
    if (!hero || !('IntersectionObserver' in window)) return;

    new IntersectionObserver(function (entries) {
      document.documentElement.classList.toggle('hero-idle', !entries[0].isIntersecting);
    }, { rootMargin: '10% 0px 10% 0px' }).observe(hero);
  }

  /* --- 8. echoes ------------------------------------------------------------ */

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
    initFacts();
    initHeroIdle();
    initModes();
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
