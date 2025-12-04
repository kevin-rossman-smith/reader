(() => {
  const els = {
    scroller: document.getElementById("page-scroller"),
    container: document.getElementById("page-container"),
    currentPage: document.getElementById("current-page"),
    totalPages: document.getElementById("total-pages"),
    status: document.getElementById("status"),
    title: document.getElementById("book-title"),
    meta: document.getElementById("book-meta"),
    fileInput: document.getElementById("file-input"),
    dropZone: document.getElementById("drop-zone"),
    sampleBtn: document.getElementById("sample-btn"),
    themeButtons: Array.from(document.querySelectorAll("[data-theme]")),
    fontSize: document.getElementById("font-size"),
    fontSizeValue: document.getElementById("font-size-value"),
    lineHeight: document.getElementById("line-height"),
    lineHeightValue: document.getElementById("line-height-value"),
    pagePadding: document.getElementById("page-padding"),
    pagePaddingValue: document.getElementById("page-padding-value"),
    columnGap: document.getElementById("column-gap"),
    columnGapValue: document.getElementById("column-gap-value"),
    prev: document.getElementById("prev-page"),
    next: document.getElementById("next-page"),
    optionsPanel: document.getElementById("options-panel"),
    toggleOptions: document.getElementById("toggle-options"),
    enterFullscreen: document.getElementById("enter-fullscreen"),
    fullscreenShell: document.getElementById("fullscreen-shell"),
    fullscreenChrome: document.getElementById("fullscreen-chrome"),
    fsContainer: document.getElementById("fs-page-container"),
    fsScroller: document.getElementById("fs-page-scroller"),
    fsCurrentPage: document.getElementById("fs-current-page"),
    fsTotalPages: document.getElementById("fs-total-pages"),
    fsPrev: document.getElementById("fs-prev-page"),
    fsNext: document.getElementById("fs-next-page"),
    exitFullscreen: document.getElementById("exit-fullscreen"),
    fsToggleOptions: document.getElementById("fs-toggle-options"),
    driveAuthBtn: document.getElementById("drive-auth-btn"),
    driveSignoutBtn: document.getElementById("drive-signout-btn"),
    driveListBtn: document.getElementById("drive-list-btn"),
    driveRevokeBtn: document.getElementById("drive-revoke-btn"),
    driveFiles: document.getElementById("drive-files"),
  };

  const sampleContent = `Through the Pines

  Chapter 1 — Trailhead
  The path began where the town ended, stitched between pines that whispered like careful conspirators. Leah tightened the straps on her pack and stepped forward, letting the scent of resin and wet earth steady her breathing.

  Chapter 2 — Switchbacks
  The climb wound upward in generous arcs. The ground gave way to stone and root, and every switchback revealed more of the valley's quiet geometry. Leah read the ridgeline like a sentence she had been meaning to finish.

  Chapter 3 — Blue Hour
  At the overlook the forest blued under the early dusk. She unpacked a small thermos, the steam curling into the cool air, and watched the horizon fold itself into the dark. Her pulse matched the hush. No notifications, no rush—just the slow turning of light.

  Chapter 4 — Lantern
  Night drew the temperature down. Leah hung a lantern from a low branch, its glow soaking the clearing in amber. She opened her notebook, filling pages with loose sketches of peaks and firs, finally having space to hear herself think.

  Chapter 5 — Return
  When dawn bleached the sky she headed back, the trail now familiar in reverse. The town's outline appeared between trunks, yet the quiet clung to her shoulders like a new layer. She kept it there, a pocket of stillness to reach for on busier days.`;

  const state = {
    currentPage: 1,
    totalPages: 1,
    fsCurrentPage: 1,
    fsTotalPages: 1,
    bookName: "Sample: Through the Pines",
    fullScreen: false,
  };

  const googleConfig = {
    clientId: "YOUR_GOOGLE_CLIENT_ID",
    apiKey: "YOUR_GOOGLE_API_KEY",
    discoveryDocs: ["https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"],
    scope: "https://www.googleapis.com/auth/drive.readonly",
  };

  let gapiReady = false;
  let gisReady = false;
  let tokenClient = null;

  const setStatus = (message) => {
    if (!els.status) return;
    els.status.textContent = message;
  };

  const sanitizeParagraph = (text) => {
    const div = document.createElement("div");
    div.textContent = text.trim();
    return div.innerHTML;
  };

  const views = {
    primary: {
      container: () => els.container,
      scroller: () => els.scroller,
      currentEl: () => els.currentPage,
      totalEl: () => els.totalPages,
      currentKey: "currentPage",
      totalKey: "totalPages",
    },
    fullscreen: {
      container: () => els.fsContainer,
      scroller: () => els.fsScroller,
      currentEl: () => els.fsCurrentPage,
      totalEl: () => els.fsTotalPages,
      currentKey: "fsCurrentPage",
      totalKey: "fsTotalPages",
    },
  };

  const updateMetricsFor = (view, targetPage = 1) => {
    const container = view.container();
    const scroller = view.scroller();
    if (!container || !scroller) return;
    const pageWidth = container.clientWidth || 1;
    const total = Math.max(1, Math.ceil(scroller.scrollWidth / pageWidth));
    state[view.totalKey] = total;
    view.totalEl().textContent = total;
    goToPage(view, Math.min(targetPage, total));
  };

  const updateAllPageMetrics = (targetPage = 1) => {
    updateMetricsFor(views.primary, targetPage);
    updateMetricsFor(views.fullscreen, targetPage);
  };

  const goToPage = (view, page) => {
    const container = view.container();
    if (!container) return;
    const pageWidth = container.clientWidth || 1;
    const total = state[view.totalKey] || 1;
    const clamped = Math.max(1, Math.min(page, total));
    state[view.currentKey] = clamped;
    view.currentEl().textContent = clamped;
    container.scrollTo({ left: pageWidth * (clamped - 1), behavior: "smooth" });
  };

  const handleScroll = (view) => {
    const container = view.container();
    if (!container) return;
    const pageWidth = container.clientWidth || 1;
    const calculated = Math.round(container.scrollLeft / pageWidth) + 1;
    if (calculated !== state[view.currentKey]) {
      state[view.currentKey] = calculated;
      view.currentEl().textContent = calculated;
    }
  };

  const applyTheme = (theme) => {
    document.body.className = `theme-${theme}`;
    els.themeButtons.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.theme === theme);
    });
  };

  const setReaderVar = (variable, value) => {
    [els.scroller, els.fsScroller].forEach((target) => target?.style.setProperty(variable, value));
  };

  const bindSlider = (input, display, unit, variable) => {
    const setValue = (value) => {
      display.textContent = unit === "ratio" ? (value / 100).toFixed(2) : `${value}px`;
      const cssValue = unit === "ratio" ? value / 100 : `${value}px`;
      setReaderVar(variable, cssValue);
      updateAllPageMetrics(state.currentPage);
    };
    setValue(Number(input.value));
    input.addEventListener("input", (e) => setValue(Number(e.target.value)));
  };

  const syncFullscreenContent = () => {
    els.fsScroller.innerHTML = els.scroller.innerHTML;
  };

  const renderContent = (text) => {
    const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
    if (!blocks.length) {
      const empty = "<p>Nothing to display yet. Add a file or type some text.</p>";
      els.scroller.innerHTML = empty;
      els.fsScroller.innerHTML = empty;
      updateAllPageMetrics();
      return;
    }

    const markup = blocks.map((block) => `<p>${sanitizeParagraph(block)}</p>`).join("");
    els.scroller.innerHTML = markup;
    syncFullscreenContent();
    setStatus(`Loaded ${blocks.length} paragraphs. Use ← →, buttons, or swipe to turn pages.`);
    requestAnimationFrame(() => updateAllPageMetrics(1));
  };

  const loadFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => setStatus("Could not read that file. Try a text or markdown file.");
    reader.onload = () => {
      const text = reader.result.toString();
      renderContent(text);
      els.title.textContent = file.name;
      els.meta.textContent = `${Math.max(1, Math.round(text.length / 1000))}k chars`;
      state.bookName = file.name;
    };
    reader.readAsText(file);
  };

  const setupDragAndDrop = () => {
    const zone = els.dropZone;
    ["dragenter", "dragover"].forEach((ev) =>
      zone.addEventListener(ev, (e) => {
        e.preventDefault();
        e.stopPropagation();
        zone.classList.add("is-dragover");
      })
    );
    ["dragleave", "drop"].forEach((ev) =>
      zone.addEventListener(ev, (e) => {
        e.preventDefault();
        e.stopPropagation();
        zone.classList.remove("is-dragover");
      })
    );
    zone.addEventListener("drop", (e) => {
      const file = e.dataTransfer.files?.[0];
      if (file) loadFile(file);
    });
  };

  const initLocalControls = () => {
    els.fileInput.addEventListener("change", (e) => loadFile(e.target.files?.[0]));
    els.sampleBtn.addEventListener("click", () => {
      els.title.textContent = "Sample: Through the Pines";
      els.meta.textContent = "~4 min read";
      state.bookName = "Sample: Through the Pines";
      renderContent(sampleContent);
    });

    els.themeButtons.forEach((btn) =>
      btn.addEventListener("click", () => applyTheme(btn.dataset.theme))
    );

    bindSlider(els.fontSize, els.fontSizeValue, "px", "--reader-font-size");
    bindSlider(els.lineHeight, els.lineHeightValue, "ratio", "--reader-line-height");
    bindSlider(els.pagePadding, els.pagePaddingValue, "px", "--reader-page-padding");
    bindSlider(els.columnGap, els.columnGapValue, "px", "--reader-column-gap");

    els.prev.addEventListener("click", () => goToPage(views.primary, state.currentPage - 1));
    els.next.addEventListener("click", () => goToPage(views.primary, state.currentPage + 1));
    els.container.addEventListener("scroll", () => handleScroll(views.primary));
    els.container.addEventListener("keydown", (e) => {
      if (["ArrowLeft", "PageUp"].includes(e.key)) {
        e.preventDefault();
        goToPage(views.primary, state.currentPage - 1);
      }
      if (["ArrowRight", "PageDown"].includes(e.key)) {
        e.preventDefault();
        goToPage(views.primary, state.currentPage + 1);
      }
    });

    const resizeObserver = new ResizeObserver(() => updateAllPageMetrics(state.currentPage));
    resizeObserver.observe(els.container);
    resizeObserver.observe(els.fsContainer);

    setupDragAndDrop();
    renderContent(sampleContent);
    applyTheme("lamp");
  };

  const driveConfigured = () =>
    googleConfig.clientId && !googleConfig.clientId.startsWith("YOUR") && googleConfig.apiKey;

  const maybeEnableDriveButtons = () => {
    const enabled = driveConfigured() && gapiReady && gisReady;
    els.driveAuthBtn.disabled = !enabled;
    els.driveListBtn.disabled = !enabled;
    els.driveRevokeBtn.disabled = !enabled;
    setStatus(
      enabled
        ? "Drive ready: click “Sign in with Drive” then list files."
        : "Add your Google Client ID/API key in app.js to enable Drive."
    );
  };

  const toggleOptionsPanel = () => {
    const isHidden = els.optionsPanel.hasAttribute("hidden");
    if (isHidden) {
      els.optionsPanel.removeAttribute("hidden");
      els.toggleOptions.setAttribute("aria-expanded", "true");
    } else {
      els.optionsPanel.setAttribute("hidden", "");
      els.toggleOptions.setAttribute("aria-expanded", "false");
    }
  };

  const handleDriveAuth = () => {
    if (!driveConfigured()) {
      setStatus("Please configure GOOGLE clientId/apiKey in app.js before signing in.");
      return;
    }
    if (!tokenClient) {
      setStatus("Drive scripts still loading—one moment.");
      return;
    }
    tokenClient.callback = (resp) => {
      if (resp.error) {
        setStatus("Drive auth failed. Check credentials.");
        return;
      }
      setStatus("Signed in. List files to choose a book.");
      els.driveSignoutBtn.hidden = false;
    };
    tokenClient.requestAccessToken({ prompt: "consent" });
  };

  const handleDriveSignout = () => {
    const token = gapi.client.getToken();
    if (token) {
      google.accounts.oauth2.revoke(token.access_token, () => {
        gapi.client.setToken(null);
        setStatus("Drive token revoked.");
      });
    }
    els.driveSignoutBtn.hidden = true;
  };

  const listDriveFiles = async () => {
    try {
      setStatus("Listing text-friendly files…");
      const res = await gapi.client.drive.files.list({
        pageSize: 12,
        fields: "files(id, name, mimeType, size)",
        q: "mimeType='text/plain' or mimeType='text/markdown' or mimeType='text/html'",
        orderBy: "modifiedTime desc",
      });
      const files = res.result.files || [];
      renderDriveList(files);
      setStatus(files.length ? "Pick a file to load." : "No text/markdown/html files found.");
    } catch (err) {
      console.error(err);
      setStatus("Could not list Drive files. Check scope and API key.");
    }
  };

  const renderDriveList = (files) => {
    els.driveFiles.innerHTML = "";
    files.forEach((file) => {
      const li = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = file.name;
      const btn = document.createElement("button");
      btn.textContent = "Load";
      btn.addEventListener("click", () => openDriveFile(file));
      li.append(name, btn);
      els.driveFiles.appendChild(li);
    });
  };

  const openDriveFile = async (file) => {
    try {
      setStatus(`Opening ${file.name}…`);
      const res = await gapi.client.drive.files.get({
        fileId: file.id,
        alt: "media",
      });
      renderContent(res.body);
      els.title.textContent = file.name;
      els.meta.textContent = `${file.mimeType} • ${((file.size || 0) / 1024).toFixed(1)} KB`;
      state.bookName = file.name;
    } catch (err) {
      console.error(err);
      setStatus("Could not open that file. Ensure it is text/markdown/html.");
    }
  };

  const exposeGoogleHooks = () => {
    window.gapiLoaded = () => {
      try {
        gapi.load("client", {
          callback: async () => {
            await gapi.client.init({
              apiKey: googleConfig.apiKey,
              discoveryDocs: googleConfig.discoveryDocs,
            });
            gapiReady = true;
            maybeEnableDriveButtons();
          },
          onerror: () => setStatus("Google API failed to load."),
        });
      } catch (err) {
        console.error(err);
        setStatus("Google API failed to init. Check apiKey/discoveryDocs.");
      }
    };

    window.gisLoaded = () => {
      try {
        tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: googleConfig.clientId,
          scope: googleConfig.scope,
          callback: () => {},
        });
        gisReady = true;
        maybeEnableDriveButtons();
      } catch (err) {
        console.error(err);
        setStatus("Google Identity failed to init. Check clientId.");
      }
    };

    window.addEventListener("load", () => {
      if (window.gapi && !gapiReady) window.gapiLoaded();
      if (window.google && !gisReady) window.gisLoaded();
    });

    const gapiScript = document.querySelector('script[src*="apis.google.com/js/api.js"]');
    if (gapiScript) gapiScript.addEventListener("load", () => !gapiReady && window.gapiLoaded());
    const gisScript = document.querySelector('script[src*="accounts.google.com/gsi/client"]');
    if (gisScript) gisScript.addEventListener("load", () => !gisReady && window.gisLoaded());
  };

  const initDriveControls = () => {
    els.driveAuthBtn.addEventListener("click", handleDriveAuth);
    els.driveSignoutBtn.addEventListener("click", handleDriveSignout);
    els.driveListBtn.addEventListener("click", listDriveFiles);
    els.driveRevokeBtn.addEventListener("click", handleDriveSignout);
  };

  const initOptionsToggle = () => {
    els.toggleOptions.addEventListener("click", toggleOptionsPanel);
  };

  const addSwipeNavigation = (element, view) => {
    if (!element) return;
    let startX = 0;
    element.addEventListener("touchstart", (e) => {
      startX = e.touches[0].clientX;
    });
    element.addEventListener("touchend", (e) => {
      const deltaX = e.changedTouches[0].clientX - startX;
      if (Math.abs(deltaX) > 50) {
        if (deltaX > 0) {
          goToPage(view, state[view.currentKey] - 1);
        } else {
          goToPage(view, state[view.currentKey] + 1);
        }
      }
    });
  };

  const enterFullscreen = () => {
    state.fullScreen = true;
    els.fullscreenShell.hidden = false;
    els.fullscreenChrome.hidden = true;
    syncFullscreenContent();
    updateMetricsFor(views.fullscreen, state.currentPage);
  };

  const exitFullscreen = () => {
    state.fullScreen = false;
    els.fullscreenShell.hidden = true;
    els.fullscreenChrome.hidden = true;
  };

  const initFullscreen = () => {
    els.enterFullscreen.addEventListener("click", enterFullscreen);
    els.exitFullscreen.addEventListener("click", exitFullscreen);
    els.fsToggleOptions.addEventListener("click", toggleOptionsPanel);
    els.fsPrev.addEventListener("click", () =>
      goToPage(views.fullscreen, state[views.fullscreen.currentKey] - 1)
    );
    els.fsNext.addEventListener("click", () =>
      goToPage(views.fullscreen, state[views.fullscreen.currentKey] + 1)
    );

    els.fullscreenShell.addEventListener("click", (e) => {
      const chrome = els.fullscreenChrome;
      if (
        e.target === els.fullscreenShell ||
        e.target === els.fsContainer ||
        e.target === els.fsScroller
      ) {
        const isHidden = chrome.hasAttribute("hidden");
        if (isHidden) {
          chrome.removeAttribute("hidden");
        } else {
          chrome.setAttribute("hidden", "");
        }
      }
    });

    [els.container, els.fsContainer].forEach((el, idx) =>
      addSwipeNavigation(el, idx === 0 ? views.primary : views.fullscreen)
    );
    els.fsContainer.addEventListener("scroll", () => handleScroll(views.fullscreen));
  };

  initLocalControls();
  initOptionsToggle();
  initDriveControls();
  initFullscreen();
  exposeGoogleHooks();
})();
