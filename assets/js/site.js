/* ==========================================================================
   Nexarag site behaviour — theme, navigation, scroll-spy, copy, highlighting.

   No dependencies and no network requests: the site is meant to work from a
   file:// checkout and from GitHub Pages identically, and a CDN script is one
   more thing that can be blocked, rate-limited or version-drifted.
   Everything here is progressive enhancement — the page reads fine without it.
   ========================================================================== */
(function () {
  'use strict';

  /* --- theme -------------------------------------------------------------- */

  var STORAGE_KEY = 'nexarag-theme';

  function resolvedTheme() {
    var explicit = document.documentElement.getAttribute('data-theme');
    if (explicit === 'light' || explicit === 'dark') return explicit;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function initTheme() {
    var toggle = document.querySelector('.theme-toggle');
    if (!toggle) return;

    function syncLabel() {
      var next = resolvedTheme() === 'dark' ? 'light' : 'dark';
      toggle.setAttribute('aria-label', 'Switch to ' + next + ' theme');
      toggle.setAttribute('title', 'Switch to ' + next + ' theme');
    }

    toggle.addEventListener('click', function () {
      var next = resolvedTheme() === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch (err) {
        /* Private mode or blocked storage: the theme still applies for this
           page view, it just will not be remembered. Not worth failing over. */
      }
      syncLabel();
    });

    // Someone who never chose a theme should follow the OS when it changes.
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
      if (!document.documentElement.hasAttribute('data-theme')) syncLabel();
    });

    syncLabel();
  }

  /* --- mobile navigation -------------------------------------------------- */

  function initNav() {
    var toggle = document.querySelector('.nav-toggle');
    var sidebar = document.getElementById('sidebar');
    var scrim = document.querySelector('.scrim');
    if (!toggle || !sidebar || !scrim) return;

    function setOpen(open) {
      sidebar.setAttribute('data-open', open ? 'true' : 'false');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      scrim.hidden = !open;
      // Locking the body is what stops the page behind the drawer scrolling
      // under the reader's finger on a touch screen.
      document.body.style.overflow = open ? 'hidden' : '';
      if (open) sidebar.focus();
    }

    toggle.addEventListener('click', function () {
      setOpen(sidebar.getAttribute('data-open') !== 'true');
    });

    scrim.addEventListener('click', function () {
      setOpen(false);
      toggle.focus();
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && sidebar.getAttribute('data-open') === 'true') {
        setOpen(false);
        toggle.focus();
      }
    });

    // Following a link inside the drawer should reveal the target, not leave the
    // drawer covering it.
    sidebar.addEventListener('click', function (event) {
      if (event.target.closest('a') && window.matchMedia('(max-width: 1023px)').matches) {
        setOpen(false);
      }
    });
  }

  /* --- scroll-spy --------------------------------------------------------- */

  function initScrollSpy() {
    var links = Array.prototype.slice.call(document.querySelectorAll('.toc a[href^="#"]'));
    if (!links.length || !('IntersectionObserver' in window)) return;

    var byId = {};
    var targets = [];
    links.forEach(function (link) {
      var id = decodeURIComponent(link.getAttribute('href').slice(1));
      var el = document.getElementById(id);
      if (!el) return;
      byId[id] = link;
      targets.push(el);
    });
    if (!targets.length) return;

    var visible = new Set();

    function paint() {
      // The heading nearest the top of the viewport wins. Comparing document
      // order rather than intersectionRatio keeps a short section from losing to
      // a tall one that happens to occupy more of the screen.
      var best = null;
      targets.forEach(function (el) {
        if (!visible.has(el.id)) return;
        if (!best || el.compareDocumentPosition(best) & Node.DOCUMENT_POSITION_PRECEDING) {
          best = el;
        }
      });
      links.forEach(function (link) {
        link.removeAttribute('aria-current');
      });
      if (best && byId[best.id]) byId[best.id].setAttribute('aria-current', 'true');
    }

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        });
        paint();
      },
      // Bias the band to the upper third: a heading is "current" once it reaches
      // the top of the reading area, not when it first peeks in from the bottom.
      { rootMargin: '-72px 0px -66% 0px', threshold: 0 }
    );

    targets.forEach(function (el) {
      observer.observe(el);
    });
  }

  /* --- syntax highlighting ------------------------------------------------ */

  /* A token is [className | null, regexSource]. A null class means "consume this
     text but leave it plain" — the trick that stops `nomic-embed-text` being
     read as the word `nomic` followed by two command-line flags.

     Order is significant: at any position the first alternative that matches
     wins, so the greedy structural rules (comments, strings) come first and the
     catch-alls come last. Every pattern must use NON-capturing groups — the
     matcher identifies a token by which capture group is defined, so a stray
     group inside a rule would shift every rule after it. */
  var GRAMMARS = {
    bash: {
      flags: 'g',
      rules: [
        ['comment', '#[^\\n]*'],
        ['string', '"(?:\\\\.|[^"\\\\])*"|\'[^\']*\''],
        // A URL is one opaque token. Without this the `.git` ending a clone URL
        // is read as the `git` command and coloured as one.
        [null, 'https?://[^\\s\'"]+'],
        // Versioned identifiers — `llama3.1:8b`, `neo4j:5`. Without this the
        // digits inside them are picked off individually as numbers.
        [null, '[A-Za-z][\\w]*[.:]\\d[\\w.:-]*'],
        [null, '[A-Za-z_][\\w.]*(?:-[\\w.]+)+'],
        ['builtin', '\\$\\{?[A-Za-z_][\\w]*\\}?'],
        ['keyword', '\\b(?:cd|export|source|if|then|else|fi|for|in|do|done|while|sudo|set)\\b'],
        ['builtin', '\\b(?:docker|compose|ollama|git|curl|npm|python3?|pip|make|cat|mkdir|cp|mv|echo)\\b'],
        ['flag', '--?[A-Za-z][\\w-]*'],
        ['number', '\\b\\d+(?:\\.\\d+)?\\b']
      ]
    },
    yaml: {
      flags: 'gm',
      rules: [
        ['comment', '#[^\\n]*'],
        ['string', '"(?:\\\\.|[^"\\\\])*"|\'[^\']*\''],
        // A key is a word followed by a colon and then whitespace or end of line.
        // Requiring the space is what keeps `neo4j:5-community` a value.
        ['key', '[\\w.$-]+(?=[ \\t]*:(?:[ \\t]|$))'],
        // `neo4j:5-community` is an image tag, not a key with a number in it.
        [null, '[A-Za-z][\\w]*[.:]\\d[\\w.:-]*'],
        ['keyword', '\\b(?:true|false|null|yes|no|on|off)\\b'],
        ['number', '\\b\\d+(?:\\.\\d+)?\\b']
      ]
    },
    json: {
      flags: 'g',
      rules: [
        ['key', '"(?:\\\\.|[^"\\\\])*"(?=\\s*:)'],
        ['string', '"(?:\\\\.|[^"\\\\])*"'],
        ['keyword', '\\b(?:true|false|null)\\b'],
        ['number', '-?\\b\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b']
      ]
    },
    python: {
      flags: 'g',
      rules: [
        ['comment', '#[^\\n]*'],
        ['string', '"""[\\s\\S]*?"""|\'\'\'[\\s\\S]*?\'\'\'|"(?:\\\\.|[^"\\\\])*"|\'(?:\\\\.|[^\'\\\\])*\''],
        ['builtin', '@[\\w.]+'],
        ['keyword', '\\b(?:from|import|def|class|return|if|elif|else|for|while|with|as|async|await|try|except|finally|raise|yield|lambda|in|not|and|or|is|None|True|False|pass|self)\\b'],
        ['builtin', '\\b(?:print|len|list|dict|set|str|int|float|bool|open|range|super)\\b'],
        ['number', '\\b\\d+(?:\\.\\d+)?\\b']
      ]
    },
    typescript: {
      flags: 'g',
      rules: [
        ['comment', '//[^\\n]*|/\\*[\\s\\S]*?\\*/'],
        ['string', '`(?:\\\\.|[^`\\\\])*`|"(?:\\\\.|[^"\\\\])*"|\'(?:\\\\.|[^\'\\\\])*\''],
        ['keyword', '\\b(?:import|export|from|const|let|var|function|return|await|async|class|extends|new|type|interface|as|if|else|for|of|default)\\b'],
        ['builtin', '\\b(?:string|number|boolean|void|Promise|Record|Array|D3|d3)\\b'],
        ['number', '\\b\\d+(?:\\.\\d+)?\\b']
      ]
    },
    cypher: {
      flags: 'g',
      rules: [
        ['comment', '//[^\\n]*'],
        ['string', '"(?:\\\\.|[^"\\\\])*"|\'(?:\\\\.|[^\'\\\\])*\''],
        ['keyword', '\\b(?:MATCH|WHERE|RETURN|WITH|CREATE|MERGE|OPTIONAL|UNWIND|ORDER|BY|LIMIT|SKIP|SET|DELETE|DETACH|AS|AND|OR|NOT|IN|DESC|ASC|CALL|YIELD)\\b'],
        ['builtin', '\\b(?:count|collect|toLower|toUpper|size|type|id|labels)\\b'],
        ['number', '\\b\\d+(?:\\.\\d+)?\\b']
      ]
    }
  };

  function escapeHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  var compiled = {};

  function compile(lang) {
    if (compiled[lang]) return compiled[lang];
    var grammar = GRAMMARS[lang];
    if (!grammar) return null;
    var source = grammar.rules
      .map(function (rule) {
        return '(' + rule[1] + ')';
      })
      .join('|');
    compiled[lang] = { re: new RegExp(source, grammar.flags), rules: grammar.rules };
    return compiled[lang];
  }

  /* Tokenizes the RAW source and escapes each piece on the way out. Highlighting
     already-escaped HTML is the usual shortcut and it is wrong: `&amp;` becomes
     three tokens, and a rule matching `&` splits an entity down the middle. */
  function highlight(code, lang) {
    var grammar = compile(lang);
    if (!grammar) return escapeHtml(code);

    var re = grammar.re;
    var out = '';
    var last = 0;
    var match;

    re.lastIndex = 0;
    while ((match = re.exec(code)) !== null) {
      // A rule that can match the empty string would otherwise never advance.
      if (match[0] === '') {
        re.lastIndex += 1;
        continue;
      }
      out += escapeHtml(code.slice(last, match.index));

      var cls = null;
      for (var i = 1; i < match.length; i += 1) {
        if (match[i] !== undefined) {
          cls = grammar.rules[i - 1][0];
          break;
        }
      }

      var text = escapeHtml(match[0]);
      out += cls ? '<span class="tok-' + cls + '">' + text + '</span>' : text;
      last = match.index + match[0].length;
    }

    return out + escapeHtml(code.slice(last));
  }

  function initCode() {
    var blocks = document.querySelectorAll('pre > code[data-lang]');

    Array.prototype.forEach.call(blocks, function (code) {
      var lang = code.getAttribute('data-lang');
      var source = code.textContent;

      // Stash the literal text: the copy button must hand over what the reader
      // sees, not the markup highlighting turned it into.
      code.setAttribute('data-source', source);
      code.innerHTML = highlight(source, lang);
    });

    var heads = document.querySelectorAll('.code-block__head');

    Array.prototype.forEach.call(heads, function (head) {
      var block = head.parentElement;
      var code = block.querySelector('code[data-lang]');
      if (!code || head.querySelector('.copy-btn')) return;

      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'copy-btn';
      button.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<rect x="9" y="9" width="13" height="13" rx="2"/>' +
        '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>' +
        '<span>Copy</span>';

      var label = code.getAttribute('data-copy-label') || 'code';
      button.setAttribute('aria-label', 'Copy ' + label + ' to clipboard');

      var reset;
      button.addEventListener('click', function () {
        var text = code.getAttribute('data-source') || code.textContent;
        var done = function (ok) {
          button.setAttribute('data-copied', ok ? 'true' : 'false');
          button.querySelector('span').textContent = ok ? 'Copied' : 'Press Ctrl+C';
          clearTimeout(reset);
          reset = setTimeout(function () {
            button.removeAttribute('data-copied');
            button.querySelector('span').textContent = 'Copy';
          }, 2000);
        };

        // The async Clipboard API needs a secure context, which file:// is not —
        // so a local checkout of this page falls back rather than silently
        // doing nothing.
        if (navigator.clipboard && window.isSecureContext) {
          navigator.clipboard.writeText(text).then(
            function () { done(true); },
            function () { done(false); }
          );
        } else {
          done(false);
        }
      });

      head.appendChild(button);
    });
  }

  /* --- scroll reveal -------------------------------------------------------
     The hidden state lives behind the .nx-js class added here, so a visitor
     with JS blocked sees a fully visible page rather than a blank one. */

  function initReveal() {
    var items = document.querySelectorAll('.reveal');
    if (!items.length || !('IntersectionObserver' in window)) return;

    document.documentElement.classList.add('nx-js');

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-in');
            observer.unobserve(entry.target);
          }
        });
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.1 }
    );

    items.forEach(function (el) {
      // Anything already on screen at load reveals immediately — observing it
      // first paints a flash of hidden content above the fold.
      var rect = el.getBoundingClientRect();
      if (rect.top < window.innerHeight && rect.bottom > 0) {
        el.classList.add('is-in');
      } else {
        observer.observe(el);
      }
    });
  }

  /* --- header shadow ------------------------------------------------------- */

  function initHeaderState() {
    var header = document.querySelector('.site-header');
    if (!header) return;

    var ticking = false;
    function update() {
      header.classList.toggle('scrolled', window.scrollY > 8);
      ticking = false;
    }

    window.addEventListener(
      'scroll',
      function () {
        if (!ticking) {
          ticking = true;
          requestAnimationFrame(update);
        }
      },
      { passive: true }
    );
    update();
  }

  /* --- boot --------------------------------------------------------------- */

  function boot() {
    initTheme();
    initNav();
    initScrollSpy();
    initCode();
    initReveal();
    initHeaderState();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
